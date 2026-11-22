import { installRunSignals, interruptedStatus, runStopped as stoppedRun } from './flows'
import { BigNumber, ContractReceipt, Wallet, ethers } from 'ethers'
import { task, types } from 'hardhat/config'

import { LedgerRow, appendLedger, maxLengthCid } from './fixtures'
import {
    Chain,
    Ctx,
    approveStep,
    expectRevert,
    finishStep,
    historyOf,
    log,
    mintRawStep,
    mintStep,
    nextIdAfterLastMint,
    nextIdAfterRefusal,
    runFlow,
    runStopped,
    sendStep,
    setupRun,
    staleFlow,
    transferStep,
    DEFAULT_MAX_SEND_FEE,
} from './flows'
import { maxCidPairs } from './fees'
import { MAX_CID_FLOW } from './edge-report'
import { deriveOperator, edgeTopUpTransactions, fundOperator, operatorOn } from './operator'
import { canonicalizeEnvelope, buildEnvelope, caskData, computeCidV1 } from './payload'
import { ENDPOINT_ABI, ENDPOINT_IFACE, decodePacket } from './packet'
import { Check, FlowRecord, summarize, summaryLine, writeReport } from './report'
import { decodeRevert, formatRevert } from './reverts'

// DS3 of docs/evaluation/PROTOCOL.md: edge cases on chain (e2e:edge), each `repeats` times per chain (default once: the
// rules are deterministic and every chain runs the same compiled source, so a repetition adds cost, not evidence).
//
//   non-owner configuration        the second account calls setIssuer, setPeer, setEnforcedOptions and setBaseURI
//                                  (OwnableUnauthorizedAccount) and lzReceive on the contract (OnlyEndpoint): eth_call only
//   non-issuer mint                a second account calls `mint`: NotIssuer, mined and reverted
//   holder revise                  a token is minted to the second account, which revises it: NotIssuer, mined and
//                                  reverted (holding a token gives no right to its passport)
//   approved-operator transferFrom the holder approves the second account, which moves the token with `transferFrom`;
//                                  the new holder's `revise` reverts NotIssuer (eth_call, in the transfer step)
//   stale and wrong id             the `stale` flow: StaleRevision and UnexpectedTokenId, mined and reverted
//   maximum-length CID             a 96-byte CID string delivered to another chain (receive-gas headroom)
//   replay                         the packet of that delivery executed again: LZ_PayloadHashNotFound

const ZERO32 = ethers.constants.HashZero

/** A payload for an id that is never uploaded: only its CID is needed, as a plausible argument of a call that must revert. */
const unpinnedCid = (ctx: Ctx, tokenId: BigNumber, what: string) =>
    computeCidV1(
        canonicalizeEnvelope(
            buildEnvelope({
                deploymentId: ctx.deploymentId,
                tokenId: tokenId.toBigInt(),
                revision: 0,
                previousCid: null,
                data: caskData(tokenId.toString(), `${what} (run ${ctx.runId})`),
            })
        )
    )

async function nonIssuerMint(ctx: Ctx, flow: FlowRecord, chain: Chain, operator: Chain) {
    const next = await nextIdAfterLastMint(ctx, chain)
    const cid = unpinnedCid(ctx, next, 'non-issuer mint')
    const who = operator.wallet.address
    const result = await expectRevert(
        chain,
        { name: 'NotIssuer', args: [who] },
        () => operator.distillery.callStatic.mint(who, next, cid),
        (overrides) => operator.distillery.mint(who, next, cid, overrides)
    )
    const after = await nextIdAfterRefusal(chain, next)
    finishStep(flow, {
        step: 'mint (not an issuer)',
        network: chain.network,
        txHash: result.txHash,
        gasUsed: result.gasUsed,
        outcome: `expected revert ${result.outcome}`,
        checks: [
            ...result.checks,
            { name: 'nextTokenId unchanged', ok: after.eq(next), detail: `${after} == ${next}` },
        ],
    })
}

/**
 * The owner-only configuration and the endpoint-only receive refuse any other caller. These are eth_calls: the state they
 * would change is the trust configuration, which no measurement needs a receipt of, so no gas is spent on them.
 */
