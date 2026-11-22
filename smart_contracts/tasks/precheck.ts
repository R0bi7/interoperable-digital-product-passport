import path from 'path'

import { ethers } from 'ethers'
import { task, types } from 'hardhat/config'

import { httpNetwork, manifestDrift, networkForEid, readDeploymentRecord, readManifest } from './deployments'

import type { HardhatRuntimeEnvironment } from 'hardhat/types'

// Peer-compatibility pre-check, mandatory before `lz:oapp:wire`. Peered contracts trust each other's messages and
// `_importPassport` does not re-validate them, so every contract of the mesh must run this contract's message format,
// issue ids from its own, distinct namespace, and belong to the same deployment generation.

const ABI = [
    'function onftVersion() view returns (bytes4 interfaceId, uint64 version)',
    'function idPrefix() view returns (uint256)',
    'function peers(uint32 eid) view returns (bytes32)',
]

// What WhiskyDistillery.onftVersion() returns: the stock IONFT721 interface id (asserted against
// type(IONFT721).interfaceId by test_onftVersionReportsTheOwnMessageFormat) and
// MESSAGE_VERSION = uint64(bytes8(keccak256("WhiskyDistillery.message.v2"))).
const EXPECTED_INTERFACE_ID = '0x23e18da6'
const EXPECTED_VERSION = ethers.BigNumber.from(
    ethers.utils.keccak256(ethers.utils.toUtf8Bytes('WhiskyDistillery.message.v2')).slice(0, 18)
).toString()

interface OmniPointLike {
    eid: number
    contractName?: string
    address?: string
}

interface Resolved {
    network: string
    eid: number
    chainId: number
    url: string
    address: string
}

interface ContractState extends Resolved {
    interfaceId: string
    version: string
    idPrefix: string
    peers: Map<number, string> // remote eid -> peer address (zero address when unset)
}

const resolve = (hre: HardhatRuntimeEnvironment, point: OmniPointLike): Resolved => {
    const network = networkForEid(hre, point.eid)
    const { url, chainId } = httpNetwork(hre, network)
    const address = point.address ?? readDeploymentRecord(hre, network, point.contractName).address
    return { network, eid: point.eid, chainId, url, address }
}

const readState = async (contract: Resolved, remoteEids: number[]): Promise<ContractState> => {
    const provider = new ethers.providers.StaticJsonRpcProvider(contract.url)
    const providerChainId = Number(await provider.send('eth_chainId', []))
    if (providerChainId !== contract.chainId) {
        throw new Error(`RPC reports chain id ${providerChainId}, config says ${contract.chainId}`)
    }
    if ((await provider.getCode(contract.address)) === '0x') throw new Error(`no contract at ${contract.address}`)

    const onft = new ethers.Contract(contract.address, ABI, provider)
    const [[interfaceId, version], idPrefix, ...peers] = await Promise.all([
        onft.onftVersion(),
        onft.idPrefix(),
        ...remoteEids.map((eid) => onft.peers(eid)),
    ])
    return {
        ...contract,
        interfaceId,
        version: version.toString(),
        idPrefix: idPrefix.toString(),
        peers: new Map(
            remoteEids.map((eid, i) => [eid, ethers.utils.getAddress(ethers.utils.hexDataSlice(peers[i], 12))])
        ),
    }
}

