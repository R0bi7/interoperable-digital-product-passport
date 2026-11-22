import { BigNumber, ContractReceipt, ethers } from 'ethers'
import { task, types } from 'hardhat/config'

import {
    Chain,
    Ctx,
    DEFAULT_MAX_SEND_FEE,
    clearPendingTransaction,
    eventArgs,
    expectedHistoryHash,
    installRunSignals,
    interruptedStatus,
    locateReceived,
    log,
    ownerOrNull,
    passportOrNull,
    runStopped,
    retryEstimable,
    setupRun,
    stopRun,
    tokenUriOrEmpty,
    waitReceipt,
} from './flows'
import { LedgerRow, appendLedger } from './fixtures'
import { hopVerdict, lzScanStatus } from './lz-scan'
import { verifyOnChainRecord } from './payload'
import { ScaleItem as Item, localCid, localVerifyContext } from './scale-cid'
import { isSealedBlockHash, readReceiptBlock } from './receipt-block'
import { readL1FeeWei } from './receipt-fees'
import { FlowRecord } from './report'
import {
    DS4_REFERENCE,
    LedgerNote,
    ScaleStep,
    batchFigures,
    compareScale,
    ledgerNotesForReport,
    scaleStats,
    writeScaleReport,
} from './scale-report'
import { assertNonceState, limitConcurrency, scaleError } from './scale-utils'

// DS4: one small pipeline on one pathway. No upload or gateway read is made. The local bytes are evidence only of
// the submitted content; the report does not claim that an unpinned CID is available from IPFS.
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const MAX_MINTS = 20
const MAX_SENDS = 10
const SEND_GAS_BUDGET = 234531
const SCAN_CHECK_MS = 30_000

type Prepared = {
    readonly item: Item
    readonly nonce: number
    readonly tx: ethers.providers.TransactionRequest
    readonly quote?: BigNumber
}
type Submission = {
    readonly prepared: Prepared
    readonly hash: string
    readonly response: ethers.providers.TransactionResponse
    readonly submittedAtMs: number
    readonly head: Promise<ethers.providers.Block | null>
    readonly receipt: Promise<{ receipt: ContractReceipt; includedAtMs: number }>
    observation?: Promise<ScaleStep | undefined>
    firstReceipt?: ContractReceipt
    firstReceiptAtMs?: number
}

const fees = async (chain: Chain) => {
    const data = await chain.wallet.provider.getFeeData()
    return data.maxFeePerGas != null
        ? { maxFeePerGas: data.maxFeePerGas, maxPriorityFeePerGas: data.maxPriorityFeePerGas! }
        : { gasPrice: data.gasPrice! }
}
const ceiling = (price: Awaited<ReturnType<typeof fees>>) =>
    'maxFeePerGas' in price ? price.maxFeePerGas! : price.gasPrice!
const gasLimit = (estimate: BigNumber) => estimate.mul(125).add(99).div(100)
const sendParam = (destination: Chain, tokenId: BigNumber, self: string) => ({
    dstEid: destination.eid,
    to: ethers.utils.hexZeroPad(self, 32),
    tokenId,
    extraOptions: '0x',
    composeMsg: '0x',
    onftCmd: '0x',
})
const code = (error: unknown) => (error as { code?: string }).code ?? 'error'
const check = (name: string, ok: boolean, detail: string) => ({ name, ok, detail })

function withReadTimeout<T>(read: Promise<T>, milliseconds: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(Object.assign(new Error('owner read timed out'), { code: 'READ_TIMEOUT' })),
            milliseconds
        )
        read.then(
            (value) => {
                clearTimeout(timer)
                resolve(value)
            },
            (error) => {
                clearTimeout(timer)
                reject(error)
            }
        )
    })
}

async function measure(
    chain: Chain,
    submitted: Submission,
    limit: ReturnType<typeof limitConcurrency>
): Promise<{ receipt: ContractReceipt; step: ScaleStep }> {
    const { receipt, includedAtMs } = await submitted.receipt
    const [head, block, l1FeeWei] = await Promise.all([
        submitted.head,
        limit(() => readReceiptBlock(chain.wallet.provider, receipt.blockHash, receipt.blockNumber)),
        limit(() => readL1FeeWei(chain.wallet.provider, chain.chainId, receipt.transactionHash, receipt.blockHash)),
    ])
    const price = receipt.effectiveGasPrice ?? submitted.response.gasPrice ?? BigNumber.from(0)
    const usableHead = head != null && block != null && head.timestamp <= block.timestamp
    return {
        receipt,
        step: {
            step: submitted.prepared.quote == null ? 'mint' : `send ${chain.network} -> arbitrum-sepolia`,
            network: chain.network,
            txHash: receipt.transactionHash,
            nonce: submitted.prepared.nonce,
            tokenId: submitted.prepared.item.tokenId.toString(),
            minedStatus: receipt.status,
            gasUsed: receipt.gasUsed.toString(),
            effectiveGasPrice: price.toString(),
            feeWei: receipt.gasUsed.mul(price).toString(),
            l1FeeWei,
            blockNumber: receipt.blockNumber,
            blockTimestamp: block?.timestamp,
            submittedAtMs: submitted.submittedAtMs,
            includedAtMs,
            confirmSeconds: Math.max(0, (includedAtMs - submitted.submittedAtMs) / 1000),
            blockSeconds: usableHead ? block.timestamp - head.timestamp : undefined,
            measureNote:
                block == null
                    ? 'receipt block unavailable'
                    : head != null && !usableHead
                      ? 'head newer than inclusion; blockSeconds omitted'
                      : undefined,
            payloadBytes: submitted.prepared.item.bytes.length,
            cidLength: submitted.prepared.item.cid.length,
            checks: [],
        },
    }
}

