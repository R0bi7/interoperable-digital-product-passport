import { expect } from 'chai'
import { BigNumber, Wallet } from 'ethers'
import { ethers } from 'hardhat'

import { edgeChainFlows, maxCidFlow } from '../edge'
import { LedgerRow, appendLedger } from '../fixtures'
import { opsChainFlows } from '../ops'
import { deriveOperator, fundOperator } from '../operator'
import {
    Chain,
    TxNotConfirmed,
    Ctx,
    installRunSignals,
    interruptedStatus,
    cycleFlow,
    expectRevert,
    mintStep,
    timedTx,
    waitReceipt,
    finishStep,
    locateReceived,
    plannedPathways,
    localFlow,
    roundTripFlow,
    runFlow,
    runStopped,
    sendStep,
    staleFlow,
} from '../flows'
import { pingPongFlow } from '../latency'
import { reconcileMintLedger, runScale } from '../scale'
import { directionStats, renderLatencyMarkdown } from '../latency-report'
import { HARDHAT_KEY, HARDHAT_KEY_1, deployMesh, installFakeFetch, newCtx, newWorld } from './mock-mesh'
import { allVerified } from '../payload'
import { FlowRecord, summarize, writeReport } from '../report'
import { writeLatencyReport } from '../latency-report'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Offline dry run of the live flows on the in-process Hardhat network: three real WhiskyDistillery contracts wired
// through EndpointV2Mock, a fake Pinata upload API, a fake gateway and a fake LayerZero Scan. It exercises the same
// flow code as `hardhat e2e:flows`, but is NOT live evidence: no real chain, no real IPFS.
//
//   pnpm test:dryrun        (hardhat test tasks/__tests__/flows.dryrun.ts)

