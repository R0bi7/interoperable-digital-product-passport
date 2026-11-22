import { installRunSignals, interruptedStatus, runStopped as stoppedRun } from './flows'
import { BigNumber, Wallet } from 'ethers'
import { task, types } from 'hardhat/config'

import { LedgerRow, appendLedger } from './fixtures'
import { Chain, Ctx, historyOf, log, mintStep, reviseNow, runFlow, setupRun, transferStep } from './flows'
import { FlowRecord, summarize, summaryLine, writeReport } from './report'

// DS1 of docs/evaluation/PROTOCOL.md: single operations on one chain, `repeats` observations of each (e2e:ops).
// The operations are those of the thesis's cost and speed tables (mint, revise, transfer); authorisation cases are DS3's.
//
//   mint      `repeats` mints by the issuer to its own account
//   revise    the first of those tokens revised `repeats` times by the issuer, so revision depths 1 to `repeats` each occur once
//   transfer  each of those tokens moved by its holder with `transferFrom` to a fresh address (a new holder's balance slot)
//
// Every step is measured by the instrumentation of flows.ts (fee, block times, payload size, slot state). The pins are
// real: `repeats` x 2 per chain.

const purpose = (what: string) => `DS1 ${what}`

export async function opsChainFlows(
    ctx: Ctx,
    flows: FlowRecord[],
    chain: Chain,
    repeats: number,
    ledger: LedgerRow[]
): Promise<void> {
    const net = chain.network
    const own: BigNumber[] = []

    await runFlow(flows, `ops mint ${net}`, async (flow) => {
        for (let i = 0; i < repeats; i++) {
            flow.tokenId = undefined
            // A mint that is mined is entered in the ledger even if a later read of the same step throws: the token exists.
            try {
                own.push(await mintStep(ctx, flow, chain, `ops mint ${i + 1}`))
            } finally {
                if (flow.tokenId != null)
                    ledger.push({
                        tokenId: String(flow.tokenId),
                        network: net,
                        deploymentId: ctx.deploymentId,
                        purpose: purpose(i === 0 ? `mint, revise depth 1 to ${repeats}, transfer` : 'mint, transfer'),
                        runId: ctx.runId,
                    })
            }
        }
    })

    await runFlow(flows, `ops revise ${net}`, async (flow) => {
        if (own.length === 0) throw new Error('no minted token to revise')
        for (let i = 0; i < repeats; i++) await reviseNow(ctx, flow, chain, own[0], `ops revise depth ${i + 1}`)
    })

    await runFlow(flows, `ops transfer ${net}`, async (flow) => {
        for (const tokenId of own) {
            const history = historyOf(ctx, tokenId)
            await transferStep(
                ctx,
                flow,
                chain,
                tokenId,
                history.length - 1,
                history[history.length - 1],
                Wallet.createRandom().address,
                'transferFrom'
            )
        }
    })
}

task('e2e:ops', 'DS1: repeated single operations (mint, revise, transfer) on each chain')
    .addOptionalParam('networks', 'Comma-separated networks', 'arbitrum-sepolia,base-sepolia,sepolia', types.string)
    .addOptionalParam('repeats', 'Observations of each operation per chain', 10, types.int)
    .addOptionalParam('window', 'Label of the observation window recorded in the run header', undefined, types.string)
    .setAction(async (args: { networks: string; repeats: number; window?: string }, hre) => {
        if (args.repeats < 1) throw new Error('--repeats must be at least 1')
        const runId = String(Date.now())
        const { ctx, chains, header } = await setupRun(hre, args.networks.split(','), 60, runId, {
            window: args.window,
            params: { networks: args.networks, repeats: args.repeats },
        })

        const flows: FlowRecord[] = []
        const ledger: LedgerRow[] = []
        let report = ''
        const checkpoint = () => {
            appendLedger(hre.config.paths.root, ledger)
            const deployments = chains.map((c) => ({
                network: c.network,
                chainId: c.chainId,
                eid: c.eid,
                address: c.distillery.address,
            }))
            report = writeReport(
                hre.config.paths.root,
                runId,
                ctx.deploymentId,
                chains[0].wallet.address,
                deployments,
                flows,
                header,
                'ops',
                interruptedStatus(ctx)
            )
        }
        const detach = installRunSignals(ctx, chains, flows, checkpoint)
        // Whatever finished is written even if an RPC dies on a later chain: the tokens exist and the funds are spent.
        try {
            for (const chain of chains) {
                if (stoppedRun(ctx)) break
                await opsChainFlows(ctx, flows, chain, args.repeats, ledger)
            }
        } finally {
            try {
                checkpoint()
            } finally {
                detach()
            }
        }
        const summary = summarize(flows)
        log(`${summaryLine(summary)}. Report: ${report}`)
        if (summary.failed > 0 || summary.verificationFailures > 0) process.exitCode = 1
    })