async function broadcast(
    ctx: Ctx,
    chain: Chain,
    prepared: readonly Prepared[],
    flow: FlowRecord,
    limit: ReturnType<typeof limitConcurrency>,
    onFirstReceipt?: (prepared: Prepared, receipt: ContractReceipt) => void,
    onSealedReceipt?: (
        submitted: Submission,
        receipt: ContractReceipt,
        includedAtMs: number
    ) => Promise<ScaleStep | undefined>
): Promise<Submission[]> {
    const submitted: Submission[] = []
    let confirmed = 0
    for (const p of prepared) {
        if (runStopped(ctx)) break
        let hash: string | undefined
        try {
            const { from: _from, ...unsigned } = p.tx
            const raw = await chain.wallet.signTransaction({
                ...unsigned,
                chainId: (await chain.wallet.provider.getNetwork()).chainId,
                type: unsigned.maxFeePerGas == null ? 0 : 2,
            })
            hash = ethers.utils.keccak256(raw)
            flow.steps.push({
                step: p.quote == null ? 'mint, submitted' : 'send, submitted',
                network: chain.network,
                txHash: hash,
                tokenId: p.item.tokenId.toString(),
                nonce: p.nonce,
                checks: [check('signed', true, 'broadcast pending')],
            } as ScaleStep)
            const response = await chain.wallet.provider.sendTransaction(raw)
            if (response.hash.toLowerCase() !== hash.toLowerCase())
                throw new Error('broadcast response hash differs from locally signed transaction')
            const submittedAtMs = Date.now()
            const head = chain.wallet.provider.getBlock('latest').catch(() => null)
            let includedAtMs = submittedAtMs
            const submission = {
                prepared: p,
                hash,
                response,
                submittedAtMs,
                head,
                receipt: Promise.resolve(null) as unknown as Submission['receipt'],
            } as Submission
            const receipt = waitReceipt(
                chain,
                response,
                true,
                (first) => {
                    includedAtMs = Date.now()
                    submission.firstReceipt = first
                    submission.firstReceiptAtMs = includedAtMs
                    const index = flow.steps.findIndex((s) => s.txHash === hash)
                    if (index >= 0)
                        flow.steps[index] = {
                            ...flow.steps[index],
                            submittedAtMs,
                            includedAtMs,
                            provisionalReceipt: isSealedBlockHash(first.blockHash) ? undefined : first,
                            checks: [check('first receipt observed', true, 'sealing and metadata pending')],
                        }
                    onFirstReceipt?.(p, first)
                },
                { allPending: true, seal: (work) => limit(work) }
            ).then((r) => {
                log(`DS4 ${p.quote == null ? 'mint' : 'send'} ${++confirmed}/${prepared.length} confirmed`)
                return { receipt: r, includedAtMs }
            })
            ;(submission as { receipt: Submission['receipt'] }).receipt = receipt
            if (onSealedReceipt) {
                submission.observation = receipt.then(({ receipt: sealed, includedAtMs: firstAt }) =>
                    onSealedReceipt(submission, sealed, firstAt)
                )
                submission.observation.catch(() => undefined)
            }
            // Observe rejection immediately; a later Promise.allSettled still receives the failure.
            receipt.catch(() => undefined)
            submitted.push(submission)
            const index = flow.steps.findIndex((s) => s.txHash === hash)
            if (index >= 0) flow.steps[index] = { ...flow.steps[index], submittedAtMs }
        } catch (error) {
            flow.status = 'FAIL'
            flow.error = `nonce ${p.nonce}, hash ${hash ?? 'not signed'}: broadcast response unavailable (${code(error)}); later prepared nonces were not sent`
            const index = flow.steps.findIndex((s) => s.txHash === hash)
            if (index >= 0)
                flow.steps[index] = {
                    ...flow.steps[index],
                    checks: [check('broadcast response', false, code(error))],
                }
            break
        }
    }
    return submitted
}

export async function nonceState(chain: Chain): Promise<{ latest: number; pending: number }> {
    const [latest, pending] = await Promise.all([
        chain.wallet.getTransactionCount('latest'),
        chain.wallet.getTransactionCount('pending'),
    ])
    return { latest, pending }
}

