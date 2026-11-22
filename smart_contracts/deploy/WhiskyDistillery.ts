import assert from 'assert'

import { type DeployFunction } from 'hardhat-deploy/types'

const contractName = 'WhiskyDistillery'

const deploy: DeployFunction = async (hre) => {
    const { getNamedAccounts, deployments } = hre

    const { deploy } = deployments
    const { deployer } = await getNamedAccounts()

    assert(deployer, 'Missing named deployer account')

    console.log(`Network: ${hre.network.name}`)
    console.log(`Deployer: ${deployer}`)

    // This is an external deployment pulled in from @layerzerolabs/lz-evm-sdk-v2
    //
    // @layerzerolabs/toolbox-hardhat takes care of plugging in the external deployments
    // from @layerzerolabs packages based on the configuration in your hardhat config
    //
    // For this to work correctly, your network config must define an eid property
    // set to `EndpointId` as defined in @layerzerolabs/lz-definitions
    const endpointV2Deployment = await hre.deployments.get('EndpointV2')

    // Token ids are namespaced by the issuing chain: tokenId = chainId * 10^12 + sequence.
    // A second deployment on the same chain would re-issue the same ids, so an existing deployment is kept.
    //
    // lz:deploy runs all networks concurrently in one process, where hre.getChainId() can answer for another
    // network. The prefix therefore comes from this network's config and is checked against its own provider.
    const configuredChainId = hre.network.config.chainId
    assert(configuredChainId != null, `chainId missing in the config of network ${hre.network.name}`)
    const providerChainId = Number(await hre.network.provider.request({ method: 'eth_chainId' }))
    assert(
        providerChainId === configuredChainId,
        `network ${hre.network.name}: provider chain id ${providerChainId} differs from configured ${configuredChainId}`
    )
    const idPrefix = BigInt(configuredChainId)

    const { address, newlyDeployed } = await deploy(contractName, {
        from: deployer,
        args: [
            'WhiskyDistillery', // name
            'IDPP', // symbol
            idPrefix, // id namespace of this chain
            endpointV2Deployment.address, // LayerZero's EndpointV2 address
            deployer, // owner and LayerZero delegate
        ],
        log: true,
        skipIfAlreadyDeployed: true,
    })

    // Read back through the deployment's own provider; public RPCs may lag right after the deployment.
    const read = async (method: string, ...args: unknown[]): Promise<string> => {
        for (let attempt = 1; ; attempt++) {
            try {
                return String(await deployments.read(contractName, method, ...args))
            } catch (error) {
                if (attempt === 10) throw error
                await new Promise((resolve) => setTimeout(resolve, 3_000))
            }
        }
    }
    assert((await read('idPrefix')) === idPrefix.toString(), 'idPrefix differs from the chain id')
    assert((await read('endpoint')) === endpointV2Deployment.address, 'endpoint differs from EndpointV2')
    assert((await read('owner')) === deployer, 'owner differs from the deployer')

    // The owner configures; only issuers mint and revise. The operator server mints with the deployer key, so the
    // deployer is made the first issuer of this chain (idempotent: a reused deployment that has it is left alone).
    if ((await read('isIssuer', deployer)) !== 'true') {
        await deployments.execute(contractName, { from: deployer, log: true }, 'setIssuer', deployer, true)
    }
    // A lagging public RPC can still answer false right after the transaction, so the read is repeated.
    let issuer = false
    for (let attempt = 1; attempt <= 10 && !issuer; attempt++) {
        issuer = (await read('isIssuer', deployer)) === 'true'
        if (!issuer) await new Promise((resolve) => setTimeout(resolve, 3_000))
    }
    assert(issuer, 'the deployer is not an issuer')

    console.log(
        `${newlyDeployed ? 'Deployed' : 'Reused'} contract: ${contractName}, network: ${hre.network.name}, address: ${address}, idPrefix: ${idPrefix}`
    )
}

deploy.tags = [contractName]

export default deploy