describe('live flows, offline dry run', function () {
    const world = newWorld()
    let restoreFetch: () => void
    let chains: Chain[]
    let ctx: Ctx

    before(function () {
        restoreFetch = installFakeFetch(world)
    })

    after(function () {
        restoreFetch()
    })

    // guid of the ONFTReceived event in a destination transaction
    async function guidOf(chain: Chain, txHash: string): Promise<string> {
        const receipt = await ethers.provider.getTransactionReceipt(txHash)
        const log = receipt.logs
            .map((l) => {
                try {
                    return chain.distillery.interface.parseLog(l)
                } catch {
                    return null
                }
            })
            .find((p) => p?.name === 'ONFTReceived')
        return log?.args.guid as string
    }

    beforeEach(async function () {
        world.store.clear()
        world.reads.clear()
        world.corruptSecondRead = false
        world.scan = 'DELIVERED'
        chains = await deployMesh()
        ctx = newCtx()
    })

    it('passes local, stale, crosschain and cycle with content, binding and history verified', async function () {
        const [arbitrum, base, sepolia] = chains
        const flows: FlowRecord[] = []
        await runFlow(flows, 'local', (f) => localFlow(ctx, f, arbitrum))
        await runFlow(flows, 'stale', (f) => staleFlow(ctx, f, arbitrum))
        await runFlow(flows, 'round trip', (f) => roundTripFlow(ctx, f, arbitrum, base))
        await runFlow(flows, 'cycle', (f) => cycleFlow(ctx, f, arbitrum, base, sepolia))

        expect(flows.map((f) => [f.flow, f.status, f.error])).to.deep.equal([
            ['local', 'PASS', undefined],
            ['stale', 'PASS', undefined],
            ['round trip', 'PASS', undefined],
            ['cycle', 'PASS', undefined],
        ])
        expect(summarize(flows)).to.deep.equal({ flowsRun: 4, passed: 4, failed: 0, verificationFailures: 0 })
        for (const step of flows.flatMap((f) => f.steps)) {
            if (step.verification != null) expect(allVerified(step.verification), step.step).to.equal(true)
        }

        const stale = flows[1].steps.map((s) => s.outcome).filter(Boolean)
        expect(stale).to.have.length(2)
        expect(stale[0]).to.match(/^expected revert StaleRevision\(0, 1\)$/)
        expect(stale[1]).to.match(/^expected revert UnexpectedTokenId\(\d+, \d+\)$/)

        const hops = flows[3].steps.filter((s) => s.step.startsWith('send '))
        expect(hops.map((s) => s.step)).to.deep.equal([
            'send arbitrum-sepolia -> base-sepolia',
            'send base-sepolia -> sepolia',
            'send sepolia -> arbitrum-sepolia',
        ])
        for (const hop of hops) {
            expect(hop.deliverySeconds).to.be.a('number')
            expect(hop.scanStatus).to.equal('DELIVERED')
        }
        // Instrumentation: every transaction step carries fee, block and timing; a send also locates ONFTReceived.
        const txSteps = flows.flatMap((f) => f.steps).filter((s) => s.txHash != null && s.outcome == null)
        expect(txSteps.length).to.be.greaterThan(8)
        for (const s of txSteps) {
            expect(s.effectiveGasPrice, s.step).to.match(/^\d+$/)
            expect(s.feeWei, s.step).to.equal(
                (BigInt(s.gasUsed ?? '0') * BigInt(s.effectiveGasPrice ?? '0')).toString()
            )
            expect(s.blockNumber, s.step).to.be.a('number')
            expect(s.blockTimestamp, s.step).to.be.a('number')
            expect(s.confirmSeconds, s.step).to.be.at.least(0)
            expect(s.blockSeconds, s.step).to.be.a('number')
            expect(s.includedAtMs, s.step).to.be.at.least(s.submittedAtMs ?? Infinity)
        }
        for (const s of txSteps.filter((s) => /^(mint|revise|transfer)/.test(s.step))) {
            expect(s.cidLength, s.step).to.equal(59)
            expect(s.payloadBytes, s.step).to.be.greaterThan(200)
        }
        expect(flows[0].steps[0].state).to.equal('first mint on chain, to self')
        expect(flows[0].steps[1].state).to.equal('depth 1')
        // the cycle ends on the chain that minted the token: a return, not a first arrival
        expect(hops.map((s) => s.state)).to.deep.equal(['first arrival', 'first arrival', 'return'])
        for (const hop of hops) {
            expect(hop.received?.txHash, hop.step).to.match(/^0x[0-9a-f]{64}$/)
            expect(hop.deliverySecondsChain, hop.step).to.be.a('number')
            expect(hop.deliverySecondsChain, hop.step).to.equal(
                (hop.received?.blockTimestamp ?? 0) - (hop.blockTimestamp ?? 0)
            )
        }
        // The cycle ends where it started, at revision 2, with three payloads linked by previousCid.
        const tokenId = flows[3].tokenId ?? ''
        const written = ctx.histories.get(tokenId) ?? []
        expect(written).to.have.length(3)
        const final = await arbitrum.distillery.passportOf(tokenId)
        expect(Number(final.revision)).to.equal(2)
        expect(final.cid).to.equal(written[2])
    })

    it('measures a ping-pong latency run: alternating directions, every hop delivered and verified', async function () {
        const [arbitrum, base] = chains
        const flows: FlowRecord[] = []
        await runFlow(flows, 'latency', (f) => pingPongFlow(ctx, f, arbitrum, base, 4))
        expect(flows[0].error).to.equal(undefined)
        expect(flows[0].status).to.equal('PASS')
        expect(summarize(flows).verificationFailures).to.equal(0)

        const stats = directionStats(flows)
        expect(stats.map((d) => [d.direction, d.sent, d.delivered])).to.deep.equal([
            ['arbitrum-sepolia -> base-sepolia', 2, 2],
            ['base-sepolia -> arbitrum-sepolia', 2, 2],
        ])
        expect(stats[0].poll.summary?.n).to.equal(2)
        expect(stats[0].chain.summary?.n).to.equal(2)
        // Hops 3 and 4 return the token to chains it has been on: the slot state differs from the first two.
        expect(flows[0].steps.filter((s) => s.step.startsWith('send ')).map((s) => s.state)).to.deep.equal([
            'first arrival',
            'return',
            'return',
            'return',
        ])
        // Four hops leave the token where it started, unchanged at revision 0.
        const final = await arbitrum.distillery.passportOf(flows[0].tokenId ?? '')
        expect(Number(final.revision)).to.equal(0)
        expect(renderLatencyMarkdown(ctx.runId, ctx.deploymentId, 4, stats)).to.contain(
            '| arbitrum-sepolia -> base-sepolia | 2 | 2 |'
        )
    })

    it('locates ONFTReceived by guid and reports a lookup that finds nothing instead of guessing', async function () {
        const [arbitrum, base] = chains
        const flows: FlowRecord[] = []
        await runFlow(flows, 'round trip', (f) => roundTripFlow(ctx, f, arbitrum, base))
        const hop = flows[0].steps.find((s) => s.step === 'send arbitrum-sepolia -> base-sepolia')
        expect(hop?.receivedLookup).to.equal('found')

        const fast = { attempts: 2, delayMs: 5 }
        const found = await locateReceived(base, hop?.received ? await guidOf(base, hop.received.txHash) : '', 0, fast)
        expect(found.status).to.equal('found')
        expect(found.received?.blockNumber).to.equal(hop?.received?.blockNumber)

        // a guid that was never delivered: no value, and the status says why
        const missing = await locateReceived(base, ethers.utils.hexZeroPad('0x01', 32), 0, fast)
        expect(missing).to.deep.equal({ status: 'not found' })
    })

    it('runs the DS1 operations on a chain: every operation is measured and nothing fails', async function () {
        const [arbitrum] = chains
        const flows: FlowRecord[] = []
        const ledger: LedgerRow[] = []
        await opsChainFlows(ctx, flows, arbitrum, 3, ledger)

        expect(flows.map((f) => [f.flow, f.status, f.error])).to.deep.equal(
            ['ops mint arbitrum-sepolia', 'ops revise arbitrum-sepolia', 'ops transfer arbitrum-sepolia'].map(
                (name) => [name, 'PASS', undefined]
            )
        )
        const steps = flows.flatMap((f) => f.steps)
        const count = (name: string, state?: RegExp) =>
            steps.filter((s) => s.step.startsWith(name) && (state == null || state.test(s.state ?? ''))).length
        expect(steps.filter((s) => s.step === 'mint')).to.have.length(3)
        expect(count('mint', /to self/)).to.equal(3)
        expect(steps.filter((s) => /^depth \d+$/.test(s.state ?? '')).map((s) => s.state)).to.deep.equal([
            'depth 1',
            'depth 2',
            'depth 3',
        ])
        expect(count('approve')).to.equal(0)
        expect(count('transfer', /^to a new holder, transferFrom$/)).to.equal(3) // by the holder, no approved operator
        expect(steps).to.have.length(9)
        expect(steps.every((s) => s.feeWei != null && s.blockTimestamp != null)).to.equal(true)
        // the 3 mints are on the ledger, each once, with the purpose and the run
        expect(ledger).to.have.length(3)
        expect(new Set(ledger.map((r) => r.tokenId)).size).to.equal(3)
        expect(
            ledger.every(
                (r) => r.runId === ctx.runId && r.deploymentId === ctx.deploymentId && r.purpose.startsWith('DS1')
            )
        ).to.equal(true)
    })

    it('runs the DS3 cases on a chain: rejections revert with the named error, permissions work', async function () {
        const [arbitrum] = chains
        const operator = new Wallet(HARDHAT_KEY_1, ethers.provider)
        const flows: FlowRecord[] = []
        const ledger: LedgerRow[] = []
        await edgeChainFlows(ctx, flows, arbitrum, operator, 2, ledger)

        for (const f of flows) expect([f.flow, f.status, f.error]).to.deep.equal([f.flow, 'PASS', undefined])
        const outcomes = flows
            .flatMap((f) => f.steps)
            .map((s) => s.outcome)
            .filter(Boolean)
        // 2 non-issuer mints and 2 holder revisions
        expect(outcomes.filter((o) => /^expected revert NotIssuer\(0x/.test(o ?? ''))).to.have.length(4)
        // the owner-only configuration and the endpoint-only receive, eth_call only: no transaction
        const config = flows.filter((f) => f.flow.startsWith('edge non-owner configuration')).flatMap((f) => f.steps)
        expect(config).to.have.length(2) // once per repeat, as every case
        expect(config.every((s) => s.txHash == null && s.checks.length === 5 && s.checks.every((c) => c.ok))).to.equal(
            true
        )
        expect(outcomes.filter((o) => /^expected revert StaleRevision/.test(o ?? ''))).to.have.length(2)
        expect(outcomes.filter((o) => /^expected revert UnexpectedTokenId/.test(o ?? ''))).to.have.length(2)
        const operatorRevises = flows.flatMap((f) => f.steps).filter((s) => /by approved operator/.test(s.state ?? ''))
        expect(operatorRevises.filter((s) => s.step.startsWith('revise'))).to.have.length(0)
        expect(operatorRevises.filter((s) => s.step.startsWith('transfer'))).to.have.length(2)
    })

    it('delivers the maximum-length CID to another chain', async function () {
        const [arbitrum, base] = chains
        const flows: FlowRecord[] = []
        const ledger: LedgerRow[] = []
        // The in-process mock endpoint emits no PacketSent, so the replay needs a live endpoint (decodePacket has a unit test).
        await maxCidFlow(ctx, flows, arbitrum, base, 1, ledger, { replay: false })
        expect(flows[0].error).to.equal(undefined)
        expect(flows[0].status).to.equal('PASS')
        const steps = flows[0].steps
        expect(steps.map((s) => s.step)).to.deep.equal(['mint', 'send arbitrum-sepolia -> base-sepolia'])
        expect(steps[0].cidLength).to.equal(96)
        expect(steps[1].cidLength).to.equal(96)
        const carried = await base.distillery.passportOf(flows[0].tokenId ?? '')
        expect(carried.cid).to.have.length(96)
        expect(ledger).to.have.length(1)
    })

    it('derives one second account from the owner key and tops it up only when it is short', async function () {
        const owner = new Wallet(HARDHAT_KEY, ethers.provider)
        const a = deriveOperator(owner)
        expect(a.address).to.equal(deriveOperator(owner).address)
        expect(a.address).to.not.equal(owner.address)
        expect(deriveOperator(new Wallet(HARDHAT_KEY_1, ethers.provider)).address).to.not.equal(a.address)

        const first = await fundOperator(chains[0], a, 4)
        expect(first.gt(0)).to.equal(true)
        expect((await ethers.provider.getBalance(a.address)).gte(first)).to.equal(true)
        expect((await fundOperator(chains[0], a, 4)).isZero()).to.equal(true)
    })

    it('refuses a send that is quoted above the ceiling, before anything is sent', async function () {
        const [arbitrum, base] = chains
        const capped = { ...ctx, maxSendFeeWei: ethers.BigNumber.from(1) }
        const flows: FlowRecord[] = []
        await runFlow(flows, 'round trip', (f) => roundTripFlow(capped, f, arbitrum, base))
        expect(flows[0].status).to.equal('FAIL')
        expect(flows[0].error).to.contain('above the ceiling').and.to.contain('nothing was sent')
        // the token is still on the source chain
        expect(await arbitrum.distillery.ownerOf(flows[0].tokenId ?? '')).to.equal(arbitrum.wallet.address)
        expect(flows[0].steps.some((s) => s.step.startsWith('send'))).to.equal(false)
    })

    it('stops the run when Scan has no record of a send after the grace period, and sends nothing more', async function () {
        const [arbitrum, base, sepolia] = chains
        world.scan = 404
        // The destination never shows the token, as when LayerZero does not pick the packet up.
        const undelivered = Object.create(base.distillery, {
            ownerOf: { value: () => base.distillery.ownerOf(999) },
        }) as Chain['distillery']
        const stuck: Chain = { ...base, distillery: undelivered }
        const quick = { ...ctx, scanGraceSeconds: 0 }

        const flows: FlowRecord[] = []
        const started = Date.now()
        await runFlow(flows, 'latency', (f) => pingPongFlow(quick, f, arbitrum, stuck, 4))
        expect(Date.now() - started).to.be.below(30_000) // not the 60 s delivery timeout of the context
        expect(flows[0].status).to.equal('FAIL')
        const sends = flows[0].steps.filter((s) => s.step.startsWith('send'))
        expect(sends).to.have.length(1)
        expect(sends[0].delivered).to.equal(false)
        expect(sends[0].scanStatus).to.contain('not picked up by LayerZero')
        const delivery = sends[0].checks.find((c) => c.name.startsWith('token delivered'))
        expect(delivery?.ok).to.equal(false)
        expect(delivery?.detail).to.contain('not picked up by LayerZero').and.to.contain('scan HTTP 404')
        expect(runStopped(quick)).to.contain('arbitrum-sepolia -> base-sepolia')

        // Any later send of the run is refused before a quote or a transaction.
        const before = await sepolia.wallet.getTransactionCount()
        const later: FlowRecord[] = []
        await runFlow(later, 'next pair', async (f) => {
            const tokenId = await mintStep(quick, f, sepolia, 'next pair')
            await sendStep(quick, f, sepolia, arbitrum, tokenId, 0, (quick.histories.get(tokenId.toString()) ?? [])[0])
        })
        expect(later[0].status).to.equal('FAIL')
        expect(later[0].error).to.contain('the run stopped sending')
        expect(await sepolia.wallet.getTransactionCount()).to.equal(before) // no new pin or transaction after stop
    })

    it('ends a hop and stops further sends when Scan reports a terminal failure', async function () {
        const [arbitrum, base] = chains
        world.scan = 'FAILED'
        const undelivered = Object.create(base.distillery, {
            ownerOf: { value: () => base.distillery.ownerOf(999) },
        }) as Chain['distillery']
        const flows: FlowRecord[] = []
        const started = Date.now()
        await runFlow(flows, 'latency', (f) => pingPongFlow(ctx, f, arbitrum, { ...base, distillery: undelivered }, 2))
        expect(Date.now() - started).to.be.below(30_000)
        const delivery = flows[0].steps[1].checks.find((c) => c.name.startsWith('token delivered'))
        expect(delivery?.detail).to.contain('LayerZero Scan reports FAILED')
        expect(runStopped(ctx)).to.contain('LayerZero Scan reports FAILED')
    })

    it('stops the run on a send that Scan knows but has not delivered after the stuck limit, as a message held in CONFIRMING', async function () {
        const [arbitrum, base] = chains
        world.scan = 'CONFIRMING'
        const undelivered = Object.create(base.distillery, {
            ownerOf: { value: () => base.distillery.ownerOf(999) },
        }) as Chain['distillery']
        const quick = { ...ctx, scanStuckSeconds: 0 }
        const flows: FlowRecord[] = []
        await runFlow(flows, 'latency', (f) =>
            pingPongFlow(quick, f, arbitrum, { ...base, distillery: undelivered }, 2)
        )
        const delivery = flows[0].steps[1].checks.find((c) => c.name.startsWith('token delivered'))
        expect(delivery?.detail).to.contain('still shows CONFIRMING').and.to.contain('taken as stuck')
        expect(runStopped(quick)).to.contain('arbitrum-sepolia -> base-sepolia')
    })

    it('looks at the destination once more before a Scan stop, and keeps a delivery Scan has not caught up with', async function () {
        const [arbitrum, base] = chains
        world.scan = 404
        // Absent for the check before the send and the first poll; present at the last look before the stop.
        let reads = 0
        const lateRpc = Object.create(base.distillery, {
            ownerOf: {
                value: (id: BigNumber) => {
                    if (++reads <= 2) return base.distillery.ownerOf(999)
                    world.scan = 'DELIVERED' // Scan catches up too
                    return base.distillery.ownerOf(id)
                },
            },
        }) as Chain['distillery']
        const quick = { ...ctx, scanGraceSeconds: 0 }
        const flows: FlowRecord[] = []
        await runFlow(flows, 'latency', async (f) => {
            const tokenId = await mintStep(quick, f, arbitrum, 'late')
            await sendStep(
                quick,
                f,
                arbitrum,
                { ...base, distillery: lateRpc },
                tokenId,
                0,
                (quick.histories.get(tokenId.toString()) ?? [])[0]
            )
        })
        expect(flows[0].steps[1].delivered).to.equal(true)
        expect(runStopped(quick)).to.equal(undefined)
    })

    it("reads the planned pathways' outbound nonce from the source endpoint and the peer as receiver", async function () {
        const [arbitrum, base, sepolia] = chains
        const flows: FlowRecord[] = []
        await runFlow(flows, 'one hop', (f) => pingPongFlow(ctx, f, arbitrum, base, 1))
        const pathways = await plannedPathways(chains, [
            { from: 'arbitrum-sepolia', to: 'base-sepolia' },
            { from: 'arbitrum-sepolia', to: 'sepolia' },
        ])
        expect(pathways.map((p) => p.outboundNonce)).to.deep.equal([1, 0])
        expect(pathways[0].to.address.toLowerCase()).to.equal(base.distillery.address.toLowerCase())
        expect(pathways[1].to.address.toLowerCase()).to.equal(sepolia.distillery.address.toLowerCase())
        await plannedPathways(chains, [{ from: 'base', to: 'base-sepolia' }]).then(
            () => expect.fail('an unknown network was accepted'),
            (e: Error) => expect(e.message).to.contain('not a network of the run')
        )
    })

    it('fails the flow and counts a verification failure when the gateway serves corrupt bytes', async function () {
        world.corruptSecondRead = true
        const flows: FlowRecord[] = []
        await runFlow(flows, 'local', (f) => localFlow(ctx, f, chains[0]))
        expect(flows[0].status).to.equal('FAIL')
        expect(flows[0].steps[0].verification?.content.status).to.equal('failed')
        expect(flows[0].steps[0].verification?.binding.status).to.equal('skipped')
        expect(summarize(flows).verificationFailures).to.equal(1)
    })

    it('waits for nextTokenId to pass the last id it minted when a lagging RPC still returns that id', async function () {
        const [arbitrum] = chains
        // nextTokenId from a backend that has not seen the last mint yet, for the next `stale` reads (seen on Sepolia).
        let stale = 0
        // ethers makes contract methods read-only, so the override is an own property over the real contract.
        const lagging = Object.create(arbitrum.distillery, {
            nextTokenId: {
                value: async () => {
                    const next = (await arbitrum.distillery.nextTokenId()) as BigNumber
                    return stale-- > 0 ? next.sub(1) : next
                },
            },
        }) as Chain['distillery']
        const chain: Chain = { ...arbitrum, distillery: lagging }

        const flows: FlowRecord[] = []
        await runFlow(flows, 'lag', async (f) => {
            await mintStep(ctx, f, chain, 'lag 1')
            stale = 1
            await mintStep(ctx, f, chain, 'lag 2')
        })
        expect(flows[0].status).to.equal('PASS')
        expect(flows[0].steps.filter((s) => s.step === 'mint')).to.have.length(2)
        expect(stale).to.be.below(0)
    })

    it('repeats a simulation that reverts with other arguments, as a lagging backend answers, before broadcasting', async function () {
        const [arbitrum] = chains
        const self = arbitrum.wallet.address
        const next = (await arbitrum.distillery.nextTokenId()) as BigNumber
        const wrong = next.add(1)
        const cid = 'lagging-backend'
        // The first answer is UnexpectedTokenId with other arguments, the way a backend behind the last mint answers.
        let calls = 0
        const result = await expectRevert(
            arbitrum,
            { name: 'UnexpectedTokenId', args: [wrong.toString(), next.toString()] },
            () => arbitrum.distillery.callStatic.mint(self, calls++ === 0 ? next.add(2) : wrong, cid),
            (overrides) => arbitrum.distillery.mint(self, wrong, cid, overrides)
        )
        expect(calls).to.equal(2)
        expect(result.checks.length).to.be.above(1)
        expect(result.checks.every((c) => c.ok)).to.equal(true)
        expect(await arbitrum.distillery.nextTokenId()).to.deep.equal(next)
    })

    it('keeps the hash of a transaction whose receipt never arrives, in the error and as a step', async function () {
        const [arbitrum] = chains
        // A provider whose receipt wait times out the way ethers does: code TIMEOUT, the duration, no hash.
        const silent = new Proxy(ethers.provider, {
            get(target, key) {
                if (key === 'waitForTransaction')
                    return async () => {
                        throw Object.assign(new Error('timeout exceeded'), { code: 'TIMEOUT', timeout: 1 })
                    }
                const value = Reflect.get(target, key)
                return typeof value === 'function' ? value.bind(target) : value
            },
        })
        const wallet = arbitrum.wallet.connect(silent)
        const impatient: Chain = { ...arbitrum, wallet, distillery: arbitrum.distillery.connect(wallet) }

        const flows: FlowRecord[] = []
        await runFlow(flows, 'timeout', async (f) => {
            await mintStep(ctx, f, impatient, 'timeout')
        })

        const hash = (await ethers.provider.getBlockWithTransactions('latest')).transactions[0].hash
        expect(flows[0].status).to.equal('FAIL')
        expect(flows[0].error).to.contain(hash)
        expect(flows[0].error).to.contain('may still be mined')
        expect(flows[0].steps.map((s) => [s.step, s.network, s.txHash])).to.deep.equal([
            ['submitted, no receipt seen', arbitrum.network, hash],
        ])
    })
    it('checkpoints both report types on SIGINT and prevents another transaction or pin', async function () {
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'idpp-interruption-'))
        const flows: FlowRecord[] = []
        const previousExitCode = process.exitCode
        const checkpoint = () => {
            writeReport(
                temp,
                ctx.runId,
                ctx.deploymentId,
                chains[0].wallet.address,
                [],
                flows,
                undefined,
                'flows',
                interruptedStatus(ctx)
            )
            writeLatencyReport(
                temp,
                ctx.runId,
                ctx.deploymentId,
                8,
                flows,
                undefined,
                ['arbitrum-sepolia -> base-sepolia'],
                interruptedStatus(ctx)
            )
        }
        const detach = installRunSignals(ctx, chains, flows, checkpoint)
        try {
            await runFlow(flows, 'interrupted local flow', async (flow) => {
                await mintStep(ctx, flow, chains[0], 'before interrupt')
                const pins = world.uploads
                process.emit('SIGINT')
                const snapshot = JSON.parse(
                    fs.readFileSync(path.join(temp, 'e2e_reports', `flows-${ctx.runId}.json`), 'utf8')
                )
                expect(snapshot.status).to.equal('interrupted')
                expect(snapshot.flows[0].steps[0].txHash).to.match(/^0x/)
                try {
                    await mintStep(ctx, flow, chains[0], 'must not pin or mint')
                } finally {
                    expect(world.uploads).to.equal(pins)
                }
            })
            expect(flows[0].status).to.equal('FAIL')
            expect((await chains[0].distillery.mintedCount()).toNumber()).to.equal(1)
            const latency = JSON.parse(
                fs.readFileSync(path.join(temp, 'e2e_reports', `latency-${ctx.runId}.json`), 'utf8')
            )
            expect(latency.status).to.equal('interrupted')
            expect(latency.directions[0].sent).to.equal(0)
        } finally {
            detach()
            process.exitCode = previousExitCode
            fs.rmSync(temp, { recursive: true, force: true })
        }
    })
    it('files an unsealed receipt on normal failure without promoting its costs to measurements', async function () {
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'idpp-unsealed-'))
        const chain = chains[1]
        const next = await chain.distillery.nextTokenId()
        const tx = await chain.distillery.mint(chain.wallet.address, next, 'test-cid')
        const receipt = await tx.wait()
        const provisional = { ...receipt, blockHash: ethers.constants.HashZero }
        const flows: FlowRecord[] = []
        try {
            await runFlow(flows, 'sealing timeout', async () => {
                throw new TxNotConfirmed(chain.network, tx.hash, 'receipt remained unsealed', false, provisional)
            })
            writeReport(temp, ctx.runId, ctx.deploymentId, chain.wallet.address, [], flows)
            const saved = JSON.parse(fs.readFileSync(path.join(temp, 'e2e_reports', `flows-${ctx.runId}.json`), 'utf8'))
            const step = saved.flows[0].steps[0]
            expect(saved.flows[0].status).to.equal('FAIL')
            expect(step.txHash).to.equal(tx.hash)
            expect(step.provisionalReceipt.blockHash).to.equal(ethers.constants.HashZero)
            expect(step.provisionalReceipt.logs).to.have.length(receipt.logs.length)
            for (const field of ['gasUsed', 'feeWei', 'effectiveGasPrice', 'blockNumber', 'blockTimestamp'])
                expect(step[field]).to.equal(undefined)
        } finally {
            fs.rmSync(temp, { recursive: true, force: true })
        }
    })
    it('keeps first receipt timing while replacing preconfirmation metadata with the sealed receipt', async function () {
        const original = chains[1]
        let firstObservedAt = 0
        let sealedReadReturnedAt = 0
        const provider = Object.create(original.wallet.provider, {
            waitForTransaction: {
                value: async (hash: string) => {
                    const receipt = await original.wallet.provider.waitForTransaction(hash)
                    firstObservedAt = Date.now()
                    return {
                        ...receipt,
                        blockHash: ethers.constants.HashZero,
                        blockNumber: 1,
                        gasUsed: BigNumber.from(1),
                        effectiveGasPrice: BigNumber.from(2),
                        logs: [],
                    }
                },
            },
            getTransactionReceipt: {
                value: async (hash: string) => {
                    await new Promise((resolve) => setTimeout(resolve, 60))
                    const receipt = await original.wallet.provider.getTransactionReceipt(hash)
                    sealedReadReturnedAt = Date.now()
                    return receipt
                },
            },
        })
        const instrumented = { ...original, wallet: original.wallet.connect(provider) }
        const next = await original.distillery.nextTokenId()
        const { receipt, measure } = await timedTx(instrumented, () =>
            original.distillery.mint(original.wallet.address, next, 'test-cid')
        )
        finishStep(
            { flow: 'receipt regression', status: 'PASS', steps: [] },
            { step: 'mint', network: original.network, checks: [], ...measure }
        )
        expect(measure.includedAtMs).to.be.at.least(firstObservedAt)
        expect(measure.includedAtMs).to.be.lessThan(sealedReadReturnedAt)
        expect(measure.blockNumber).to.equal(receipt.blockNumber).and.not.equal(1)
        expect(measure.blockTimestamp).to.be.a('number')
        expect(receipt.logs.length).to.be.greaterThan(0)
        expect(measure.gasUsed).to.equal(receipt.gasUsed.toString()).and.not.equal('1')
        expect(measure.feeWei).to.equal(receipt.gasUsed.mul(receipt.effectiveGasPrice).toString())
    })
    it('keeps interruption evidence provisional while the first receipt is unsealed', async function () {
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'idpp-unsealed-interrupt-'))
        const original = chains[1]
        const flows: FlowRecord[] = []
        let snapshot: any
        const provider = Object.create(original.wallet.provider, {
            waitForTransaction: {
                value: async (hash: string) => ({
                    ...(await original.wallet.provider.waitForTransaction(hash)),
                    blockHash: ethers.constants.HashZero,
                }),
            },
            getTransactionReceipt: {
                value: async (hash: string) => {
                    process.emit('SIGINT')
                    snapshot = JSON.parse(
                        fs.readFileSync(path.join(temp, 'e2e_reports', `flows-${ctx.runId}.json`), 'utf8')
                    )
                    return original.wallet.provider.getTransactionReceipt(hash)
                },
            },
        })
        const instrumented = { ...original, wallet: original.wallet.connect(provider) }
        const previousExitCode = process.exitCode
        const detach = installRunSignals(ctx, [instrumented], flows, () =>
            writeReport(
                temp,
                ctx.runId,
                ctx.deploymentId,
                original.wallet.address,
                [],
                flows,
                undefined,
                'flows',
                interruptedStatus(ctx)
            )
        )
        try {
            await runFlow(flows, 'interrupted sealing', async () => {
                const next = await original.distillery.nextTokenId()
                await timedTx(instrumented, () => original.distillery.mint(original.wallet.address, next, 'test-cid'))
            })
            const step = snapshot.flows[0].steps[0]
            expect(snapshot.status).to.equal('interrupted')
            expect(step.provisionalReceipt.blockHash).to.equal(ethers.constants.HashZero)
            expect(step.txHash).to.equal(step.provisionalReceipt.transactionHash)
            for (const field of ['gasUsed', 'feeWei', 'blockNumber', 'blockTimestamp'])
                expect(step[field]).to.equal(undefined)
        } finally {
            detach()
            process.exitCode = previousExitCode
            fs.rmSync(temp, { recursive: true, force: true })
        }
    })
    it('retains a confirmed tx in a signal checkpoint during post-receipt block reads', async function () {
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'idpp-confirmed-interrupt-'))
        const original = chains[0]
        const provider = Object.create(original.wallet.provider, {
            getBlock: {
                value: async (block: string | number) => {
                    if (typeof block === 'string' && block.startsWith('0x')) process.emit('SIGINT')
                    return original.wallet.provider.getBlock(block)
                },
            },
        })
        const instrumented = { ...original, wallet: original.wallet.connect(provider) }
        const flows: FlowRecord[] = []
        const previousExitCode = process.exitCode
        const detach = installRunSignals(ctx, [instrumented], flows, () => {
            writeReport(
                temp,
                ctx.runId,
                ctx.deploymentId,
                original.wallet.address,
                [],
                flows,
                undefined,
                'flows',
                interruptedStatus(ctx)
            )
        })
        try {
            await runFlow(flows, 'confirmed transaction', async () => {
                const next = await original.distillery.nextTokenId()
                await timedTx(instrumented, () => original.distillery.mint(original.wallet.address, next, 'test-cid'))
            })
            const snapshot = JSON.parse(
                fs.readFileSync(path.join(temp, 'e2e_reports', `flows-${ctx.runId}.json`), 'utf8')
            )
            expect(snapshot.status).to.equal('interrupted')
            expect(snapshot.flows[0].steps[0].txHash).to.match(/^0x/)
            expect(snapshot.flows[0].steps[0].gasUsed).to.match(/^\d+$/)
            expect(snapshot.flows[0].steps[0].step).to.equal('confirmed transaction, step unfinished')
        } finally {
            detach()
            process.exitCode = previousExitCode
            fs.rmSync(temp, { recursive: true, force: true })
        }
    })
})