async function preparedMints(ctx: Ctx, chain: Chain, count: number, nonce: number): Promise<Prepared[]> {
    const firstId = (await chain.distillery.nextTokenId()) as BigNumber
    const items = Array.from({ length: count }, (_, i) => localCid(ctx, firstId.add(i)))
    const estimate = await chain.distillery.estimateGas.mint(chain.wallet.address, firstId, items[0].cid)
    const limit = gasLimit(estimate)
    const price = await fees(chain)
    return Promise.all(
        items.map(async (item, i) => ({
            item,
            nonce: nonce + i,
            tx: await chain.distillery.populateTransaction.mint(chain.wallet.address, item.tokenId, item.cid, {
                nonce: nonce + i,
                gasLimit: limit,
                ...price,
            }),
        }))
    )
}

async function preflightBalance(
    source: Chain,
    destination: Chain,
    mints: readonly Prepared[],
    sends: number,
    ctx: Ctx
): Promise<void> {
    const price = await fees(source)
    const mintLimit = BigNumber.from(mints[0].tx.gasLimit)
    const quotes = await Promise.all(
        mints.slice(0, sends).map(async ({ item }) => {
            const fee = await source.distillery.quoteSend(
                sendParam(destination, item.tokenId, source.wallet.address),
                false
            )
            const nativeFee = fee.nativeFee as BigNumber
            if (ctx.maxSendFeeWei != null && nativeFee.gt(ctx.maxSendFeeWei))
                throw new Error(`send fee for ${item.tokenId} exceeds --max-send-fee`)
            return nativeFee
        })
    )
    const quoted = quotes.reduce((sum, q) => sum.add(q), BigNumber.from(0))
    const gas = mintLimit.mul(mints.length).add(gasLimit(BigNumber.from(SEND_GAS_BUDGET)).mul(sends))
    const cost = gas.mul(ceiling(price)).add(quoted)
    const balance = await source.wallet.getBalance()
    log(
        `DS4 Base balance ${ethers.utils.formatEther(balance)}; twice quoted batch cost ${ethers.utils.formatEther(cost.mul(2))}`
    )
    if (balance.lt(cost.mul(2))) throw new Error('Base balance below twice the quoted DS4 batch cost')
}

async function preparedSends(
    ctx: Ctx,
    source: Chain,
    destination: Chain,
    items: readonly Item[],
    nonce: number
): Promise<Prepared[]> {
    const pending = await source.wallet.getTransactionCount('pending')
    if (nonce < pending) throw new Error(`send nonce ${nonce} is below RPC pending nonce ${pending}`)
    const price = await fees(source)
    return Promise.all(
        items.map(async (item, i) => {
            if ((await ownerOrNull(destination, item.tokenId)) !== null)
                throw new Error(`destination already holds ${item.tokenId} before send`)
            const param = sendParam(destination, item.tokenId, source.wallet.address)
            const fee = await retryEstimable<{ nativeFee: BigNumber }>(
                () => source.distillery.quoteSend(param, false),
                ['UNPREDICTABLE_GAS_LIMIT', 'CALL_EXCEPTION']
            )
            const quote = fee.nativeFee as BigNumber
            if (ctx.maxSendFeeWei != null && quote.gt(ctx.maxSendFeeWei))
                throw new Error(`send fee for ${item.tokenId} exceeds --max-send-fee`)
            const feeArg = { nativeFee: quote, lzTokenFee: 0 }
            const estimate = await retryEstimable(
                () => source.distillery.estimateGas.send(param, feeArg, source.wallet.address, { value: quote }),
                ['UNPREDICTABLE_GAS_LIMIT', 'CALL_EXCEPTION']
            )
            return {
                item,
                nonce: nonce + i,
                quote,
                tx: await source.distillery.populateTransaction.send(param, feeArg, source.wallet.address, {
                    nonce: nonce + i,
                    gasLimit: gasLimit(estimate),
                    value: quote,
                    ...price,
                }),
            }
        })
    )
}

async function verifyLocal(
    ctx: Ctx,
    chain: Chain,
    item: Item,
    step: ScaleStep,
    destination = false
): Promise<ScaleStep> {
    const tokenId = item.tokenId
    const deadline = Date.now() + 90_000
    let passport: Awaited<ReturnType<typeof passportOrNull>> = null
    let owner: string | null = null
    let uri = ''
    do {
        try {
            ;[passport, owner, uri] = await Promise.all([
                passportOrNull(chain, tokenId),
                ownerOrNull(chain, tokenId),
                tokenUriOrEmpty(chain, tokenId),
            ])
            if (passport?.cid === item.cid && owner === chain.wallet.address && uri === `ipfs://${item.cid}`) break
        } catch (error) {
            if (Date.now() >= deadline) throw error
        }
        if (Date.now() < deadline) await sleep(5000)
    } while (Date.now() < deadline)
    const verification = await verifyOnChainRecord(
        localVerifyContext(ctx),
        { tokenId: tokenId.toString(), revision: passport?.revision ?? -1, cid: passport?.cid ?? '' },
        ctx.histories.get(tokenId.toString())
    )
    const hash = expectedHistoryHash(tokenId, [item.cid])
    return {
        ...step,
        verification,
        checks: [
            check('recipient holds token', owner === chain.wallet.address, String(owner)),
            check(
                'passport revision and CID',
                passport?.revision === 0 && passport.cid === item.cid,
                String(passport?.cid)
            ),
            check('history hash', passport?.historyHash === hash, String(passport?.historyHash)),
            check('tokenURI', uri === `ipfs://${item.cid}`, uri),
            check(
                destination ? 'destination content, binding, history' : 'mint content, binding, history',
                Object.values(verification).every((v) => v.status === 'verified'),
                JSON.stringify(verification)
            ),
        ],
    }
}

