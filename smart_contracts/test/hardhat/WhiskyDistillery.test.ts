import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { Contract, ContractFactory } from 'ethers'
import { deployments, ethers } from 'hardhat'

import { Options } from '@layerzerolabs/lz-v2-utilities'

// Smoke test of the ethers deployment path; the cross-chain properties are covered by test/foundry.
describe('WhiskyDistillery smoke test', function () {
    // Mock Endpoint IDs and id namespaces (chain ids) of the two chains
    const eidA = 1
    const eidB = 2
    const prefixA = 421614
    const prefixB = 84532
    const cid = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
    const revisedCid = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku'

    let WhiskyDistillery: ContractFactory
    let EndpointV2Mock: ContractFactory
    let ownerA: SignerWithAddress
    let ownerB: SignerWithAddress
    let endpointOwner: SignerWithAddress
    let distilleryA: Contract
    let distilleryB: Contract

    before(async function () {
        WhiskyDistillery = await ethers.getContractFactory('WhiskyDistillery')

        const signers = await ethers.getSigners()

        ;[ownerA, ownerB, endpointOwner] = signers

        // The EndpointV2Mock contract comes from @layerzerolabs/test-devtools-evm-hardhat package
        // and its artifacts are connected as external artifacts to this project
        const EndpointV2MockArtifact = await deployments.getArtifact('EndpointV2Mock')
        EndpointV2Mock = new ContractFactory(EndpointV2MockArtifact.abi, EndpointV2MockArtifact.bytecode, endpointOwner)
    })

    beforeEach(async function () {
        const mockEndpointV2A = await EndpointV2Mock.deploy(eidA)
        const mockEndpointV2B = await EndpointV2Mock.deploy(eidB)

        // Same constructor arguments as deploy/WhiskyDistillery.ts, with the mock endpoints
        distilleryA = await WhiskyDistillery.deploy(
            'WhiskyDistillery',
            'IDPP',
            prefixA,
            mockEndpointV2A.address,
            ownerA.address
        )
        distilleryB = await WhiskyDistillery.deploy(
            'WhiskyDistillery',
            'IDPP',
            prefixB,
            mockEndpointV2B.address,
            ownerB.address
        )

        await mockEndpointV2A.setDestLzEndpoint(distilleryB.address, mockEndpointV2B.address)
        await mockEndpointV2B.setDestLzEndpoint(distilleryA.address, mockEndpointV2A.address)

        await distilleryA.connect(ownerA).setPeer(eidB, ethers.utils.zeroPad(distilleryB.address, 32))
        await distilleryB.connect(ownerB).setPeer(eidA, ethers.utils.zeroPad(distilleryA.address, 32))

        // as deploy/WhiskyDistillery.ts does: the owner becomes the first issuer of its chain
        await distilleryA.connect(ownerA).setIssuer(ownerA.address, true)
        await distilleryB.connect(ownerB).setIssuer(ownerB.address, true)
    })

    it('mints a passport and resolves it on the destination after a send', async function () {
        const tokenId = await distilleryA.nextTokenId()
        expect(tokenId).eql(ethers.BigNumber.from(prefixA).mul(ethers.BigNumber.from(10).pow(12)))
        await distilleryA.connect(ownerA).mint(ownerA.address, tokenId, cid)
        await distilleryA.connect(ownerA).revise(tokenId, 0, revisedCid)

        const options = Options.newOptions().addExecutorLzReceiveOption(300000, 0).toHex().toString()
        const sendParam = [eidB, ethers.utils.zeroPad(ownerB.address, 32), tokenId, options, '0x', '0x']
        const [nativeFee] = await distilleryA.quoteSend(sendParam, false)
        await distilleryA.send(sendParam, [nativeFee, 0], ownerA.address, { value: nativeFee })

        // EndpointV2Mock swallows receive failures, so assert the resulting state
        expect(await distilleryA.balanceOf(ownerA.address)).eql(ethers.BigNumber.from(0))
        expect(await distilleryB.ownerOf(tokenId)).eql(ownerB.address)

        const passport = await distilleryB.passportOf(tokenId)
        expect(passport.revision).eql(ethers.BigNumber.from(1))
        expect(passport.cid).eql(revisedCid)
        expect(await distilleryB.tokenURI(tokenId)).eql(`ipfs://${revisedCid}`)

        // the carried history hash is the one a reader recomputes from the two CIDs
        const step = (previous: string, revision: number, value: string) =>
            ethers.utils.keccak256(
                ethers.utils.defaultAbiCoder.encode(
                    ['bytes32', 'uint256', 'uint64', 'string'],
                    [previous, tokenId, revision, value]
                )
            )
        expect(passport.historyHash).eql(step(step(ethers.constants.HashZero, 0, cid), 1, revisedCid))
    })

    it('lets only an issuer revise, not the holder', async function () {
        const [, , , holder] = await ethers.getSigners()
        const tokenId = await distilleryA.nextTokenId()
        await distilleryA.connect(ownerA).mint(holder.address, tokenId, cid)

        let error: unknown
        try {
            await distilleryA.connect(holder).revise(tokenId, 0, revisedCid)
        } catch (e) {
            error = e
        }
        expect(String(error)).to.contain('NotIssuer')

        await distilleryA.connect(ownerA).revise(tokenId, 0, revisedCid)
        expect((await distilleryA.passportOf(tokenId)).revision).eql(ethers.BigNumber.from(1))
    })

    it('rejects a mint bound to a taken id and a revision prepared against a stale revision', async function () {
        const tokenId = await distilleryA.nextTokenId()
        await distilleryA.connect(ownerA).mint(ownerA.address, tokenId, cid)

        let error: unknown
        try {
            await distilleryA.connect(ownerA).mint(ownerA.address, tokenId, cid)
        } catch (e) {
            error = e
        }
        expect(String(error)).to.contain('UnexpectedTokenId')

        await distilleryA.connect(ownerA).revise(tokenId, 0, revisedCid)
        error = undefined
        try {
            await distilleryA.connect(ownerA).revise(tokenId, 0, cid)
        } catch (e) {
            error = e
        }
        expect(String(error)).to.contain('StaleRevision')
        expect((await distilleryA.passportOf(tokenId)).cid).eql(revisedCid)
    })
})