async function nonOwnerConfiguration(flow: FlowRecord, chain: Chain, operator: Chain) {
    const who = operator.wallet.address
    const d = operator.distillery
    const calls: [string, string, () => Promise<unknown>][] = [
        ['setIssuer', 'OwnableUnauthorizedAccount', () => d.callStatic.setIssuer(who, true)],
        [
            'setPeer',
            'OwnableUnauthorizedAccount',
            () => d.callStatic.setPeer(chain.eid, ethers.utils.hexZeroPad(who, 32)),
        ],
        ['setEnforcedOptions', 'OwnableUnauthorizedAccount', () => d.callStatic.setEnforcedOptions([])],
        ['setBaseURI', 'OwnableUnauthorizedAccount', () => d.callStatic.setBaseURI('ipfs://forged/')],
        [
            'lzReceive',
            'OnlyEndpoint',
            () =>
                d.callStatic.lzReceive(
                    { srcEid: chain.eid, sender: ethers.utils.hexZeroPad(who, 32), nonce: 1 },
                    ZERO32,
                    '0x',
                    who,
                    '0x'
                ),
        ],
    ]
    const checks: Check[] = []
    for (const [fn, error, call] of calls) {
        let outcome = 'call did not revert'
        let ok = false
        try {
            await call()
        } catch (e) {
            const decoded = decodeRevert(chain.distillery.interface, e)
            outcome = decoded != null ? formatRevert(decoded) : `no decodable custom error: ${(e as Error).message}`
            ok = decoded?.name === error && decoded.args.length === 1 && decoded.args[0] === who
        }
        checks.push({
            name: `${fn} by the second account: eth_call reverts with ${error}(${who})`,
            ok,
            detail: outcome,
        })
    }
    finishStep(flow, {
        step: 'configuration and receive (not the owner, not the endpoint)',
        network: chain.network,
        // no `outcome`: a step with one counts as a broadcast revert, and these are eth_calls
        checks,
    })
}

/** The holder's `revise` must revert on chain, not only in an eth_call: only an issuer writes the passport. */
async function holderRevise(ctx: Ctx, flow: FlowRecord, holder: Chain, tokenId: BigNumber, revision: number) {
    const who = holder.wallet.address
    // NotIssuer comes before any token check, so the step must show that `who` really holds the token.
    const owner = (await holder.distillery.ownerOf(tokenId)) as string
    const cid = unpinnedCid(ctx, tokenId, 'holder revise')
    const result = await expectRevert(
        holder,
        { name: 'NotIssuer', args: [who] },
        () => holder.distillery.callStatic.revise(tokenId, revision, cid),
        (overrides) => holder.distillery.revise(tokenId, revision, cid, overrides)
    )
    finishStep(flow, {
        step: 'revise (holder, not an issuer)',
        network: holder.network,
        txHash: result.txHash,
        gasUsed: result.gasUsed,
        outcome: `expected revert ${result.outcome}`,
        checks: [
            { name: 'the caller holds the token', ok: owner === who, detail: `ownerOf ${owner}` },
            ...result.checks,
        ],
    })
}

/**
 * Executes the packet of a delivered send once more on the destination endpoint. The packet is read from the
 * `PacketSent` event of the send transaction, so it is the delivered payload byte for byte. It must revert: the
 * endpoint cleared the payload hash when the first execution succeeded.
 */