async function settleMints(
    ctx: Ctx,
    chain: Chain,
    submitted: readonly Submission[],
    flow: FlowRecord,
    limit: ReturnType<typeof limitConcurrency>
): Promise<ScaleStep[]> {
    return Promise.all(
        submitted.map(async (s) => {
            let step: ScaleStep
            try {
                const { receipt, step: measured } = await measure(chain, s, limit)
                const issued = eventArgs(chain, receipt, 'PassportIssued')
                step = measured
                if (
                    receipt.status === 1 &&
                    issued != null &&
                    BigNumber.from(issued.tokenId).eq(s.prepared.item.tokenId)
                ) {
                    ctx.histories.set(s.prepared.item.tokenId.toString(), [s.prepared.item.cid])
                    try {
                        step = await verifyLocal(ctx, chain, s.prepared.item, step)
                    } catch (error) {
                        step = { ...step, checks: [check('mint inspection', false, code(error))] }
                    }
                } else step = { ...step, checks: [check('PassportIssued and status 1', false, String(receipt.status))] }
            } catch (error) {
                step = {
                    step: 'mint',
                    network: chain.network,
                    txHash: s.hash,
                    tokenId: s.prepared.item.tokenId.toString(),
                    nonce: s.prepared.nonce,
                    submittedAtMs: s.submittedAtMs,
                    includedAtMs: s.firstReceiptAtMs,
                    confirmSeconds:
                        s.firstReceiptAtMs == null ? undefined : (s.firstReceiptAtMs - s.submittedAtMs) / 1000,
                    provisionalReceipt:
                        s.firstReceipt != null && !isSealedBlockHash(s.firstReceipt.blockHash)
                            ? s.firstReceipt
                            : undefined,
                    checks: [check('sealed receipt', false, code(error))],
                }
            }
            const index = flow.steps.findIndex((v) => v.txHash === s.hash)
            if (index >= 0) flow.steps[index] = step
            clearPendingTransaction(s.hash)
            return step
        })
    )
}

