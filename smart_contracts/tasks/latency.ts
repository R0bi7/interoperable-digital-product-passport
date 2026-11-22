import { task, types } from 'hardhat/config'

import {
    Chain,
    Ctx,
    historyOf,
    log,
    mintStep,
    runFlow,
    runStopped,
    sendStep,
    setupRun,
    DEFAULT_MAX_SEND_FEE,
    installRunSignals,
    interruptedStatus,
} from './flows'
import { LedgerRow, appendLedger } from './fixtures'
import { writeLatencyReport } from './latency-report'
import { allPairs } from './lz-scan'
import { FlowRecord } from './report'

// Repeated cross-chain sends for latency statistics (e2e:latency).
//
// One token per pair of chains is minted on the first chain and then sent back and forth `hops` times without a
// revision in between, so every observation is the same operation: send(tokenId) from A, wait until the token appears
// on B. Each hop goes through the same sendStep as the core flows, so every delivery is also checked and its payload
// verified (content, binding, history). Two delivery clocks are recorded and never pooled (docs/evaluation/PROTOCOL.md,
// rule 2): the primary one runs from the block timestamp of the source `ONFTSent` to the block timestamp of the
// destination `ONFTReceived`; the continuity one runs from the block timestamp of the send to the first 5 s poll that
// sees the token (about 5 s resolution, up to one poll interval of overshoot). Both end at first inclusion, not at
// finality. `--window` labels the observation window in the run header.

/** Mints on `a`, then sends the token `hops` times, alternating a -> b and b -> a. */
export async function pingPongFlow(ctx: Ctx, flow: FlowRecord, a: Chain, b: Chain, hops: number) {
    const label = `latency ${a.network} <-> ${b.network}`
    const tokenId = await mintStep(ctx, flow, a, label)
    const cid = historyOf(ctx, tokenId)[0]
    for (let i = 0; i < hops; i++) {
        const [source, destination] = i % 2 === 0 ? [a, b] : [b, a]
        await sendStep(ctx, flow, source, destination, tokenId, 0, cid)
    }
}

task('e2e:latency', 'Sends one token back and forth between chains and reports delivery-time statistics')
    .addOptionalParam(
        'networks',
        'Comma-separated networks; every pair is measured',
        'arbitrum-sepolia,base-sepolia,sepolia',
        types.string
    )
    .addOptionalParam(
        'hops',
        'Sends per pair, alternating direction; use an even number (the protocol uses 8)',
        8,
        types.int
    )
    .addOptionalParam('timeout', 'Seconds to wait for each cross-chain delivery', 1800, types.int)
    .addOptionalParam(
        'window',
        'Label of the observation window (UTC start, for example 2026-10-20T08:00Z) recorded in the report',
        undefined,
        types.string
    )
    .addOptionalParam(
        'maxSendFee',
        'Refuse a send quoted above this fee, in the native coin of the source chain',
        DEFAULT_MAX_SEND_FEE,
        types.string
    )
    .addFlag('allowUnknownScan', 'Explicitly allow an unknown Scan preflight')
    .setAction(
        async (
            args: {
                networks: string
                hops: number
                timeout: number
                window?: string
                maxSendFee: string
                allowUnknownScan: boolean
            },
            hre
        ) => {
            if (args.hops < 2 || args.hops % 2 !== 0) throw new Error('--hops must be an even number of at least 2')
            const runId = String(Date.now())
            const { ctx, chains, header } = await setupRun(hre, args.networks.split(','), args.timeout, runId, {
                window: args.window,
                allowUnknownScan: args.allowUnknownScan,
                maxSendFee: args.maxSendFee,
                params: {
                    networks: args.networks,
                    hops: args.hops,
                    timeout: args.timeout,
                    allowUnknownScan: args.allowUnknownScan,
                },
                sends: allPairs(args.networks.split(',').map((n) => n.trim())),
            })
            if (chains.length < 2) throw new Error('--networks needs at least two networks')

            const flows: FlowRecord[] = []
            const ledger: LedgerRow[] = []
            const planned = allPairs(chains.map((c) => c.network)).map((p) => `${p.from} -> ${p.to}`)
            let report = ''
            const checkpoint = () => {
                report = writeLatencyReport(
                    hre.config.paths.root,
                    runId,
                    ctx.deploymentId,
                    args.hops,
                    flows,
                    header,
                    planned,
                    interruptedStatus(ctx)
                )
            }
            const detach = installRunSignals(ctx, chains, flows, checkpoint)
            // The token of a pair is entered even if a hop failed: a stranded token stays where it is (rule 8).
            try {
                // After a send LayerZero did not pick up, no further pair is started (PROTOCOL.md, early stop).
                for (let i = 0; i < chains.length && runStopped(ctx) == null; i++) {
                    for (let j = i + 1; j < chains.length && runStopped(ctx) == null; j++) {
                        const [a, b] = [chains[i], chains[j]]
                        await runFlow(flows, `latency ${a.network} <-> ${b.network}`, (flow) =>
                            pingPongFlow(ctx, flow, a, b, args.hops)
                        )
                        const flow = flows[flows.length - 1]
                        if (flow.tokenId != null) {
                            const row: LedgerRow = {
                                tokenId: flow.tokenId,
                                network: a.network,
                                deploymentId: ctx.deploymentId,
                                purpose: `DS2 ping-pong ${a.network} <-> ${b.network}, ${args.hops} hops, window ${args.window ?? 'unlabelled'}`,
                                runId,
                            }
                            ledger.push(row)
                            // Written at once, so a killed run still has the rows of the pairs that finished.
                            appendLedger(hre.config.paths.root, [row])
                        }
                    }
                }
            } finally {
                try {
                    appendLedger(hre.config.paths.root, ledger)
                    checkpoint()
                } finally {
                    detach()
                }
            }
            const failed = flows.filter((flow) => flow.status === 'FAIL').length
            log(`${flows.length} pairs, ${failed} failed. Report: ${report}`)
            const stopped = runStopped(ctx)
            if (stopped != null) log(`Stopped after ${stopped}; the pairs after it were not started`)
            if (failed > 0) process.exitCode = 1
        }
    )