export async function replayStep(
    flow: FlowRecord,
    source: Chain,
    destination: Chain,
    sendReceipt: ContractReceipt
): Promise<void> {
    const sourceEndpoint = (await source.distillery.endpoint()) as string
    const sent = sendReceipt.logs.find(
        (l) =>
            l.address.toLowerCase() === sourceEndpoint.toLowerCase() &&
            l.topics[0] === ENDPOINT_IFACE.getEventTopic('PacketSent')
    )
    if (sent == null) throw new Error(`no PacketSent in ${sendReceipt.transactionHash}`)
    const packet = decodePacket(ENDPOINT_IFACE.parseLog(sent).args.encodedPayload as string)
    const destinationEndpoint = new ethers.Contract(
        (await destination.distillery.endpoint()) as string,
        ENDPOINT_ABI,
        destination.wallet
    )
    const origin = { srcEid: packet.srcEid, sender: packet.sender, nonce: packet.nonce }
    const receiver = destination.distillery.address
    const stored: string = await destinationEndpoint.inboundPayloadHash(
        receiver,
        packet.srcEid,
        packet.sender,
        packet.nonce
    )
    const payloadHash = ethers.utils.keccak256(ethers.utils.concat([packet.guid, packet.message]))
    log(`[${destination.network}] replay of guid ${packet.guid}`)
    const result = await expectRevert(
        destination,
        { name: 'LZ_PayloadHashNotFound', args: [ZERO32, payloadHash] },
        () => destinationEndpoint.callStatic.lzReceive(origin, receiver, packet.guid, packet.message, '0x'),
        (overrides) => destinationEndpoint.lzReceive(origin, receiver, packet.guid, packet.message, '0x', overrides),
        ENDPOINT_IFACE
    )
    finishStep(flow, {
        step: `replay of ${source.network} -> ${destination.network}`,
        network: destination.network,
        txHash: result.txHash,
        gasUsed: result.gasUsed,
        outcome: `expected revert ${result.outcome}`,
        checks: [
            {
                name: 'the delivered payload hash was cleared',
                ok: stored === ZERO32,
                detail: `inboundPayloadHash ${stored}`,
            },
            ...result.checks,
        ],
    })
}

/** The sends of the maximum-length CID case: one per destination, from the cheapest other chain (none with one chain). */
const maxCidSends = (networks: readonly string[]) =>
    networks.length < 2
        ? []
        : maxCidPairs(networks.map((network) => ({ network }))).map((p) => ({
              from: p.source.network,
              to: p.destination.network,
          }))

export async function edgeChainFlows(
    ctx: Ctx,
    flows: FlowRecord[],
    chain: Chain,
    operator: Wallet,
    repeats: number,
    ledger: LedgerRow[]
): Promise<void> {
    const net = chain.network
    const asOperator = operatorOn(chain, operator)
    const note = (tokenId: BigNumber | string, what: string) =>
        ledger.push({
            tokenId: tokenId.toString(),
            network: net,
            deploymentId: ctx.deploymentId,
            purpose: `DS3 ${what}`,
            runId: ctx.runId,
        })

    // A mint that is mined is entered in the ledger even if a later read of the step throws: the token exists.
    const mintNoted = async (
        flow: FlowRecord,
        what: string,
        ...args: Parameters<typeof mintStep> extends [unknown, unknown, unknown, ...infer R] ? R : never
    ) => {
        flow.tokenId = undefined
        try {
            return await mintStep(ctx, flow, chain, ...args)
        } finally {
            if (flow.tokenId != null) note(flow.tokenId, what)
        }
    }

    await runFlow(flows, `edge non-owner configuration ${net}`, async (flow) => {
        for (let i = 0; i < repeats; i++) await nonOwnerConfiguration(flow, chain, asOperator)
    })

    await runFlow(flows, `edge non-issuer mint ${net}`, async (flow) => {
        for (let i = 0; i < repeats; i++) await nonIssuerMint(ctx, flow, chain, asOperator)
    })

    await runFlow(flows, `edge holder revise ${net}`, async (flow) => {
        for (let i = 0; i < repeats; i++) {
            const tokenId = await mintNoted(flow, 'holder revise', `edge holder revise ${i + 1}`, operator.address, {
                step: 'mint (setup)',
            })
            await holderRevise(ctx, flow, asOperator, tokenId, 0)
        }
    })

    await runFlow(flows, `edge approved-operator transferFrom ${net}`, async (flow) => {
        for (let i = 0; i < repeats; i++) {
            const tokenId = await mintNoted(
                flow,
                'approved-operator transferFrom',
                `edge approved-operator transferFrom ${i + 1}`,
                chain.wallet.address,
                { step: 'mint (setup)' }
            )
            await approveStep(ctx, flow, chain, tokenId, operator.address)
            const cid = historyOf(ctx, tokenId)[0]
            await transferStep(ctx, flow, asOperator, tokenId, 0, cid, Wallet.createRandom().address, 'transferFrom')
        }
    })

    for (let i = 0; i < repeats; i++) {
        await runFlow(flows, `edge stale revision and wrong id ${net} (${i + 1})`, (flow) =>
            staleFlow(ctx, flow, chain)
        )
        const stale = flows[flows.length - 1]
        if (stale.tokenId != null) note(stale.tokenId, 'stale revision and wrong id')
    }
}