async function waitDelivery(
    ctx: Ctx,
    source: Chain,
    destination: Chain,
    item: Item,
    step: ScaleStep,
    receipt: ContractReceipt,
    destinationHead: number
): Promise<ScaleStep> {
    const sent = eventArgs(source, receipt, 'ONFTSent')
    const started = step.includedAtMs ?? Date.now()
    let checked = 0
    let errors = 0
    let scanStatus = 'not checked'
    let stop: string | undefined
    let owner: string | null = null
    let lateReadAfterScanStop = false
    while (Date.now() - started < ctx.timeoutSeconds * 1000 && interruptedStatus(ctx) == null) {
        owner = await ownerOrNull(destination, item.tokenId)
        if (owner != null) break
        if (Date.now() - checked >= SCAN_CHECK_MS) {
            checked = Date.now()
            scanStatus = await lzScanStatus(receipt.transactionHash)
            errors = scanStatus.startsWith('scan ') && scanStatus !== 'scan HTTP 404' ? errors + 1 : 0
            const elapsed = Math.round((Date.now() - started) / 1000)
            const verdict = hopVerdict(scanStatus, elapsed, {
                graceSeconds: ctx.scanGraceSeconds,
                stuckSeconds: ctx.scanStuckSeconds,
                consecutiveErrors: errors,
            })
            if (verdict !== 'wait') {
                if (verdict === 'no record' || verdict === 'stuck') {
                    // As in sendStep, a destination read wins over a lagging Scan status.
                    owner = await ownerOrNull(destination, item.tokenId)
                    if (owner != null) break
                    lateReadAfterScanStop = true
                }
                stop = verdict === 'no record' && errors >= 3 ? 'Scan unavailable' : verdict
                stopRun(
                    ctx,
                    `${source.network} -> ${destination.network} token ${item.tokenId}: ${stop}; sends already broadcast cannot be recalled`
                )
                break
            }
            log(`DS4 waiting token ${item.tokenId} ${elapsed}s: ${scanStatus}`)
        }
        await sleep(5000)
    }
    const pollAt = owner == null ? undefined : Math.round(Date.now() / 1000)
    if (owner == null && stop == null && interruptedStatus(ctx) != null) stop = interruptedStatus(ctx)
    if (owner == null && stop == null) {
        stop = `delivery unobserved within ${ctx.timeoutSeconds}s`
        stopRun(
            ctx,
            `${source.network} -> ${destination.network} token ${item.tokenId}: ${stop}; sends already broadcast cannot be recalled`
        )
    }
    // A later read after a no-record/stuck stop is descriptive only; terminal status and timeout get no extra read.
    if (lateReadAfterScanStop && owner == null) owner = await ownerOrNull(destination, item.tokenId)
    const lateObservation =
        stop != null && owner != null ? { observedAtMs: Date.now(), method: 'ownerOf' as const, owner } : undefined
    if (owner != null && stop == null) scanStatus = await lzScanStatus(receipt.transactionHash)
    const lookup =
        owner == null || sent == null || stop != null
            ? undefined
            : await locateReceived(destination, sent.guid as string, Math.max(0, destinationHead - 5))
    const destinationStep =
        owner == null || stop != null ? undefined : await verifyLocal(ctx, destination, item, step, true)
    const sourceOwner = await ownerOrNull(source, item.tokenId)
    const sourcePassport = await passportOrNull(source, item.tokenId)
    log(
        `DS4 hop token ${item.tokenId} ended: ${stop ?? (owner === destination.wallet.address ? 'delivered' : 'not delivered')}`
    )
    return {
        ...(destinationStep ?? step),
        step: `send ${source.network} -> ${destination.network}`,
        nativeFee: step.nativeFee,
        quotedNativeFee: step.quotedNativeFee,
        delivered: stop == null && owner === destination.wallet.address,
        hopStop: stop,
        lateObservation,
        firstPollAtSeconds: stop == null ? pollAt : undefined,
        deliverySeconds:
            stop != null || pollAt == null || step.blockTimestamp == null ? undefined : pollAt - step.blockTimestamp,
        deliverySecondsChain:
            lookup?.received == null || step.blockTimestamp == null
                ? undefined
                : lookup.received.blockTimestamp - step.blockTimestamp,
        received: lookup?.received,
        receivedLookup: lookup?.status,
        scanStatus: stop == null ? scanStatus : `${scanStatus}; stopped: ${stop}`,
        checks: [
            ...(destinationStep?.checks ?? []),
            ...(stop == null ? [] : [check('hop stop', false, stop)]),
            check('ONFTSent', sent != null && BigNumber.from(sent.tokenId).eq(item.tokenId), String(sent?.guid)),
            check('source token burned', sourceOwner === null, String(sourceOwner)),
            check('source passport absent', sourcePassport === null, String(sourcePassport?.cid)),
            check('destination delivered', stop == null && owner === destination.wallet.address, stop ?? String(owner)),
        ],
    }
}

async function settleSends(
    ctx: Ctx,
    source: Chain,
    destination: Chain,
    submitted: readonly Submission[],
    destinationHead: number,
    flow: FlowRecord,
    limit: ReturnType<typeof limitConcurrency>
): Promise<ScaleStep[]> {
    return Promise.all(
        submitted.map(async (s): Promise<ScaleStep> => {
            // Begin each destination and Scan wait on this send's own receipt, before the other receipts settle.
            const measurement = measure(source, s, limit)
            const observation = s.observation ?? Promise.resolve(undefined)
            const [measured, observed] = await Promise.allSettled([measurement, observation])
            let step: ScaleStep
            if (measured.status === 'rejected') {
                step = {
                    step: `send ${source.network} -> ${destination.network}`,
                    network: source.network,
                    txHash: s.hash,
                    tokenId: s.prepared.item.tokenId.toString(),
                    nonce: s.prepared.nonce,
                    submittedAtMs: s.submittedAtMs,
                    includedAtMs: s.firstReceiptAtMs,
                    confirmSeconds:
                        s.firstReceiptAtMs == null ? undefined : (s.firstReceiptAtMs - s.submittedAtMs) / 1000,
                    provisionalReceipt:
                        s.firstReceipt != null && !isSealedBlockHash(s.firstReceipt.blockHash)
                            ? s.firstReceipt
                            : undefined,
                    nativeFee: s.prepared.quote?.toString(),
                    quotedNativeFee: s.prepared.quote?.toString(),
                    checks: [check('sealed receipt', false, code(measured.reason))],
                }
            } else {
                const { receipt } = measured.value
                step = {
                    ...measured.value.step,
                    nativeFee: s.prepared.quote?.toString(),
                    quotedNativeFee: s.prepared.quote?.toString(),
                }
                if (receipt.status !== 1)
                    step = { ...step, checks: [check('send mined status 1', false, String(receipt.status))] }
            }
            if (observed.status === 'fulfilled' && observed.value != null) {
                const delivery = observed.value
                const blockTimestamp = step.blockTimestamp
                step = {
                    ...step,
                    ...delivery,
                    nonce: s.prepared.nonce,
                    minedStatus: step.minedStatus,
                    gasUsed: step.gasUsed,
                    effectiveGasPrice: step.effectiveGasPrice,
                    feeWei: step.feeWei,
                    l1FeeWei: step.l1FeeWei,
                    blockNumber: step.blockNumber,
                    blockTimestamp,
                    submittedAtMs: step.submittedAtMs,
                    includedAtMs: step.includedAtMs,
                    confirmSeconds: step.confirmSeconds,
                    blockSeconds: step.blockSeconds,
                    deliverySeconds:
                        delivery.firstPollAtSeconds == null || blockTimestamp == null
                            ? undefined
                            : delivery.firstPollAtSeconds - blockTimestamp,
                    deliverySecondsChain:
                        delivery.received == null || blockTimestamp == null
                            ? undefined
                            : delivery.received.blockTimestamp - blockTimestamp,
                }
            } else if (observed.status === 'rejected')
                step = { ...step, checks: [...step.checks, check('delivery inspection', false, code(observed.reason))] }
            const index = flow.steps.findIndex((v) => v.txHash === s.hash)
            if (index >= 0) flow.steps[index] = step
            clearPendingTransaction(s.hash)
            return step
        })
    )
}