task('lz:precheck', 'Asserts that the contracts of an OApp config can be peered (run before lz:oapp:wire)')
    .addOptionalParam('oappConfig', 'Path to the LayerZero OApp config', 'layerzero.config.ts', types.string)
    .setAction(async ({ oappConfig }: { oappConfig: string }, hre) => {
        const configPath = path.resolve(hre.config.paths.root, oappConfig)
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const loaded = require(configPath)
        // Prefer the named `contracts` export: the default export may fetch DVN metadata the check does not need.
        const exported = loaded.default ?? loaded
        const points: { contract: OmniPointLike }[] =
            loaded.contracts ?? (typeof exported === 'function' ? await exported() : exported).contracts

        const failures: string[] = []
        const resolved: Resolved[] = []
        for (const { contract } of points) {
            try {
                resolved.push(resolve(hre, contract))
            } catch (error) {
                failures.push(`eid ${contract.eid}: ${(error as Error).message}`)
            }
        }

        // The chains are independent, so read them concurrently.
        const eids = resolved.map((c) => c.eid)
        const results = await Promise.allSettled(
            resolved.map((c) =>
                readState(
                    c,
                    eids.filter((eid) => eid !== c.eid)
                )
            )
        )
        const states: ContractState[] = []
        results.forEach((result, i) => {
            if (result.status === 'fulfilled') states.push(result.value)
            else failures.push(`${resolved[i].network}: ${(result.reason as Error).message}`)
        })

        console.table(
            states.map(({ network, eid, address, chainId, interfaceId, version, idPrefix }) => ({
                network,
                eid,
                address,
                chainId,
                onftVersion: `${interfaceId} / ${version}`,
                idPrefix,
            }))
        )

        // 1. every contract runs this contract's interface and message format (not merely the same one)
        for (const s of states) {
            if (s.interfaceId.toLowerCase() !== EXPECTED_INTERFACE_ID || s.version !== EXPECTED_VERSION) {
                failures.push(
                    `${s.network}: onftVersion ${s.interfaceId} / ${s.version}, expected ${EXPECTED_INTERFACE_ID} / ${EXPECTED_VERSION}`
                )
            }
        }

        // 2. every contract issues ids in its own chain's namespace
        for (const s of states) {
            if (s.idPrefix !== String(s.chainId)) {
                failures.push(`${s.network}: idPrefix ${s.idPrefix} differs from chainId ${s.chainId}`)
            }
        }

        // 3. no two contracts share a namespace
        const byPrefix = new Map<string, string[]>()
        for (const s of states) byPrefix.set(s.idPrefix, [...(byPrefix.get(s.idPrefix) ?? []), s.network])
        for (const [prefix, networks] of byPrefix) {
            if (networks.length > 1) failures.push(`idPrefix ${prefix} is shared by ${networks.join(', ')}`)
        }

        // 4. one deployment generation: the contracts are the ones the manifest declares, and the manifest
        //    matches the deployment records
        const manifest = readManifest(hre)
        if (manifest == null) {
            failures.push('deployments/manifest.json is missing; write it with `npx hardhat lz:manifest`')
        } else {
            failures.push(...manifestDrift(hre, manifest))
            for (const c of resolved) {
                const entry = manifest.chains.find((m) => m.eid === c.eid)
                if (entry == null) failures.push(`${c.network}: not part of generation ${manifest.deploymentId}`)
                else if (entry.address.toLowerCase() !== c.address.toLowerCase()) {
                    failures.push(
                        `${c.network}: ${c.address} is not the ${manifest.deploymentId} contract ${entry.address}`
                    )
                }
            }
            // and the other way: the manifest lists no chain outside the mesh (the app copies every entry)
            const meshEids = new Set(points.map(({ contract }) => contract.eid))
            for (const m of manifest.chains) {
                if (!meshEids.has(m.eid)) {
                    failures.push(`manifest lists ${m.network} (eid ${m.eid}), which is not in ${oappConfig}`)
                }
            }
        }

        // 5. no contract is already peered outside this mesh (e.g. with a contract of another generation)
        const addressByEid = new Map(resolved.map((c) => [c.eid, c.address.toLowerCase()]))
        for (const s of states) {
            for (const [eid, peer] of s.peers) {
                if (peer !== ethers.constants.AddressZero && peer.toLowerCase() !== addressByEid.get(eid)) {
                    failures.push(`${s.network}: peer for eid ${eid} is ${peer}, not the mesh contract`)
                }
            }
        }

        if (failures.length > 0) {
            throw new Error(`lz:precheck failed:\n- ${failures.join('\n- ')}`)
        }
        console.log(
            `lz:precheck passed for ${states.length} contracts of ${manifest?.deploymentId} (onftVersion ${EXPECTED_INTERFACE_ID} / ${EXPECTED_VERSION})`
        )
    })