/** The maximum-length CID delivered from `source` to `destination`, then replayed. */
export async function maxCidFlow(
    ctx: Ctx,
    flows: FlowRecord[],
    source: Chain,
    destination: Chain,
    repeats: number,
    ledger: LedgerRow[],
    options: { replay?: boolean } = {}
): Promise<void> {
    await runFlow(flows, `${MAX_CID_FLOW} ${source.network} -> ${destination.network}`, async (flow) => {
        for (let i = 0; i < repeats; i++) {
            const cid = maxLengthCid()
            flow.tokenId = undefined
            let tokenId: BigNumber
            try {
                tokenId = await mintRawStep(ctx, flow, source, cid)
            } finally {
                if (flow.tokenId != null)
                    ledger.push({
                        tokenId: flow.tokenId,
                        network: source.network,
                        deploymentId: ctx.deploymentId,
                        purpose: 'DS3 maximum-length CID (no payload), sent and replayed',
                        runId: ctx.runId,
                    })
            }
            const receipt = await sendStep(ctx, flow, source, destination, tokenId, 0, cid, { verify: false })
            if (options.replay ?? true) await replayStep(flow, source, destination, receipt)
        }
    })
}

task('e2e:edge', 'DS3: authorisation, concurrency, maximum-length CID and replay cases on chain')
    .addOptionalParam('networks', 'Comma-separated networks', 'arbitrum-sepolia,base-sepolia,sepolia', types.string)
    .addOptionalParam('repeats', 'Observations of each case', 1, types.int)
    .addOptionalParam('timeout', 'Seconds to wait for each cross-chain delivery', 1800, types.int)
    .addOptionalParam('window', 'Label of the observation window recorded in the run header', undefined, types.string)
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
                repeats: number
                timeout: number
                window?: string
                maxSendFee: string
                allowUnknownScan: boolean
            },
            hre
        ) => {
            if (args.repeats < 1) throw new Error('--repeats must be at least 1')
            const runId = String(Date.now())
            const { ctx, chains, header } = await setupRun(hre, args.networks.split(','), args.timeout, runId, {
                window: args.window,
                maxSendFee: args.maxSendFee,
                allowUnknownScan: args.allowUnknownScan,
                params: { networks: args.networks, repeats: args.repeats, timeout: args.timeout },
                // The maximum-length CID is the only send; its sources are the cheapest other chain per destination.
                sends: maxCidSends(args.networks.split(',').map((n) => n.trim())),
            })
            const operator = deriveOperator(chains[0].wallet)
            log(`Second account (approved operator, non-owner): ${operator.address}`)

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
                    'edge',
                    interruptedStatus(ctx)
                )
            }
            const detach = installRunSignals(ctx, chains, flows, checkpoint)
            // Whatever finished is written even if a later chain cannot be funded or an RPC dies: the tokens exist and the funds are spent.
            try {
                for (const chain of chains) {
                    if (stoppedRun(ctx)) break
                    const funded = await fundOperator(chain, operator, edgeTopUpTransactions(args.repeats))
                    if (!funded.isZero()) log(`[${chain.network}] funded the second account with ${funded} wei`)
                    await edgeChainFlows(ctx, flows, chain, operator, args.repeats, ledger)
                }
                // Every chain is the destination of the maximum-length CID once; the source is the cheapest other chain to send from.
                if (chains.length > 1) {
                    for (const { source, destination } of maxCidPairs(chains)) {
                        // After a Scan stop no further delivery is started (PROTOCOL.md, early stop); the case is
                        // still entered, with no step, so the DS3 table shows it as planned and not run.
                        const stopped = runStopped(ctx)
                        if (stopped != null) {
                            flows.push({
                                flow: `${MAX_CID_FLOW} ${source.network} -> ${destination.network}`,
                                status: 'FAIL',
                                error: `not started: the run stopped sending after ${stopped}`,
                                steps: [],
                            })
                            continue
                        }
                        await maxCidFlow(ctx, flows, source, destination, args.repeats, ledger)
                    }
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
        }
    )