function fileMint(
    ctx: Ctx,
    chain: Chain,
    item: Item,
    index: number,
    sendCount: number,
    ledger: LedgerRow[],
    root: string
) {
    const tokenId = item.tokenId.toString()
    if (ledger.some((row) => row.tokenId === tokenId)) return
    const row: LedgerRow = {
        tokenId,
        network: chain.network,
        deploymentId: ctx.deploymentId,
        purpose: index < sendCount ? 'DS4 mint, send to arbitrum-sepolia' : 'DS4 mint',
        runId: ctx.runId,
    }
    ledger.push(row)
    appendLedger(root, [row])
}

/** Before sends and at checkpoints, account for failed or unsettled mint steps without rereading verified owners. */
export async function reconcileMintLedger(
    ctx: Ctx,
    chain: Chain,
    flow: FlowRecord,
    ledger: LedgerRow[],
    root: string,
    mintNonce: number,
    sendCount: number,
    notes: Map<string, LedgerNote> = new Map()
) {
    const steps = (flow.steps as ScaleStep[]).filter(
        (step) => step.step.startsWith('mint') && step.tokenId != null && step.nonce != null
    )
    log(`DS4 reconcile start: ${steps.length} broadcast mint ids`)
    try {
        for (const step of steps) {
            const tokenId = BigNumber.from(step.tokenId!)
            const verified = step.minedStatus === 1 && step.checks.length > 0 && step.checks.every((item) => item.ok)
            if (verified) {
                try {
                    // The mint verification already read ownerOf; fill a missing ledger row without another RPC read.
                    fileMint(
                        ctx,
                        chain,
                        { tokenId, cid: '', bytes: new Uint8Array() },
                        step.nonce! - mintNonce,
                        sendCount,
                        ledger,
                        root
                    )
                    notes.delete(step.tokenId!)
                    log(`DS4 reconcile token ${tokenId}: verified`)
                } catch (error) {
                    notes.set(step.tokenId!, {
                        tokenId: step.tokenId!,
                        nonce: step.nonce,
                        state: 'unresolved',
                        errorCode: code(error),
                        note: `ledger filing failed (${code(error)}); manual chain check required before further work`,
                    })
                    log(`DS4 reconcile token ${tokenId}: unresolved`)
                }
                continue
            }
            let owner: string | null | undefined
            let errorCode: string | undefined
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    owner = await withReadTimeout(ownerOrNull(chain, tokenId), 8_000)
                    break
                } catch (error) {
                    errorCode = code(error)
                    if (attempt < 2) await sleep(1_000)
                }
            }
            const filed = ledger.some((row) => row.tokenId === step.tokenId)
            if (owner === undefined) {
                notes.set(step.tokenId!, {
                    tokenId: step.tokenId!,
                    nonce: step.nonce,
                    state: 'unresolved',
                    errorCode,
                    note: `ownerOf unresolved after 3 attempts (${errorCode}); manual chain check required before further work`,
                })
                log(`DS4 reconcile token ${tokenId}: unresolved`)
                continue
            }
            if (owner === null) {
                notes.set(step.tokenId!, {
                    tokenId: step.tokenId!,
                    nonce: step.nonce,
                    state: 'absent',
                    note: filed
                        ? 'ledger row filed from first receipt, but ownerOf now says absent; manual chain check required'
                        : 'expected mint id absent on source after failed step; manual chain check required',
                })
                log(`DS4 reconcile token ${tokenId}: absent`)
                continue
            }
            try {
                fileMint(
                    ctx,
                    chain,
                    { tokenId, cid: '', bytes: new Uint8Array() },
                    step.nonce! - mintNonce,
                    sendCount,
                    ledger,
                    root
                )
                notes.set(step.tokenId!, {
                    tokenId: step.tokenId!,
                    nonce: step.nonce,
                    state: 'filed',
                    note: 'token exists on source; ledger filed, but mint step failed or remains incomplete',
                })
                log(`DS4 reconcile token ${tokenId}: filed`)
            } catch (error) {
                notes.set(step.tokenId!, {
                    tokenId: step.tokenId!,
                    nonce: step.nonce,
                    state: 'unresolved',
                    errorCode: code(error),
                    note: `ledger filing failed (${code(error)}); manual chain check required before further work`,
                })
                log(`DS4 reconcile token ${tokenId}: unresolved`)
            }
        }
    } finally {
        log(`DS4 reconcile end: ${steps.length} broadcast mint ids`)
    }
    return notes
}