describe('DS4 pipeline, offline dry run', function () {
    this.timeout(60_000)
    const world = newWorld()
    let restoreFetch: () => void
    before(() => {
        restoreFetch = installFakeFetch(world)
    })
    after(() => restoreFetch())

    it('puts three mints in one block and sends two tokens without pins', async function () {
        const [destination, source] = await deployMesh()
        const ctx = newCtx()
        const flow: FlowRecord = { flow: 'DS4', status: 'PASS', steps: [] }
        const ledger: LedgerRow[] = []
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ds4-dryrun-'))
        world.uploads = 0
        let mining = false
        let mines = 0
        await ethers.provider.send('evm_setAutomine', [false])
        const timer = setInterval(async () => {
            if (mining) return
            mining = true
            try {
                const submitted = flow.steps.filter(
                    (s) => s.step === (mines === 0 ? 'mint, submitted' : 'send, submitted')
                ).length
                if (submitted >= (mines === 0 ? 3 : 2)) {
                    await ethers.provider.send('evm_mine', [])
                    mines++
                }
            } finally {
                mining = false
            }
        }, 50)
        try {
            const result = await runScale(ctx, source, destination, 3, 2, flow, ledger, temp)
            expect(result.mints, flow.error).to.have.length(3)
            expect(result.sends).to.have.length(2)
            expect(result.mints.every((s) => s.blockNumber === result.mints[0].blockNumber)).to.equal(true)
            expect(result.sends.every((s) => s.blockNumber === result.sends[0].blockNumber)).to.equal(true)
            expect(result.sends.every((s) => s.delivered)).to.equal(true)
            expect(result.mints.map((step) => step.nonce)).to.deep.equal([
                result.mints[0].nonce,
                result.mints[0].nonce! + 1,
                result.mints[0].nonce! + 2,
            ])
            expect(result.sends.map((step) => step.nonce)).to.deep.equal([
                result.mints[0].nonce! + 3,
                result.mints[0].nonce! + 4,
            ])
            expect(world.uploads).to.equal(0)
            expect(ledger).to.have.length(3)
        } finally {
            clearInterval(timer)
            await ethers.provider.send('evm_setAutomine', [true])
            fs.rmSync(temp, { recursive: true, force: true })
        }
    })

    it('starts the first delivery poll before the second send receipt is returned', async function () {
        const [destination, original] = await deployMesh()
        const firstNonce = await original.wallet.getTransactionCount('pending')
        let secondReceiptReturnedAt = 0
        const provider = Object.create(original.wallet.provider, {
            waitForTransaction: {
                value: async (hash: string, confirms: number, timeout: number) => {
                    const receipt = await original.wallet.provider.waitForTransaction(hash, confirms, timeout)
                    const tx = await original.wallet.provider.getTransaction(hash)
                    if (tx.nonce === firstNonce + 3) {
                        await new Promise((resolve) => setTimeout(resolve, 2000))
                        secondReceiptReturnedAt = Date.now()
                    }
                    return receipt
                },
            },
        })
        const source = { ...original, wallet: original.wallet.connect(provider) }
        const ctx = newCtx()
        const flow: FlowRecord = { flow: 'DS4 independent waits', status: 'PASS', steps: [] }
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ds4-independent-waits-'))
        try {
            const result = await runScale(ctx, source, destination, 2, 2, flow, [], temp)
            expect(result.sends).to.have.length(2)
            expect(secondReceiptReturnedAt).to.be.greaterThan(0)
            expect(result.sends[0].firstPollAtSeconds! * 1000).to.be.lessThan(secondReceiptReturnedAt)
        } finally {
            fs.rmSync(temp, { recursive: true, force: true })
        }
    })

    it('keeps observing another hop after a terminal verdict without another destination read', async function () {
        const [originalDestination, originalSource] = await deployMesh()
        const firstId = await originalSource.distillery.nextTokenId()
        const firstNonce = await originalSource.wallet.getTransactionCount('pending')
        const provider = Object.create(originalSource.wallet.provider, {
            waitForTransaction: {
                value: async (hash: string, confirms: number, timeout: number) => {
                    const receipt = await originalSource.wallet.provider.waitForTransaction(hash, confirms, timeout)
                    const tx = await originalSource.wallet.provider.getTransaction(hash)
                    if (tx.nonce === firstNonce + 2) await new Promise((resolve) => setTimeout(resolve, 300))
                    return receipt
                },
            },
        })
        const source = { ...originalSource, wallet: originalSource.wallet.connect(provider) }
        let hiddenOnce = false
        const distillery = Object.create(originalDestination.distillery, {
            ownerOf: {
                value: async (tokenId: BigNumber) => {
                    const owner = await originalDestination.distillery.ownerOf(tokenId)
                    if (BigNumber.from(tokenId).eq(firstId) && !hiddenOnce) {
                        hiddenOnce = true
                        throw Object.assign(new Error('not yet visible'), {
                            code: 'CALL_EXCEPTION',
                            errorName: 'ERC721NonexistentToken',
                        })
                    }
                    return owner
                },
            },
        })
        const destination = { ...originalDestination, distillery }
        const ctx = newCtx()
        const flow: FlowRecord = { flow: 'DS4 terminal and delivery', status: 'PASS', steps: [] }
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ds4-terminal-hop-'))
        world.scan = 'FAILED'
        try {
            const result = await runScale(ctx, source, destination, 2, 2, flow, [], temp)
            expect(result.sends, flow.error).to.have.length(2)
            expect(result.sends[0].hopStop).to.equal('failed')
            expect(result.sends[0].delivered).to.equal(false)
            expect(result.sends[0].lateObservation).to.equal(undefined)
            expect(hiddenOnce).to.equal(true)
            expect(result.sends[0].deliverySecondsChain).to.equal(undefined)
            expect(result.sends[1].delivered).to.equal(true)
            expect(result.sends[1].received).not.to.equal(undefined)
            expect(flow.status).to.equal('FAIL')
            expect(flow.error).to.include('cannot be recalled')
        } finally {
            world.scan = 'DELIVERED'
            fs.rmSync(temp, { recursive: true, force: true })
        }
    })

    it('lets a final destination read win over no-record and stuck Scan verdicts', async function () {
        for (const scan of [404, 'CONFIRMING'] as const) {
            const [originalDestination, source] = await deployMesh()
            const tokenId = await source.distillery.nextTokenId()
            let hiddenOnce = false
            const distillery = Object.create(originalDestination.distillery, {
                ownerOf: {
                    value: async (id: BigNumber) => {
                        const owner = await originalDestination.distillery.ownerOf(id)
                        if (BigNumber.from(id).eq(tokenId) && !hiddenOnce) {
                            hiddenOnce = true
                            throw Object.assign(new Error('not yet visible'), {
                                code: 'CALL_EXCEPTION',
                                errorName: 'ERC721NonexistentToken',
                            })
                        }
                        return owner
                    },
                },
            })
            const destination = { ...originalDestination, distillery }
            const ctx = { ...newCtx(), scanGraceSeconds: 0, scanStuckSeconds: 0 }
            const flow: FlowRecord = { flow: 'DS4 final destination read', status: 'PASS', steps: [] }
            const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ds4-final-destination-'))
            world.scan = scan
            try {
                const result = await runScale(ctx, source, destination, 1, 1, flow, [], temp)
                expect(hiddenOnce).to.equal(true)
                expect(result.sends, flow.error).to.have.length(1)
                expect(result.sends[0].delivered).to.equal(true)
                expect(result.sends[0].hopStop).to.equal(undefined)
                expect(result.sends[0].deliverySecondsChain).to.be.a('number')
            } finally {
                world.scan = 'DELIVERED'
                fs.rmSync(temp, { recursive: true, force: true })
            }
        }
    })

    it('labels a sighting after a no-record stop as late without counting delivery', async function () {
        const [originalDestination, source] = await deployMesh()
        const tokenId = await source.distillery.nextTokenId()
        let hidden = 0
        const distillery = Object.create(originalDestination.distillery, {
            ownerOf: {
                value: async (id: BigNumber) => {
                    const owner = await originalDestination.distillery.ownerOf(id)
                    if (BigNumber.from(id).eq(tokenId) && hidden++ < 2)
                        throw Object.assign(new Error('not yet visible'), {
                            code: 'CALL_EXCEPTION',
                            errorName: 'ERC721NonexistentToken',
                        })
                    return owner
                },
            },
        })
        const destination = { ...originalDestination, distillery }
        const ctx = { ...newCtx(), scanGraceSeconds: 0 }
        const flow: FlowRecord = { flow: 'DS4 late observation', status: 'PASS', steps: [] }
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ds4-late-observation-'))
        world.scan = 404
        try {
            const result = await runScale(ctx, source, destination, 1, 1, flow, [], temp)
            expect(result.sends, flow.error).to.have.length(1)
            expect(result.sends[0].hopStop).to.equal('no record')
            expect(result.sends[0].delivered).to.equal(false)
            expect(result.sends[0].lateObservation?.method).to.equal('ownerOf')
            expect(result.sends[0].deliverySecondsChain).to.equal(undefined)
        } finally {
            world.scan = 'DELIVERED'
            fs.rmSync(temp, { recursive: true, force: true })
        }
    })

    it('files a locally signed hash when the broadcast RPC rejects', async function () {
        const [destination, original] = await deployMesh()
        const provider = Object.create(original.wallet.provider, {
            sendTransaction: {
                value: async () => {
                    throw Object.assign(new Error('RPC rejected'), { code: 'SERVER_ERROR' })
                },
            },
        })
        const source = { ...original, wallet: original.wallet.connect(provider) }
        const ctx = newCtx()
        const flow: FlowRecord = { flow: 'DS4 signed hash', status: 'PASS', steps: [] }
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ds4-rejected-broadcast-'))
        try {
            const result = await runScale(ctx, source, destination, 1, 1, flow, [], temp)
            expect(result.mints).to.have.length(0)
            expect(flow.steps).to.have.length(1)
            expect(flow.steps[0].txHash).to.match(/^0x[0-9a-f]{64}$/)
            expect(flow.steps[0].checks[0].ok).to.equal(false)
        } finally {
            fs.rmSync(temp, { recursive: true, force: true })
        }
    })

    it('recovers a minted token in the ledger when its step has no sealed receipt', async function () {
        const [chain] = await deployMesh()
        const ctx = newCtx()
        const tokenId = await chain.distillery.nextTokenId()
        const nonce = await chain.wallet.getTransactionCount('pending')
        await (await chain.distillery.mint(chain.wallet.address, tokenId, 'test-cid')).wait()
        const flow: FlowRecord = {
            flow: 'DS4 failed receipt',
            status: 'FAIL',
            steps: [
                {
                    step: 'mint, submitted',
                    network: chain.network,
                    tokenId: tokenId.toString(),
                    nonce,
                    txHash: '0x' + '1'.repeat(64),
                    checks: [{ name: 'sealed receipt', ok: false, detail: 'unsealed' }],
                },
            ],
        }
        const ledger: LedgerRow[] = []
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ds4-ledger-recovery-'))
        try {
            await reconcileMintLedger(ctx, chain, flow, ledger, temp, nonce, 1)
            expect(ledger).to.have.length(1)
            expect(ledger[0].tokenId).to.equal(tokenId.toString())
            expect(fs.readFileSync(path.join(temp, 'fixtures', 'ledger.md'), 'utf8')).to.include(tokenId.toString())
        } finally {
            fs.rmSync(temp, { recursive: true, force: true })
        }
    })

    it('continues ledger checks after RPC errors and notes a filed but absent mint', async function () {
        const [original] = await deployMesh()
        const ctx = newCtx()
        const minted = await original.distillery.nextTokenId()
        await (await original.distillery.mint(original.wallet.address, minted, 'test-cid')).wait()
        const unresolved = minted.add(10)
        const absent = minted.add(11)
        let failedReads = 0
        const distillery = Object.create(original.distillery, {
            ownerOf: {
                value: async (tokenId: BigNumber) => {
                    if (BigNumber.from(tokenId).eq(unresolved)) {
                        failedReads++
                        throw Object.assign(new Error('secret RPC URL'), { code: 'SERVER_ERROR' })
                    }
                    return original.distillery.ownerOf(tokenId)
                },
            },
        })
        const chain = { ...original, distillery }
        const nonce = 100
        const flow: FlowRecord = {
            flow: 'DS4 ledger RPC error',
            status: 'FAIL',
            steps: [unresolved, minted, absent].map((tokenId, index) => ({
                step: 'mint',
                network: chain.network,
                tokenId: tokenId.toString(),
                nonce: nonce + index,
                txHash: '0x' + String(index + 1).repeat(64),
                checks: [{ name: 'sealed receipt', ok: false, detail: 'unsealed' }],
            })),
        }
        const ledger: LedgerRow[] = [
            {
                tokenId: absent.toString(),
                network: chain.network,
                deploymentId: ctx.deploymentId,
                purpose: 'DS4 mint',
                runId: ctx.runId,
            },
        ]
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ds4-ledger-errors-'))
        const notes = new Map()
        const lines: string[] = []
        const originalLog = console.log
        try {
            appendLedger(temp, ledger)
            console.log = (...parts: unknown[]) => {
                lines.push(parts.map(String).join(' '))
            }
            await reconcileMintLedger(ctx, chain, flow, ledger, temp, nonce, 1, notes)
            console.log = originalLog
            expect(ledger.map((row) => row.tokenId)).to.include(minted.toString())
            expect(notes.get(unresolved.toString())).to.include({ state: 'unresolved', errorCode: 'SERVER_ERROR' })
            expect(failedReads).to.equal(3)
            expect(notes.get(absent.toString())).to.include({ state: 'absent' })
            expect(notes.get(absent.toString()).note).to.include('ledger row filed from first receipt')
            expect(JSON.stringify([...notes.values()])).not.to.include('secret RPC URL')
            expect(lines.some((line) => line.includes('DS4 reconcile start: 3 broadcast mint ids'))).to.equal(true)
            expect(lines.filter((line) => line.includes('DS4 reconcile token '))).to.have.length(3)
            expect(lines.some((line) => line.includes('DS4 reconcile end: 3 broadcast mint ids'))).to.equal(true)
        } finally {
            console.log = originalLog
            fs.rmSync(temp, { recursive: true, force: true })
        }
    })

    it('stops before sends when a failed mint cannot be reconciled', async function () {
        const [destination, original] = await deployMesh()
        const ctx = newCtx()
        let reads = 0
        const distillery = Object.create(original.distillery, {
            ownerOf: {
                value: async (tokenId: BigNumber) => {
                    if (++reads > 1) throw Object.assign(new Error('RPC unavailable'), { code: 'SERVER_ERROR' })
                    const owner = await original.distillery.ownerOf(tokenId)
                    const bytes = ctx.verify.cache.values().next().value as Uint8Array
                    bytes[0] ^= 1 // A prompt content failure leaves a mined but failed step for reconciliation.
                    return owner
                },
            },
        })
        const source = { ...original, distillery }
        const flow: FlowRecord = { flow: 'DS4 unresolved mint', status: 'PASS', steps: [] }
        const notes = new Map()
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ds4-unresolved-mint-'))
        try {
            const result = await runScale(ctx, source, destination, 1, 1, flow, [], temp, undefined, notes)
            expect(result.mints).to.have.length(1)
            expect(result.mints[0].checks.some((item) => !item.ok)).to.equal(true)
            expect(result.sends).to.have.length(0)
            expect(flow.error).to.include('manual chain check required before sends')
            expect([...notes.values()][0]).to.include({ state: 'unresolved', errorCode: 'SERVER_ERROR' })
        } finally {
            fs.rmSync(temp, { recursive: true, force: true })
        }
    })

    it('does not reread ownerOf for a verified mint before sends', async function () {
        const [destination, original] = await deployMesh()
        let reads = 0
        const distillery = Object.create(original.distillery, {
            ownerOf: {
                value: async (tokenId: BigNumber) => {
                    const owner = await original.distillery.ownerOf(tokenId)
                    if (++reads > 1) throw Object.assign(new Error('RPC unavailable'), { code: 'SERVER_ERROR' })
                    return owner
                },
            },
        })
        const source = { ...original, distillery }
        const ctx = newCtx()
        const flow: FlowRecord = { flow: 'DS4 verified mint', status: 'PASS', steps: [] }
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ds4-verified-mint-'))
        try {
            const result = await runScale(ctx, source, destination, 1, 1, flow, [], temp)
            expect(result.mints).to.have.length(1)
            expect(result.mints[0].checks.every((item) => item.ok)).to.equal(true)
            expect(result.sends, flow.error).to.have.length(1)
            expect(result.sends[0].delivered).to.equal(true)
        } finally {
            fs.rmSync(temp, { recursive: true, force: true })
        }
    })

    it('uses the supplied nonce state without a second latest read', async function () {
        const [destination, original] = await deployMesh()
        const startNonce = await original.wallet.getTransactionCount('pending')
        const provider = Object.create(original.wallet.provider, {
            getTransactionCount: {
                value: async (address: string, blockTag: string) => {
                    if (blockTag === 'latest') throw new Error('second latest read')
                    return original.wallet.provider.getTransactionCount(address, blockTag)
                },
            },
        })
        const source = { ...original, wallet: original.wallet.connect(provider) }
        const ctx = newCtx()
        const flow: FlowRecord = { flow: 'DS4 nonce reuse', status: 'PASS', steps: [] }
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ds4-nonce-reuse-'))
        try {
            const result = await runScale(ctx, source, destination, 1, 1, flow, [], temp, startNonce)
            expect(result.mints).to.have.length(1)
            expect(result.sends).to.have.length(1)
        } finally {
            fs.rmSync(temp, { recursive: true, force: true })
        }
    })

    it('keeps the legacy one-hash checkpoint and all opt-in scale hashes', async function () {
        const [original] = await deployMesh()
        const provider = Object.create(original.wallet.provider, {
            waitForTransaction: {
                value: async () => {
                    throw Object.assign(new Error('mock timeout'), { code: 'TIMEOUT' })
                },
            },
        })
        const chain = { ...original, wallet: original.wallet.connect(provider) }
        const ctx = newCtx()
        const flows: FlowRecord[] = [{ flow: 'pending', status: 'PASS', steps: [] }]
        const previousExitCode = process.exitCode
        const detach = installRunSignals(ctx, [chain], flows, () => undefined)
        const hash = (n: number) => '0x' + n.toString(16).padStart(64, '0')
        try {
            await Promise.all([1, 2].map((n) => waitReceipt(chain, { hash: hash(n) } as any).catch(() => undefined)))
            process.emit('SIGINT')
            expect(flows[0].steps.map((step) => step.txHash)).to.deep.equal([hash(2)])
        } finally {
            detach()
            process.exitCode = previousExitCode
        }
        const scaleCtx = newCtx()
        const scaleFlows: FlowRecord[] = [{ flow: 'scale pending', status: 'PASS', steps: [] }]
        const scaleDetach = installRunSignals(scaleCtx, [chain], scaleFlows, () => undefined)
        try {
            await Promise.all(
                [3, 4].map((n) =>
                    waitReceipt(chain, { hash: hash(n) } as any, true, undefined, { allPending: true }).catch(
                        () => undefined
                    )
                )
            )
            process.emit('SIGINT')
            expect(scaleFlows[0].steps.map((step) => step.txHash)).to.deep.equal([hash(3), hash(4)])
        } finally {
            scaleDetach()
            process.exitCode = previousExitCode
        }
    })
})