export async function runScale(
    ctx: Ctx,
    source: Chain,
    destination: Chain,
    mints: number,
    sends: number,
    flow: FlowRecord,
    ledger: LedgerRow[],
    root: string,
    startNonce?: number,
    ledgerIssues: Map<string, LedgerNote> = new Map()
) {
    let mintNonce = startNonce
    if (mintNonce == null) {
        const initialNonces = await nonceState(source)
        assertNonceState(initialNonces)
        mintNonce = initialNonces.pending
    }
    const limit = limitConcurrency(4)
    const mintPrepared = await preparedMints(ctx, source, mints, mintNonce)
    await preflightBalance(source, destination, mintPrepared, sends, ctx)
    // The empty-CID preflight quote slightly underestimates a real send; the 2× funding margin covers it.
    log('DS4 phase: mint submission')
    const mintSubmitted = await broadcast(ctx, source, mintPrepared, flow, limit, (prepared, receipt) => {
        if (receipt.status !== 1) return
        const issued = eventArgs(source, receipt, 'PassportIssued')
        if (issued == null) return
        const tokenId = BigNumber.from(issued.tokenId)
        const index = prepared.nonce - mintNonce
        fileMint(ctx, source, { ...prepared.item, tokenId }, index, sends, ledger, root)
    })
    log('DS4 phase: mint receipts and verification')
    const mintSteps = await settleMints(ctx, source, mintSubmitted, flow, limit)
    await reconcileMintLedger(ctx, source, flow, ledger, root, mintNonce, sends, ledgerIssues)
    if ([...ledgerIssues.values()].some((note) => note.state === 'unresolved' || note.state === 'absent')) {
        flow.status = 'FAIL'
        flow.error = 'mint ledger unresolved; manual chain check required before sends'
        return { mints: mintSteps, sends: [] as ScaleStep[] }
    }
    if (mintSubmitted.length !== mints || mintSteps.some((s) => s.minedStatus !== 1 || s.checks.some((c) => !c.ok))) {
        flow.status = 'FAIL'
        flow.error = flow.error ?? 'mint batch incomplete; no sends follow; inspect the nonce sequence'
        return { mints: mintSteps, sends: [] as ScaleStep[] }
    }
    if (runStopped(ctx)) return { mints: mintSteps, sends: [] as ScaleStep[] }
    const sendPrepared = await preparedSends(
        ctx,
        source,
        destination,
        mintPrepared.slice(0, sends).map((p) => p.item),
        mintNonce + mints
    )
    const destinationHead = await destination.wallet.provider.getBlockNumber()
    log('DS4 phase: send submission and delivery')
    const sendSubmitted = await broadcast(
        ctx,
        source,
        sendPrepared,
        flow,
        limit,
        undefined,
        (submission, receipt, includedAtMs) =>
            receipt.status === 1
                ? waitDelivery(
                      ctx,
                      source,
                      destination,
                      submission.prepared.item,
                      {
                          step: `send ${source.network} -> ${destination.network}`,
                          network: source.network,
                          txHash: submission.hash,
                          tokenId: submission.prepared.item.tokenId.toString(),
                          includedAtMs,
                          nativeFee: submission.prepared.quote?.toString(),
                          quotedNativeFee: submission.prepared.quote?.toString(),
                          checks: [],
                      },
                      receipt,
                      destinationHead
                  )
                : Promise.resolve(undefined)
    )
    log('DS4 phase: delivery')
    const sendSteps = await settleSends(ctx, source, destination, sendSubmitted, destinationHead, flow, limit)
    if (sendSubmitted.length !== sends || sendSteps.some((s) => s.minedStatus !== 1 || s.checks.some((c) => !c.ok))) {
        flow.status = 'FAIL'
        flow.error = flow.error ?? runStopped(ctx) ?? 'send batch incomplete or delivery failed'
    }
    return { mints: mintSteps, sends: sendSteps }
}

task('e2e:scale', 'DS4: pipelined mints and back-to-back sends on one pathway')
    .addOptionalParam('source', 'Source chain', 'base-sepolia', types.string)
    .addOptionalParam('destination', 'Destination chain', 'arbitrum-sepolia', types.string)
    .addOptionalParam('mints', 'Number of mints', 20, types.int)
    .addOptionalParam('sends', 'Number of sends', 10, types.int)
    .addOptionalParam('timeout', 'Delivery timeout seconds', 1800, types.int)
    .addOptionalParam('window', 'Observation window label', 'ds4', types.string)
    .addOptionalParam('maxSendFee', 'Maximum LayerZero fee per send', DEFAULT_MAX_SEND_FEE, types.string)
    .setAction(
        async (
            args: {
                source: string
                destination: string
                mints: number
                sends: number
                timeout: number
                window: string
                maxSendFee: string
            },
            hre
        ) => {
            if (args.source !== 'base-sepolia' || args.destination !== 'arbitrum-sepolia')
                throw new Error('DS4 is restricted to Base Sepolia -> Arbitrum Sepolia')
            if (
                args.mints < 1 ||
                args.mints > MAX_MINTS ||
                args.sends < 1 ||
                args.sends > MAX_SENDS ||
                args.sends > args.mints
            )
                throw new Error('DS4 needs 1–20 mints and 1–10 sends, no more sends than mints')
            const runId = String(Date.now())
            const { ctx, chains, header } = await setupRun(hre, [args.source, args.destination], args.timeout, runId, {
                window: args.window,
                maxSendFee: args.maxSendFee,
                params: { ...args },
                sends: [{ from: args.source, to: args.destination }],
            })
            const [source, destination] = chains
            const flow: FlowRecord = { flow: 'DS4 Base to Arbitrum', status: 'PASS', steps: [] }
            const flows = [flow]
            const ledger: LedgerRow[] = []
            const ledgerIssues = new Map<string, LedgerNote>()
            let mints: ScaleStep[] = []
            let sends: ScaleStep[] = []
            let sourceNonces: { latest: number; pending: number } | undefined
            let mintNonce: number | undefined
            let reconciliation: Promise<void> | undefined
            const checkpoint = () => {
                appendLedger(hre.config.paths.root, ledger)
                // Include submitted but unsettled steps in an interruption checkpoint.
                const mintRows = flow.steps.filter((s) => s.step.startsWith('mint')) as ScaleStep[]
                const sendRows = flow.steps.filter((s) => s.step.startsWith('send')) as ScaleStep[]
                const batches = { mints: batchFigures(mintRows), sends: batchFigures(sendRows, true) }
                const report = {
                    runId,
                    deploymentId: ctx.deploymentId,
                    header: {
                        ...header,
                        params: {
                            ...header.params,
                            ...(sourceNonces == null
                                ? {}
                                : {
                                      sourceNonceLatest: sourceNonces.latest,
                                      sourceNoncePending: sourceNonces.pending,
                                  }),
                        },
                    },
                    status: interruptedStatus(ctx),
                    params: {
                        mints: args.mints,
                        sends: args.sends,
                        sourceNonceLatest: sourceNonces?.latest,
                        sourceNoncePending: sourceNonces?.pending,
                    },
                    ledgerNotes: ledgerNotesForReport(
                        mintRows,
                        new Set(ledger.map((row) => row.tokenId)),
                        ledgerIssues
                    ),
                    reference: DS4_REFERENCE,
                    flows,
                    mints: mintRows,
                    sends: sendRows,
                    batches,
                    statistics: {
                        mintGas: scaleStats(mintRows, 'gasUsed'),
                        sendGas: scaleStats(sendRows, 'gasUsed'),
                        mintConfirm: scaleStats(mintRows, 'confirmSeconds'),
                        sendConfirm: scaleStats(sendRows, 'confirmSeconds'),
                        deliveryChain: scaleStats(sendRows, 'deliverySecondsChain'),
                        deliveryPoll: scaleStats(sendRows, 'deliverySeconds'),
                    },
                    comparison: compareScale(mintRows, sendRows, args.mints, args.sends, batches.sends),
                }
                return writeScaleReport(hre.config.paths.root, report)
            }
            const reconcile = async () => {
                if (mintNonce == null) return
                await reconcileMintLedger(
                    ctx,
                    source,
                    flow,
                    ledger,
                    hre.config.paths.root,
                    mintNonce,
                    args.sends,
                    ledgerIssues
                )
                checkpoint()
            }
            const detach = installRunSignals(ctx, chains, flows, () => {
                checkpoint()
                reconciliation = reconcile().catch((error) => log(`DS4 ledger reconciliation: ${code(error)}`))
            })
            try {
                sourceNonces = await nonceState(source)
                assertNonceState(sourceNonces)
                mintNonce = sourceNonces.pending
                const result = await runScale(
                    ctx,
                    source,
                    destination,
                    args.mints,
                    args.sends,
                    flow,
                    ledger,
                    hre.config.paths.root,
                    mintNonce,
                    ledgerIssues
                )
                mints = result.mints
                sends = result.sends
            } catch (error) {
                flow.status = 'FAIL'
                flow.error = `DS4 stopped: ${scaleError(error)}`
                log(flow.error)
            } finally {
                if (reconciliation) await reconciliation
                await reconcile().catch((error) => log(`DS4 ledger reconciliation: ${code(error)}`))
                const file = checkpoint()
                detach()
                log(`DS4 report: ${file}`)
            }
            const comparison = compareScale(mints, sends, args.mints, args.sends, batchFigures(sends, true))
            if (flow.status === 'FAIL' || Object.values(comparison).some((v) => typeof v === 'object' && !v.met))
                process.exitCode = 1
        }
    )
