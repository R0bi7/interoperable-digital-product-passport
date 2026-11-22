import { BigNumber, Contract, ContractReceipt, Wallet, ethers } from 'ethers'
import { task, types } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'

import { httpNetwork, manifestDrift, readDeploymentRecord, readManifest } from './deployments'
import {
    PinataConfig,
    Verification,
    VerifyContext,
    allVerified,
    buildEnvelope,
    canonicalizeEnvelope,
    caskData,
    computeCidV1,
    pinEnvelope,
    pinataConfigFromEnv,
    verifyOnChainRecord,
} from './payload'
import { Check, FlowRecord, ReceiveRecord, StepRecord, summarize, summaryLine, writeReport } from './report'
import { decodeRevert, formatRevert } from './reverts'
import { isSealedBlockHash, readReceiptBlock, readSealedReceipt } from './receipt-block'
import { readL1FeeWei } from './receipt-fees'
import { ENDPOINT_ABI, ENDPOINT_IFACE, decodePacket } from './packet'
import { FEE_POLICY_ID, LowFeeProvider, PRIORITY_FEE_WEI } from './fees'
import { RunHeader, buildRunHeader, toolVersions } from './run-header'
import {
    SCAN_GRACE_SECONDS,
    SCAN_STUCK_SECONDS,
    blocksRun,
    allPairs,
    describePreflight,
    PlannedPathway,
    getLogsChunked,
    lzScanStatus,
    hopVerdict,
    scanPreflight,
} from './lz-scan'

// Core user flows of WhiskyDistillery, run against the live deployments in deployments/<network>.
//   local      mint -> revise -> ERC-721 transfer, on each network
//   stale      mint -> two revisions prepared against the same revision -> first succeeds, second reverts
//              StaleRevision; mint with a wrong expectedTokenId reverts UnexpectedTokenId
//   crosschain for each pair: mint, revise on A, send to B, revise on B, send back to A
//   cycle      Arbitrum -> Base -> Sepolia -> Arbitrum with a revise on Base and on Sepolia
// Every flow pins real payloads (canonical envelope, CID predicted locally, upload asserted against it, bytes read back
// through the gateway) before the CID goes on chain, and after every read of passportOf it fetches the payload behind
// the CID and computes content, binding and history (docs/TECHNICAL-REFERENCE.md, "Verification results").

const LZ_SCAN_UI = 'https://testnet.layerzeroscan.com/tx'
const READ_TIMEOUT_MS = 90_000 // public RPCs are load-balanced and may serve a block behind the receipt
const POLL_MS = 5_000
// How often a hop that waits for its delivery reads Scan's record of the send.
const SCAN_CHECK_MS = 30_000
// Size of each chain's id namespace (`PassportRegistry.ID_SPACE`): the sequence of a token id is `id mod ID_SPACE`.
const ID_SPACE = 1_000_000_000_000
// A transaction expected to revert is broadcast with a fixed gas limit, because estimateGas would refuse to send it.
const REVERT_TX_GAS_LIMIT = 400_000
const FLOW_KINDS = ['local', 'stale', 'crosschain', 'cycle'] as const
type FlowKind = (typeof FLOW_KINDS)[number]
const CYCLE_NETWORKS = ['arbitrum-sepolia', 'base-sepolia', 'sepolia'] as const

export type Chain = {
    readonly network: string
    readonly chainId: number
    readonly eid: number
    readonly wallet: Wallet
    readonly distillery: Contract
}

type Passport = { revision: number; historyHash: string; cid: string }

export type Ctx = {
    readonly runId: string
    readonly deploymentId: string
    readonly pinata: PinataConfig
    readonly verify: VerifyContext
    /** CIDs this run wrote on chain per token id, by revision. */
    readonly histories: Map<string, string[]>
    readonly timeoutSeconds: number
    /** Ceiling for the LayerZero fee of one send, in wei; a send quoted above it is refused before anything is paid. */
    readonly maxSendFeeWei?: BigNumber
    /** Seconds after a send at which a source transaction Scan has no record of stops the run (default 480). */
    readonly scanGraceSeconds?: number
    /** Seconds after a send at which a message Scan knows but has not delivered stops the run (default 900). */
    readonly scanStuckSeconds?: number
}

/** A revision prepared against `expectedRevision`: the payload is pinned and verified, nothing is on chain yet. */
export type PreparedRevision = { readonly expectedRevision: number; readonly cid: string }

class FlowFailed extends Error {}

/**
 * A transaction was accepted by the node but no receipt was seen. It can still be mined later (for a `send` the LayerZero
 * fee is then paid and the token moves unrecorded), so its hash is the identifier the manual reconciliation of
 * docs/evaluation/PROTOCOL.md, rule 11, needs. ethers' own timeout error carries only the duration.
 */
export class TxNotConfirmed extends FlowFailed {
    constructor(
        readonly network: string,
        readonly txHash: string,
        cause: string,
        replaced = false,
        readonly provisionalReceipt?: ContractReceipt
    ) {
        super(
            `tx ${txHash} on ${network} had no sealed receipt (${cause}); ` +
                (replaced
                    ? 'another transaction took its nonce: look up the replacement on the chain'
                    : 'it may still be mined: check it on the chain and enter the token id in the ledger before repeating')
        )
    }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function log(message: string) {
    console.log(`[${new Date().toISOString()}] ${message}`)
}

export function loadChain(hre: HardhatRuntimeEnvironment, network: string): Chain {
    const config = httpNetwork(hre, network)
    const deployment = readDeploymentRecord(hre, network) as unknown as { address: string; abi: unknown[] }

    const provider = new LowFeeProvider({ url: config.url, timeout: 20_000 }, config.chainId)
    const accounts = config.accounts
    let wallet: Wallet
    if (Array.isArray(accounts) && typeof accounts[0] === 'string') {
        wallet = new Wallet(accounts[0], provider)
    } else if (!Array.isArray(accounts) && typeof accounts === 'object' && 'mnemonic' in accounts) {
        wallet = Wallet.fromMnemonic(accounts.mnemonic, `${accounts.path}/0`).connect(provider)
    } else {
        throw new Error(`Network ${network} has no PRIVATE_KEY or MNEMONIC account`)
    }

    return {
        network,
        chainId: config.chainId,
        eid: config.eid,
        wallet,
        distillery: new Contract(deployment.address, deployment.abi as ethers.ContractInterface, wallet),
    }
}

function check(name: string, ok: boolean, detail: string): Check {
    return { name, ok, detail }
}

function requireChecks(record: StepRecord) {
    for (const c of record.checks) log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: ${c.detail}`)
    const failed = record.checks.filter((c) => !c.ok)
    if (failed.length > 0)
        throw new FlowFailed(`${record.step} on ${record.network}: ${failed.map((c) => c.name).join(', ')}`)
}

// The record goes into the report before the checks can fail the flow, so a failed step stays visible.
export function finishStep(flow: FlowRecord, record: StepRecord) {
    const pending =
        record.txHash == null ? -1 : flow.steps.findIndex((s) => s.txHash === record.txHash && s.step === record.step)
    if (pending >= 0) flow.steps[pending] = record
    else flow.steps.push(record)
    clearPendingTransaction(record.txHash)
    requireChecks(record)
}

// Retries a read until it satisfies the predicate, to ride out read-after-write lag of load-balanced RPCs.
async function eventually<T>(
    read: () => Promise<T>,
    accept: (value: T) => boolean,
    timeoutMs = READ_TIMEOUT_MS
): Promise<T> {
    const start = Date.now()
    const heartbeat = setInterval(
        () => log(`read waiting ${Math.round((Date.now() - start) / 1000)}s for RPC state to converge`),
        30_000
    )
    try {
        const deadline = Date.now() + timeoutMs
        let last: T = await read()
        while (!accept(last) && Date.now() < deadline) {
            await sleep(POLL_MS)
            last = await read()
        }
        return last
    } finally {
        clearInterval(heartbeat)
    }
}

// tokenURI of the token, or '' while it reverts (a load-balanced RPC that has not seen the mint yet).
export async function tokenUriOrEmpty(chain: Chain, tokenId: BigNumber): Promise<string> {
    try {
        return (await chain.distillery.tokenURI(tokenId)) as string
    } catch (error) {
        if (revertName(error) !== 'ERC721NonexistentToken') throw error
        return ''
    }
}

// Name of the custom error a call reverted with, decoded by ethers from the contract ABI.
// Undefined for anything else (RPC failure, empty return data, unknown revert), which callers rethrow
// so that a broken read can never pass as "token absent".
function revertName(error: unknown): string | undefined {
    const e = error as { code?: string; errorName?: string }
    return e.code === 'CALL_EXCEPTION' ? e.errorName : undefined
}

// Owner of the token, or null when ownerOf reverts (token absent on this chain).
export async function ownerOrNull(chain: Chain, tokenId: BigNumber): Promise<string | null> {
    try {
        return (await chain.distillery.ownerOf(tokenId)) as string
    } catch (error) {
        if (revertName(error) === 'ERC721NonexistentToken') return null
        throw error
    }
}

export async function passportOrNull(chain: Chain, tokenId: BigNumber): Promise<Passport | null> {
    try {
        const passport = await chain.distillery.passportOf(tokenId)
        return {
            revision: Number(passport.revision),
            historyHash: passport.historyHash as string,
            cid: passport.cid as string,
        }
    } catch (error) {
        if (revertName(error) === 'ERC721NonexistentToken') return null
        throw error
    }
}

// A transaction priced under a rising base fee can wait for ever; a step that waited this long fails with that cause
// instead of hanging the run and writing no report.
const RECEIPT_TIMEOUT_MS = 10 * 60 * 1000

export async function waitReceipt(
    chain: Chain,
    tx: ethers.providers.TransactionResponse,
    allowRevert = false,
    onFirstReceipt?: (receipt: ContractReceipt) => void,
    options: {
        allPending?: boolean
        seal?: (
            work: () => Promise<ethers.providers.TransactionReceipt | undefined>
        ) => Promise<ethers.providers.TransactionReceipt | undefined>
    } = {}
): Promise<ContractReceipt> {
    const start = Date.now()
    rememberPending(chain.wallet.provider, tx.hash, undefined, options.allPending)
    const heartbeat = setInterval(
        () => log(`[${chain.network}] receipt waiting ${Math.round((Date.now() - start) / 1000)}s, tx ${tx.hash}`),
        30_000
    )
    let receipt: ContractReceipt
    try {
        receipt = (await chain.wallet.provider.waitForTransaction(tx.hash, 1, RECEIPT_TIMEOUT_MS)) as ContractReceipt
    } catch (error) {
        // Only the error code is kept: the message of an RPC error can carry the request URL and its API key.
        const code = (error as { code?: string }).code ?? 'error'
        throw new TxNotConfirmed(
            chain.network,
            tx.hash,
            code === 'TIMEOUT' ? `none within ${RECEIPT_TIMEOUT_MS / 1000} s` : code,
            code === 'TRANSACTION_REPLACED'
        )
    } finally {
        clearInterval(heartbeat)
    }
    if (receipt == null) throw new TxNotConfirmed(chain.network, tx.hash, 'no receipt returned')
    if (receipt.transactionHash.toLowerCase() !== tx.hash.toLowerCase())
        throw new FlowFailed(`receipt transaction hash differs from submitted tx ${tx.hash}`)
    rememberPending(chain.wallet.provider, tx.hash, receipt, options.allPending)
    onFirstReceipt?.(receipt)
    const sealed = options.seal
        ? await options.seal(() => readSealedReceipt(chain.wallet.provider, receipt))
        : await readSealedReceipt(chain.wallet.provider, receipt)
    if (sealed == null)
        throw new TxNotConfirmed(
            chain.network,
            tx.hash,
            'receipt block hash remained unsealed for 15 s',
            false,
            receipt
        )
    receipt = sealed as ContractReceipt
    rememberPending(chain.wallet.provider, tx.hash, receipt, options.allPending)
    if (!allowRevert && receipt.status !== 1) throw new FlowFailed(`tx ${tx.hash} reverted`)
    return receipt
}

/** What one confirmed transaction adds to its step record (docs/evaluation/PROTOCOL.md, rules 2 and 6). */
export type TxMeasure = Pick<
    StepRecord,
    | 'txHash'
    | 'gasUsed'
    | 'effectiveGasPrice'
    | 'feeWei'
    | 'l1FeeWei'
    | 'blockNumber'
    | 'blockTimestamp'
    | 'submittedAtMs'
    | 'includedAtMs'
    | 'confirmSeconds'
    | 'blockSeconds'
>

// A gas estimate that fails sends nothing. On a load-balanced RPC the estimate can reach a backend that has not yet
// seen the previous transaction (a revise against the revision it just wrote), so it is repeated for READ_TIMEOUT_MS
// before the failure stands. The submission clock starts after this returns, so the wait is not in the same-chain time.
export async function retryEstimable<T>(
    send: () => Promise<T>,
    retryCodes: readonly string[] = ['UNPREDICTABLE_GAS_LIMIT']
): Promise<T> {
    const deadline = Date.now() + READ_TIMEOUT_MS
    for (;;) {
        try {
            return await send()
        } catch (error) {
            if (!retryCodes.includes((error as { code?: string }).code ?? '') || Date.now() >= deadline) throw error
            log('gas estimate reverted before anything was sent; retrying (lagging RPC?)')
            await sleep(POLL_MS)
        }
    }
}
async function sendWhenEstimable(send: () => Promise<ethers.ContractTransaction>): Promise<ethers.ContractTransaction> {
    return retryEstimable(send)
}

/**
 * Sends a transaction and measures it (docs/evaluation/PROTOCOL.md, rule 2). `submittedAtMs` is taken when the node's
 * answer to the submission has arrived, so nonce lookup, gas estimation and signing are not part of the confirmation
 * time; `includedAtMs` when the first receipt was seen. The head block is read right after the submission was answered,
 * so that the block-timestamp difference starts on the chain clock at about the moment of submission. A very fast
 * chain can include the transaction before the answer arrives; the times are then near zero, not wrong in sign.
 * The receipt is kept even if its block cannot be read: the step then has no block fields and says why.
 */
export async function timedTx(
    chain: Chain,
    send: () => Promise<ethers.ContractTransaction>
): Promise<{ receipt: ContractReceipt; measure: TxMeasure; measureNote?: string }> {
    const provider = chain.wallet.provider
    const tx = await sendWhenEstimable(() => {
        assertChainRunning(chain)
        return send()
    })
    const submittedAtMs = Date.now()
    // Receipt observation starts at once and is timestamped on its own, so the optional head read cannot delay it.
    let includedAtMs = submittedAtMs
    const receiptPromise = waitReceipt(chain, tx, false, () => {
        includedAtMs = Date.now()
    })
    const [head, receipt] = await Promise.all([provider.getBlock('latest').catch(() => null), receiptPromise])
    const [block, l1FeeWei] = await Promise.all([
        readReceiptBlock(provider, receipt.blockHash, receipt.blockNumber),
        readL1FeeWei(provider, chain.chainId, receipt.transactionHash, receipt.blockHash),
    ])
    const price: BigNumber = receipt.effectiveGasPrice ?? tx.gasPrice ?? BigNumber.from(0)
    // A head newer than the inclusion block (a slow answer on a fast chain) gives no usable start: censored, not negative.
    const headUsable = head != null && block != null && head.timestamp <= block.timestamp
    const notes = [
        block == null ? `block ${receipt.blockHash} could not be read after the receipt` : undefined,
        head != null && block != null && !headUsable
            ? 'head block newer than the inclusion block: blockSeconds omitted'
            : undefined,
    ].filter((n) => n != null)
    return {
        receipt,
        measureNote: notes.length === 0 ? undefined : notes.join('; '),
        measure: {
            txHash: receipt.transactionHash,
            gasUsed: receipt.gasUsed.toString(),
            effectiveGasPrice: price.toString(),
            feeWei: receipt.gasUsed.mul(price).toString(),
            l1FeeWei,
            blockNumber: receipt.blockNumber,
            blockTimestamp: block?.timestamp,
            submittedAtMs,
            includedAtMs,
            confirmSeconds: Math.max(0, (includedAtMs - submittedAtMs) / 1000),
            blockSeconds: headUsable ? block.timestamp - head.timestamp : undefined,
        },
    }
}

/** Length of the canonical payload behind a CID this run pinned or verified, and of the CID string. */
function payloadSize(ctx: Ctx, cid: string): Pick<StepRecord, 'payloadBytes' | 'cidLength'> {
    return { payloadBytes: ctx.verify.cache.get(cid)?.byteLength, cidLength: cid.length }
}

// Chains a token has been on, per run, to tell a first arrival (slots zero to non-zero) from a return.
const visits = new WeakMap<Ctx, Set<string>>()
function visited(ctx: Ctx): Set<string> {
    let set = visits.get(ctx)
    if (set == null) visits.set(ctx, (set = new Set()))
    return set
}
const visitKey = (chain: Chain, tokenId: BigNumber) => `${chain.network}|${tokenId.toString()}`

// Last id this run minted per chain. A load-balanced RPC can answer `nextTokenId` from a backend that has not seen that
// mint yet; a stale id makes the next mint revert UnexpectedTokenId in every gas estimate.
const lastMinted = new WeakMap<Ctx, Map<string, BigNumber>>()
function minted(ctx: Ctx): Map<string, BigNumber> {
    let map = lastMinted.get(ctx)
    if (map == null) lastMinted.set(ctx, (map = new Map()))
    return map
}

// Why the run stopped sending, once a send was not picked up by LayerZero: the tasks start no further flow.
const stops = new WeakMap<Ctx, string>()
export const runStopped = (ctx: Ctx): string | undefined => stops.get(ctx)
const stoppedChains = new WeakMap<ethers.providers.Provider, string>()
type Pending = { hash: string; receipt?: ContractReceipt }
const pendingTransactions = new Map<ethers.providers.Provider, Pending>()
const scalePendingTransactions = new Map<ethers.providers.Provider, Map<string, Pending>>()
function rememberPending(provider: ethers.providers.Provider, hash: string, receipt?: ContractReceipt, all = false) {
    if (!all) {
        pendingTransactions.set(provider, { hash, receipt })
        return
    }
    let pending = scalePendingTransactions.get(provider)
    if (pending == null) scalePendingTransactions.set(provider, (pending = new Map()))
    pending.set(hash, { hash, receipt })
}
export function clearPendingTransaction(hash?: string) {
    if (!hash) return
    for (const [provider, pending] of pendingTransactions)
        if (pending.hash === hash) pendingTransactions.delete(provider)
    for (const [provider, pending] of scalePendingTransactions)
        if (pending.delete(hash) && pending.size === 0) scalePendingTransactions.delete(provider)
}
export function stopRun(ctx: Ctx, reason: string) {
    if (runStopped(ctx) == null) stops.set(ctx, reason)
}
export function assertChainRunning(chain: Chain) {
    const reason = stoppedChains.get(chain.wallet.provider)
    if (reason) throw new FlowFailed(reason)
}
/** Signal writes a checkpoint immediately; the active step may then finish and finally writes it again. */
export function installRunSignals(
    ctx: Ctx,
    chains: readonly Chain[],
    flows: FlowRecord[],
    checkpoint: () => void
): () => void {
    const stop = (signal: string) => {
        const reason = `interrupted by ${signal}`
        stops.set(ctx, reason)
        for (const chain of chains) stoppedChains.set(chain.wallet.provider, reason)
        const active = flows[flows.length - 1]
        if (active) {
            active.status = 'FAIL'
            active.error = reason
            for (const chain of chains) {
                const legacy = pendingTransactions.get(chain.wallet.provider)
                const all = scalePendingTransactions.get(chain.wallet.provider)?.values() ?? []
                for (const pending of [...(legacy ? [legacy] : []), ...all]) {
                    const hash = pending.hash
                    const provisional = pending.receipt != null && !isSealedBlockHash(pending.receipt.blockHash)
                    if (!active.steps.some((s) => s.txHash === hash))
                        active.steps.push({
                            step: provisional
                                ? 'submitted, receipt unsealed'
                                : pending?.receipt
                                  ? 'confirmed transaction, step unfinished'
                                  : 'submitted, no receipt seen',
                            network: chain.network,
                            txHash: hash,
                            provisionalReceipt: provisional ? pending?.receipt : undefined,
                            gasUsed: provisional ? undefined : pending?.receipt?.gasUsed.toString(),
                            blockNumber: provisional ? undefined : pending?.receipt?.blockNumber,
                            checks: [check('step recorded', false, reason)],
                        })
                }
            }
        }
        log(`STOP: ${reason}; writing report checkpoint`)
        process.exitCode = signal === 'SIGINT' ? 130 : 143
        checkpoint()
    }
    const onInt = () => stop('SIGINT')
    const onTerm = () => stop('SIGTERM')
    process.on('SIGINT', onInt)
    process.on('SIGTERM', onTerm)
    return () => {
        process.off('SIGINT', onInt)
        process.off('SIGTERM', onTerm)
        for (const chain of chains) {
            stoppedChains.delete(chain.wallet.provider)
            pendingTransactions.delete(chain.wallet.provider)
            scalePendingTransactions.delete(chain.wallet.provider)
        }
    }
}
export const interruptedStatus = (ctx: Ctx): 'interrupted' | undefined =>
    runStopped(ctx)?.startsWith('interrupted by ') ? 'interrupted' : undefined

/** `nextTokenId` once it is past the last id this run minted on the chain; fails before anything is pinned or sent. */
export async function nextIdAfterLastMint(ctx: Ctx, chain: Chain): Promise<BigNumber> {
    const last = minted(ctx).get(chain.network)
    const next = await eventually(
        () => chain.distillery.nextTokenId() as Promise<BigNumber>,
        (id) => last == null || id.gt(last)
    )
    if (last != null && !next.gt(last))
        throw new FlowFailed(`nextTokenId on ${chain.network} still ${next} after minting ${last} (lagging RPC?)`)
    return next
}

/** `nextTokenId` after a refused mint, polled until it equals `next` so a lagging backend is not taken for a change. */
export const nextIdAfterRefusal = (chain: Chain, next: BigNumber): Promise<BigNumber> =>
    eventually(
        () => chain.distillery.nextTokenId() as Promise<BigNumber>,
        (id) => id.eq(next)
    )

const LOCATE_ATTEMPTS = 6

export type ReceiveLookup = {
    readonly received?: ReceiveRecord
    readonly status: 'found' | 'not found' | 'error'
}

/**
 * Finds the `ONFTReceived` event of `guid` on the destination, starting at `fromBlock`, in ranges small enough for
 * public RPCs. The token was already seen on the destination, so the event exists: a backend that trails (the head or
 * the logs not yet served) or a rate limit is retried a few times, five seconds apart, before the lookup gives up. The
 * outcome is returned and stored, so a hop without a primary-clock value is explained and counted, never silent.
 * The event block is read by hash, then by height if needed; either result must match the event's block hash.
 */
export async function locateReceived(
    destination: Chain,
    guid: string,
    fromBlock: number,
    retry: { attempts: number; delayMs: number } = { attempts: LOCATE_ATTEMPTS, delayMs: POLL_MS }
): Promise<ReceiveLookup> {
    const provider = destination.wallet.provider
    const filter = destination.distillery.filters.ONFTReceived(guid)
    let status: ReceiveLookup['status'] = 'not found'
    for (let attempt = 1; attempt <= retry.attempts; attempt++) {
        try {
            const head = await provider.getBlockNumber()
            let first: ethers.providers.Log | undefined
            await getLogsChunked(provider, filter, fromBlock, head, (logs) => {
                first = logs[0]
                return first != null
            })
            if (first != null) {
                const block = await readReceiptBlock(provider, first.blockHash, first.blockNumber)
                if (block != null) {
                    const receiveReceipt = await provider.getTransactionReceipt(first.transactionHash).catch(() => null)
                    return {
                        status: 'found',
                        received: {
                            txHash: first.transactionHash,
                            blockNumber: first.blockNumber,
                            blockTimestamp: block.timestamp,
                            gasUsed: receiveReceipt?.gasUsed.toString(),
                        },
                    }
                }
                status = 'error'
            } else status = 'not found'
        } catch (error) {
            // Only the error code is logged: the message of an RPC error can carry the request URL and its API key.
            log(
                `  ONFTReceived lookup on ${destination.network} failed: ${(error as { code?: string }).code ?? 'error'}`
            )
            status = 'error'
        }
        if (attempt < retry.attempts) await sleep(retry.delayMs)
    }
    return { status }
}

export function eventArgs(chain: Chain, receipt: ContractReceipt, name: string): ethers.utils.Result | undefined {
    for (const entry of receipt.logs) {
        if (entry.address.toLowerCase() !== chain.distillery.address.toLowerCase()) continue
        try {
            const parsed = chain.distillery.interface.parseLog(entry)
            if (parsed.name === name) return parsed.args
        } catch {
            // log of another event signature
        }
    }
    return undefined
}

function passportMatches(actual: Passport | null, revision: number, cid: string): boolean {
    return actual != null && actual.revision === revision && actual.cid === cid
}

function describePassport(passport: Passport | null): string {
    return passport == null ? 'reverts' : `(revision ${passport.revision}, ${passport.cid})`
}

/** History hash of these CIDs as revisions 0..n-1 of `tokenId`: the recurrence of `PassportRegistry.nextHistoryHash`. */
export function expectedHistoryHash(tokenId: BigNumber, cids: readonly string[]): string {
    return cids.reduce(
        (previous, cid, revision) =>
            ethers.utils.keccak256(
                ethers.utils.defaultAbiCoder.encode(
                    ['bytes32', 'uint256', 'uint64', 'string'],
                    [previous, tokenId, revision, cid]
                )
            ),
        ethers.constants.HashZero
    )
}

/** The stored history hash commits to the CIDs this run wrote for the token, revisions 0 to the one read (P8). */
function historyHashCheck(ctx: Ctx, tokenId: BigNumber, passport: Passport | null, fallback: readonly string[]) {
    const cids = (ctx.histories.get(tokenId.toString()) ?? fallback).slice(0, (passport?.revision ?? -1) + 1)
    const expected = expectedHistoryHash(tokenId, cids)
    return check(
        "history hash commits to the run's CIDs",
        passport != null && cids.length === passport.revision + 1 && passport.historyHash === expected,
        passport == null ? 'reverts' : `${passport.historyHash} (expected ${expected} over ${cids.length} CIDs)`
    )
}

// Payloads ------------------------------------------------------------------------------------------------------

async function pinPayload(
    ctx: Ctx,
    tokenId: bigint | string,
    revision: number,
    previousCid: string | null,
    description: string
): Promise<string> {
    if (runStopped(ctx)) throw new FlowFailed(`the run stopped sending after ${runStopped(ctx)}`)
    const envelope = buildEnvelope({
        deploymentId: ctx.deploymentId,
        tokenId,
        revision,
        previousCid,
        kind: 'cask',
        granularity: 'item',
        data: caskData(String(tokenId), `${description} (run ${ctx.runId})`),
    })
    const { cid, bytes } = await pinEnvelope(ctx.pinata, envelope, ctx.verify.fetchOptions)
    ctx.verify.cache.set(cid, bytes)
    log(`  pinned revision ${revision} of ${tokenId}: ${cid} (${bytes.byteLength} bytes)`)
    return cid
}

// Fetches the payload behind a passport that was just read and computes content, binding and history.
async function verifyPassport(ctx: Ctx, tokenId: BigNumber, passport: Passport | null): Promise<Verification> {
    if (passport == null) throw new FlowFailed(`passportOf(${tokenId}) reverted, nothing to verify`)
    return verifyOnChainRecord(
        ctx.verify,
        { tokenId: tokenId.toString(), revision: passport.revision, cid: passport.cid },
        ctx.histories.get(tokenId.toString())
    )
}

function verificationCheck(verification: Verification): Check {
    const reasons = (['content', 'binding', 'history'] as const)
        .filter((k) => verification[k].status !== 'verified')
        .map((k) => `${k} ${verification[k].status}: ${verification[k].reason}`)
    return check(
        'payload verified (content, binding, history)',
        allVerified(verification),
        reasons.length === 0 ? 'content, binding and history verified' : reasons.join('; ')
    )
}

export function historyOf(ctx: Ctx, tokenId: BigNumber): string[] {
    const history = ctx.histories.get(tokenId.toString())
    if (history == null) throw new FlowFailed(`no payload of ${tokenId} was written by this run`)
    return history
}

function recordCid(ctx: Ctx, tokenId: BigNumber, revision: number, cid: string) {
    const key = tokenId.toString()
    const history = ctx.histories.get(key) ?? []
    if (history.length !== revision)
        throw new FlowFailed(`history of ${key} has ${history.length} entries at ${revision}`)
    ctx.histories.set(key, [...history, cid])
}

// Steps ---------------------------------------------------------------------------------------------------------

/** Mints a passport on `chain` to `to` (the account of the harness unless given). The operator pays and stays owner. */
export async function mintStep(
    ctx: Ctx,
    flow: FlowRecord,
    chain: Chain,
    description: string,
    to: string = chain.wallet.address,
    // `step: 'mint (setup)'` marks a mint that prepares another operation: it stays in the report, out of the mint cells.
    options: { step?: string } = {}
): Promise<BigNumber> {
    const self = to
    const expectedId = await nextIdAfterLastMint(ctx, chain)
    const cid = await pinPayload(ctx, expectedId.toBigInt(), 0, null, description)
    log(`[${chain.network}] mint(${self}, ${expectedId}, ${cid})`)
    const { receipt, measure, measureNote } = await timedTx(chain, () => chain.distillery.mint(self, expectedId, cid))
    const issued = eventArgs(chain, receipt, 'PassportIssued')
    const tokenId = issued?.tokenId as BigNumber
    flow.tokenId = tokenId?.toString()
    if (tokenId != null) {
        recordCid(ctx, tokenId, 0, cid)
        visited(ctx).add(visitKey(chain, tokenId))
        minted(ctx).set(chain.network, tokenId)
    }
    const state = `${expectedId.mod(ID_SPACE).isZero() ? 'first mint on chain' : 'later mint'}, to ${
        self === chain.wallet.address ? 'self' : 'other address'
    }`
    const owner = await eventually(
        () => ownerOrNull(chain, tokenId),
        (o) => o === self
    )
    const passport = await eventually(
        () => passportOrNull(chain, tokenId),
        (p) => passportMatches(p, 0, cid)
    )
    const uri = await eventually(
        () => tokenUriOrEmpty(chain, tokenId),
        (u) => u === `ipfs://${cid}`
    )
    const origin = (await chain.distillery.originOf(tokenId)) as BigNumber
    const verification = await verifyPassport(ctx, tokenId, passport)
    finishStep(flow, {
        step: options.step ?? 'mint',
        network: chain.network,
        ...measure,
        measureNote,
        ...payloadSize(ctx, cid),
        state,
        verification,
        checks: [
            check('PassportIssued emitted', issued != null, `tokenId ${tokenId}`),
            check(
                'tokenId is the expectedTokenId and next in the chain namespace',
                tokenId?.eq(expectedId) ?? false,
                `${tokenId} == ${expectedId}`
            ),
            check('originOf is this chain', origin.eq(chain.chainId), `${origin} == ${chain.chainId}`),
            check('recipient holds the token', owner === self, `ownerOf ${owner}`),
            check('passport is revision 0', passportMatches(passport, 0, cid), describePassport(passport)),
            historyHashCheck(ctx, tokenId, passport, [cid]),
            check('tokenURI resolves the CID', uri === `ipfs://${cid}`, uri),
            verificationCheck(verification),
        ],
    })
    return tokenId
}

/**
 * Mints with a CID string that has no payload behind it (nothing is pinned or verified). For the cases that test the
 * contract rather than the payload: the longest CID the contract accepts. The token is test data; its ledger entry says so.
 */
export async function mintRawStep(
    ctx: Ctx,
    flow: FlowRecord,
    chain: Chain,
    cid: string,
    to: string = chain.wallet.address
): Promise<BigNumber> {
    const expectedId = await nextIdAfterLastMint(ctx, chain)
    log(`[${chain.network}] mint(${to}, ${expectedId}, <${cid.length}-byte string without a payload>)`)
    const { receipt, measure, measureNote } = await timedTx(chain, () => chain.distillery.mint(to, expectedId, cid))
    const issued = eventArgs(chain, receipt, 'PassportIssued')
    const tokenId = issued?.tokenId as BigNumber
    flow.tokenId = tokenId?.toString()
    if (tokenId != null) {
        visited(ctx).add(visitKey(chain, tokenId))
        minted(ctx).set(chain.network, tokenId)
    }
    const passport = await eventually(
        () => passportOrNull(chain, tokenId),
        (p) => passportMatches(p, 0, cid)
    )
    finishStep(flow, {
        step: 'mint',
        network: chain.network,
        ...measure,
        measureNote,
        cidLength: cid.length,
        state: `raw ${cid.length}-byte CID, no payload`,
        checks: [
            check('PassportIssued emitted', issued != null, `tokenId ${tokenId}`),
            check('the contract stored the string', passportMatches(passport, 0, cid), describePassport(passport)),
            historyHashCheck(ctx, tokenId, passport, [cid]),
        ],
    })
    return tokenId
}

/** The holder approves `operator` for one token. */
export async function approveStep(
    ctx: Ctx,
    flow: FlowRecord,
    chain: Chain,
    tokenId: BigNumber,
    operator: string
): Promise<void> {
    log(`[${chain.network}] approve(${operator}, ${tokenId})`)
    const { measure, measureNote } = await timedTx(chain, () => chain.distillery.approve(operator, tokenId))
    const approved = await eventually(
        () => chain.distillery.getApproved(tokenId) as Promise<string>,
        (a) => a === operator
    )
    finishStep(flow, {
        step: 'approve',
        network: chain.network,
        ...measure,
        measureNote,
        checks: [check('operator is approved for the token', approved === operator, `getApproved ${approved}`)],
    })
}

// Reads the revision just before and pins a payload that continues from it. Nothing is sent on chain.
export async function prepareRevision(
    ctx: Ctx,
    chain: Chain,
    tokenId: BigNumber,
    description: string
): Promise<PreparedRevision> {
    const known = ctx.histories.get(tokenId.toString()) ?? []
    const current = await eventually(
        () => passportOrNull(chain, tokenId),
        (p) => p != null && p.revision === known.length - 1 && p.cid === known[known.length - 1]
    )
    if (current == null || current.revision !== known.length - 1) {
        throw new FlowFailed(`${chain.network}: passport of ${tokenId} is ${describePassport(current)} before revising`)
    }
    const cid = await pinPayload(ctx, tokenId.toBigInt(), current.revision + 1, current.cid, description)
    return { expectedRevision: current.revision, cid }
}

export async function reviseStep(
    ctx: Ctx,
    flow: FlowRecord,
    chain: Chain,
    tokenId: BigNumber,
    prepared: PreparedRevision,
    // Appended to the slot state, for example `by approved operator`.
    note?: string
): Promise<void> {
    const { expectedRevision, cid } = prepared
    const revision = expectedRevision + 1
    log(`[${chain.network}] revise(${tokenId}, ${expectedRevision}, ${cid})`)
    const { receipt, measure, measureNote } = await timedTx(chain, () =>
        chain.distillery.revise(tokenId, expectedRevision, cid)
    )
    recordCid(ctx, tokenId, revision, cid)
    const revised = eventArgs(chain, receipt, 'PassportRevised')
    const passport = await eventually(
        () => passportOrNull(chain, tokenId),
        (p) => passportMatches(p, revision, cid)
    )
    const verification = await verifyPassport(ctx, tokenId, passport)
    finishStep(flow, {
        step: `revise (expectedRevision ${expectedRevision})`,
        network: chain.network,
        ...measure,
        measureNote,
        ...payloadSize(ctx, cid),
        state: `depth ${revision}${note == null ? '' : `, ${note}`}`,
        verification,
        checks: [
            check(
                'PassportRevised emitted with the sender as author',
                revised != null && Number(revised.revision) === revision && revised.author === chain.wallet.address,
                revised == null ? 'missing' : `revision ${revised.revision}, author ${revised.author}`
            ),
            check(
                `passport is revision ${revision}`,
                passportMatches(passport, revision, cid),
                describePassport(passport)
            ),
            historyHashCheck(ctx, tokenId, passport, []),
            verificationCheck(verification),
        ],
    })
}

export async function reviseNow(ctx: Ctx, flow: FlowRecord, chain: Chain, tokenId: BigNumber, description: string) {
    await reviseStep(ctx, flow, chain, tokenId, await prepareRevision(ctx, chain, tokenId, description))
}

export async function transferStep(
    ctx: Ctx,
    flow: FlowRecord,
    chain: Chain,
    tokenId: BigNumber,
    revision: number,
    cid: string,
    // Fresh address with no key kept: the token is parked there for good (cost: one testnet mint).
    recipient: string = Wallet.createRandom().address,
    method: 'transferFrom' | 'safeTransferFrom' = 'safeTransferFrom'
): Promise<void> {
    const self = await chain.distillery.ownerOf(tokenId)
    log(`[${chain.network}] ${method}(${self}, ${recipient}, ${tokenId}) by ${chain.wallet.address}`)
    const { measure, measureNote } = await timedTx(chain, () =>
        method === 'transferFrom'
            ? chain.distillery.transferFrom(self, recipient, tokenId)
            : chain.distillery['safeTransferFrom(address,address,uint256)'](self, recipient, tokenId)
    )
    const owner = await eventually(
        () => ownerOrNull(chain, tokenId),
        (o) => o === recipient
    )
    const passport = await passportOrNull(chain, tokenId)
    // The former owner and the account that sent the transfer (an approved address loses its approval) can no longer
    // move the token. The call repeats the transfer itself, so a backend that has not seen it yet lets it succeed and is
    // asked again; once current it reverts ERC721InsufficientApproval.
    const formerHolderBlocked = await eventually(
        async () => {
            for (const from of new Set([self, chain.wallet.address])) {
                try {
                    await chain.distillery
                        .connect(chain.wallet.provider)
                        .callStatic.transferFrom(self, recipient, tokenId, { from })
                    return false
                } catch (error) {
                    if (revertName(error) !== 'ERC721InsufficientApproval') throw error
                }
            }
            return true
        },
        (blocked) => blocked
    )
    // PROTOCOL.md: the new holder, once it holds the token, cannot revise it; only an issuer writes the passport.
    let holderRefused = false
    if (owner === recipient) {
        try {
            await chain.distillery
                .connect(chain.wallet.provider)
                .callStatic.revise(tokenId, revision, cid, { from: recipient })
        } catch (error) {
            if (revertName(error) !== 'NotIssuer') throw error
            holderRefused = true
        }
    }
    const verification = await verifyPassport(ctx, tokenId, passport)
    finishStep(flow, {
        step: 'transfer',
        network: chain.network,
        ...measure,
        measureNote,
        ...payloadSize(ctx, cid),
        state: `to a new holder, ${method}${self === chain.wallet.address ? '' : ', by approved operator'}`,
        verification,
        checks: [
            check('recipient holds the token', owner === recipient, `ownerOf ${owner}`),
            check(
                'passport unchanged by the transfer',
                passportMatches(passport, revision, cid),
                describePassport(passport)
            ),
            historyHashCheck(ctx, tokenId, passport, []),
            check(
                'the new holder cannot revise',
                holderRefused,
                'with ownerOf the new holder, revise() eth_call reverts with NotIssuer'
            ),
            check(
                'former holder and sender can no longer move the token',
                formerHolderBlocked,
                'transferFrom() eth_call reverts with ERC721InsufficientApproval'
            ),
            verificationCheck(verification),
        ],
    })
}

export type ExpectedRevert = { readonly name: string; readonly args: readonly string[] }

// A call that must revert with a given custom error. The error is decoded from the ABI (eth_call), then the same call
// is broadcast with a fixed gas limit so that the failure is also on chain: a mined transaction with status 0.
// A call that succeeds is never broadcast.
export async function expectRevert(
    chain: Chain,
    expected: ExpectedRevert,
    simulate: () => Promise<unknown>,
    broadcast: (overrides: { gasLimit: number }) => Promise<ethers.ContractTransaction>,
    // The ABI the error is decoded with: the contract's own, or another contract's (the endpoint) for its errors.
    iface: ethers.utils.Interface = chain.distillery.interface
): Promise<{ checks: Check[]; txHash?: string; gasUsed?: string; outcome: string }> {
    const wanted = formatRevert({ name: expected.name, args: [...expected.args] })
    let decoded: ReturnType<typeof decodeRevert>
    let simulateError: string | undefined
    let matches = false
    // A simulation that succeeds, or reverts with other arguments (UnexpectedTokenId with the id before the last mint),
    // can be a backend that has not seen the previous transaction yet (load-balanced RPC), so it is repeated for
    // READ_TIMEOUT_MS; a call that still does not revert as expected after that is a real finding.
    const deadline = Date.now() + READ_TIMEOUT_MS
    for (;;) {
        decoded = undefined
        try {
            await simulate()
            simulateError = 'call did not revert'
        } catch (error) {
            simulateError = undefined
            decoded = decodeRevert(iface, error)
            if (decoded == null)
                simulateError = `reverted without a decodable custom error: ${(error as Error).message}`
        }
        matches =
            decoded != null &&
            decoded.name === expected.name &&
            decoded.args.length === expected.args.length &&
            decoded.args.every((a, i) => a === expected.args[i])
        if (matches || (decoded == null && simulateError !== 'call did not revert') || Date.now() >= deadline) break
        log(
            `[${chain.network}] ${expected.name}: ${decoded == null ? 'the call did not revert yet' : `the call reverted with ${formatRevert(decoded)}`}; repeating (lagging RPC?)`
        )
        await sleep(POLL_MS)
    }
    const outcome = decoded != null ? formatRevert(decoded) : (simulateError ?? 'unknown')
    const checks = [check(`eth_call reverts with ${wanted}`, matches, outcome)]
    if (!matches) return { checks, outcome }

    let tx: ethers.ContractTransaction
    try {
        assertChainRunning(chain)
        tx = await broadcast({ gasLimit: REVERT_TX_GAS_LIMIT })
    } catch (error) {
        // A node that simulates before accepting a transaction refuses it with the same custom error.
        const rejected = decodeRevert(iface, error)
        checks.push(
            check(
                'transaction reverts',
                rejected?.name === expected.name,
                `the node refused the transaction with ${rejected ? formatRevert(rejected) : (error as Error).message}`
            )
        )
        return { checks, outcome }
    }
    let status: number | undefined
    let gasUsed: string | undefined
    try {
        const receipt = await waitReceipt(chain, tx, true)
        status = receipt.status
        gasUsed = receipt.gasUsed.toString()
    } catch (error) {
        const receipt = (error as { receipt?: ContractReceipt }).receipt
        if (receipt == null) throw error
        status = receipt.status
        gasUsed = receipt.gasUsed.toString()
    }
    checks.push(check('transaction mined and reverted on chain', status === 0, `status ${status}, tx ${tx.hash}`))
    return { checks, txHash: tx.hash, gasUsed, outcome }
}

// Second revision prepared against a revision that has already moved on: must revert StaleRevision.
async function staleReviseStep(
    ctx: Ctx,
    flow: FlowRecord,
    chain: Chain,
    tokenId: BigNumber,
    stale: PreparedRevision,
    currentRevision: number,
    currentCid: string
): Promise<void> {
    log(`[${chain.network}] revise(${tokenId}, ${stale.expectedRevision}, ${stale.cid}) with a stale revision`)
    const result = await expectRevert(
        chain,
        { name: 'StaleRevision', args: [String(stale.expectedRevision), String(currentRevision)] },
        () => chain.distillery.callStatic.revise(tokenId, stale.expectedRevision, stale.cid),
        (overrides) => chain.distillery.revise(tokenId, stale.expectedRevision, stale.cid, overrides)
    )
    const passport = await passportOrNull(chain, tokenId)
    const verification = await verifyPassport(ctx, tokenId, passport)
    finishStep(flow, {
        step: `revise (stale expectedRevision ${stale.expectedRevision})`,
        network: chain.network,
        txHash: result.txHash,
        gasUsed: result.gasUsed,
        outcome: `expected revert ${result.outcome}`,
        verification,
        checks: [
            ...result.checks,
            check(
                'passport still holds the first revision',
                passportMatches(passport, currentRevision, currentCid),
                describePassport(passport)
            ),
            verificationCheck(verification),
        ],
    })
}

// mint with an expectedTokenId that is not nextTokenId(): must revert UnexpectedTokenId.
async function wrongTokenIdStep(ctx: Ctx, flow: FlowRecord, chain: Chain): Promise<void> {
    const self = chain.wallet.address
    // A stale `next` would make `wrong` the real next id, and the broadcast of the expected revert would then mint it.
    const next = await nextIdAfterLastMint(ctx, chain)
    const wrong = next.add(1)
    // The payload is built for the wrong id and never uploaded: it must not reach the chain.
    const cid = computeCidV1(
        canonicalizeEnvelope(
            buildEnvelope({
                deploymentId: ctx.deploymentId,
                tokenId: wrong.toBigInt(),
                revision: 0,
                previousCid: null,
                data: caskData(wrong.toString(), `wrong expectedTokenId (run ${ctx.runId})`),
            })
        )
    )
    log(`[${chain.network}] mint(${self}, ${wrong}, ${cid}) with a wrong expectedTokenId (next is ${next})`)
    const result = await expectRevert(
        chain,
        { name: 'UnexpectedTokenId', args: [wrong.toString(), next.toString()] },
        () => chain.distillery.callStatic.mint(self, wrong, cid),
        (overrides) => chain.distillery.mint(self, wrong, cid, overrides)
    )
    const after = await nextIdAfterRefusal(chain, next)
    finishStep(flow, {
        step: 'mint (wrong expectedTokenId)',
        network: chain.network,
        txHash: result.txHash,
        gasUsed: result.gasUsed,
        outcome: `expected revert ${result.outcome}`,
        checks: [...result.checks, check('nextTokenId unchanged', after.eq(next), `${after} == ${next}`)],
    })
}

// Scan indexes a message a little after delivery; ask a few times until it reports DELIVERED.
async function lzScanSettled(txHash: string): Promise<string> {
    let status = await lzScanStatus(txHash)
    for (let i = 0; i < 6 && !status.startsWith('DELIVERED'); i++) {
        await sleep(POLL_MS)
        status = await lzScanStatus(txHash)
    }
    return status
}

export async function sendStep(
    ctx: Ctx,
    flow: FlowRecord,
    source: Chain,
    destination: Chain,
    tokenId: BigNumber,
    revision: number,
    cid: string,
    // `verify: false` is for a token whose CID is a bare string with no payload behind it (the maximum-length case).
    options: { verify?: boolean } = {}
): Promise<ContractReceipt> {
    const verify = options.verify ?? true
    const stopped = runStopped(ctx)
    if (stopped != null) throw new FlowFailed(`the run stopped sending after ${stopped}`)
    const self = source.wallet.address
    const timeoutSeconds = ctx.timeoutSeconds
    // The token must be absent on the destination first, so a lagging RPC cannot fake an early delivery.
    const ownerBefore = await eventually(
        () => ownerOrNull(destination, tokenId),
        (o) => o === null
    )
    const sendParam = {
        dstEid: destination.eid,
        to: ethers.utils.hexZeroPad(self, 32),
        tokenId,
        extraOptions: '0x', // the enforced lzReceive gas from layerzero.config.ts applies
        composeMsg: '0x',
        onftCmd: '0x',
    }
    const fee = await source.distillery.quoteSend(sendParam, false)
    const nativeFee = fee.nativeFee as BigNumber
    if (ctx.maxSendFeeWei != null && nativeFee.gt(ctx.maxSendFeeWei)) {
        throw new FlowFailed(
            `${source.network} -> ${destination.network}: the send is quoted at ${ethers.utils.formatEther(nativeFee)}, above the ceiling of ${ethers.utils.formatEther(ctx.maxSendFeeWei)} (--max-send-fee); nothing was sent`
        )
    }
    log(
        `[${source.network}] send(${tokenId}) to ${destination.network} (eid ${destination.eid}), fee ${ethers.utils.formatEther(nativeFee)}`
    )
    // Where to start looking for ONFTReceived on the destination, with a few blocks of margin for a lagging RPC.
    const destinationHead = await destination.wallet.provider.getBlockNumber()
    const firstArrival = !visited(ctx).has(visitKey(destination, tokenId))
    const { receipt, measure, measureNote } = await timedTx(source, () =>
        source.distillery.send(sendParam, { nativeFee, lzTokenFee: 0 }, self, { value: nativeFee })
    )
    flow.steps.push({
        step: `send ${source.network} -> ${destination.network}`,
        network: source.network,
        ...measure,
        nativeFee: nativeFee.toString(),
        delivered: false,
        checks: [check('delivery observed', false, 'waiting for destination')],
    })
    // Without the source block timestamp neither delivery clock has a start: the hop is delivered but unmeasured.
    const sentAt = measure.blockTimestamp
    const sent = eventArgs(source, receipt, 'ONFTSent')
    log(`  guid ${sent?.guid}, ${LZ_SCAN_UI}/${receipt.transactionHash}`)
    const sourceOwner = await eventually(
        () => ownerOrNull(source, tokenId),
        (o) => o === null
    )

    // Delivery: the token appears on the destination, minted to the receiver. Scan's record of the send is read every
    // minute (PROTOCOL.md, early stop; stop criteria on Scan's view): no record after the grace period, or a record not
    // delivered after the stuck limit, ends the hop and the run after one more read of the destination; a terminal
    // status (FAILED, BLOCKED, PAYLOAD_STORED, ...) ends the hop at once.
    const waitStart = Date.now()
    const deadline = waitStart + timeoutSeconds * 1000
    const limits = { graceSeconds: ctx.scanGraceSeconds, stuckSeconds: ctx.scanStuckSeconds }
    const packetLog = receipt.logs
        .map((l) => {
            try {
                return ENDPOINT_IFACE.parseLog(l)
            } catch {
                return null
            }
        })
        .find((l) => l?.name === 'PacketSent')
    const packet = packetLog ? decodePacket(packetLog.args.encodedPayload as string) : null
    let destinationOwner: string | null = null
    let scanEnd: string | undefined
    let scanCheckedAt: number | undefined
    let consecutiveErrors = 0
    while (Date.now() < deadline && runStopped(ctx) == null) {
        destinationOwner = await ownerOrNull(destination, tokenId)
        if (destinationOwner != null) break
        const now = Date.now()
        if (scanCheckedAt == null || now - scanCheckedAt >= SCAN_CHECK_MS) {
            scanCheckedAt = now
            const elapsed = Math.round((now - waitStart) / 1000)
            const status = await lzScanStatus(receipt.transactionHash)
            consecutiveErrors = status.startsWith('scan ') && status !== 'scan HTTP 404' ? consecutiveErrors + 1 : 0
            const verdict = hopVerdict(status, elapsed, { ...limits, consecutiveErrors })
            if (verdict === 'no record' || verdict === 'stuck') {
                // One last look at the destination: a delivery that Scan has not caught up with is still a delivery.
                destinationOwner = await ownerOrNull(destination, tokenId)
                if (destinationOwner != null) break
                scanEnd =
                    verdict === 'no record'
                        ? consecutiveErrors >= 3
                            ? `LayerZero Scan unavailable after ${consecutiveErrors} consecutive errors and ${elapsed}s; destination delivery unobserved (${status}); stop criterion, not a LayerZero finding`
                            : `no record on LayerZero Scan ${elapsed}s after the send (${status}): taken as not picked up by LayerZero (stop criterion, PROTOCOL.md)`
                        : `LayerZero Scan still shows ${status} ${elapsed}s after the send: taken as stuck (stop criterion, PROTOCOL.md)`
                stops.set(ctx, `${source.network} -> ${destination.network} ${scanEnd}`)
                log(`  STOP: ${scanEnd}; the run sends nothing more`)
                break
            }
            if (verdict === 'failed') {
                scanEnd = `LayerZero Scan reports ${status} ${elapsed}s after the send; not waiting for the timeout`
                stops.set(ctx, `${source.network} -> ${destination.network} ${scanEnd}`)
                log(`  ${scanEnd}`)
                break
            }
            let payloadHash = 'unavailable (no PacketSent)'
            if (packet) {
                try {
                    const ep = new Contract(
                        await destination.distillery.endpoint(),
                        ENDPOINT_ABI,
                        destination.wallet.provider
                    )
                    payloadHash = await ep.inboundPayloadHash(
                        destination.distillery.address,
                        packet.srcEid,
                        packet.sender,
                        packet.nonce
                    )
                } catch (error) {
                    payloadHash = `read error ${(error as { code?: string }).code ?? 'unknown'}`
                }
            }
            log(
                `  waiting for ${destination.network} (${elapsed}s): ${status}; ownerOf=${destinationOwner ?? 'absent'}; inboundPayloadHash=${payloadHash}`
            )
        }
        await sleep(POLL_MS)
    }
    const deliverySeconds =
        destinationOwner == null || sentAt == null ? undefined : Math.round(Date.now() / 1000 - sentAt)
    if (destinationOwner != null) visited(ctx).add(visitKey(destination, tokenId))
    // Primary clock: block timestamp of ONFTSent to block timestamp of ONFTReceived (PROTOCOL.md, rule 2).
    const lookup =
        destinationOwner == null || sent == null
            ? undefined
            : await locateReceived(destination, sent.guid as string, Math.max(0, destinationHead - 5))
    const received = lookup?.received
    const deliverySecondsChain = received == null || sentAt == null ? undefined : received.blockTimestamp - sentAt
    const scanStatus = scanEnd != null ? scanEnd : await lzScanSettled(receipt.transactionHash)
    const passport =
        destinationOwner == null
            ? null
            : await eventually(
                  () => passportOrNull(destination, tokenId),
                  (p) => passportMatches(p, revision, cid)
              )
    const uri =
        destinationOwner == null
            ? ''
            : await eventually(
                  () => tokenUriOrEmpty(destination, tokenId),
                  (u) => u === `ipfs://${cid}`
              )
    const sourcePassport = await passportOrNull(source, tokenId)
    // Content, binding and history of the snapshot the destination now serves. Without a delivery there is nothing to read.
    const verification = !verify || passport == null ? undefined : await verifyPassport(ctx, tokenId, passport)

    finishStep(flow, {
        step: `send ${source.network} -> ${destination.network}`,
        network: source.network,
        ...measure,
        measureNote,
        ...payloadSize(ctx, cid),
        state: firstArrival ? 'first arrival' : 'return',
        nativeFee: nativeFee.toString(),
        delivered: destinationOwner != null,
        deliverySeconds,
        deliverySecondsChain,
        received,
        receivedLookup: lookup?.status,
        scanStatus,
        verification,
        checks: [
            check(
                'token absent on the destination before the send',
                ownerBefore === null,
                `ownerOf ${ownerBefore ?? 'reverts'}`
            ),
            check('ONFTSent emitted', sent != null && BigNumber.from(sent.tokenId).eq(tokenId), `guid ${sent?.guid}`),
            check('token burned on the source', sourceOwner === null, `ownerOf ${sourceOwner ?? 'reverts'}`),
            check('source no longer serves the passport', sourcePassport === null, describePassport(sourcePassport)),
            check(
                'token delivered to the receiver under the same tokenId',
                destinationOwner === self,
                destinationOwner == null
                    ? (scanEnd ?? `not delivered within ${timeoutSeconds}s; LayerZero Scan: ${scanStatus}`)
                    : `ownerOf ${destinationOwner} after ~${deliverySeconds}s; LayerZero Scan: ${scanStatus}`
            ),
            check(
                `destination carries (revision ${revision}, ${cid})`,
                passportMatches(passport, revision, cid),
                describePassport(passport)
            ),
            historyHashCheck(ctx, tokenId, passport, [cid]),
            check('destination tokenURI resolves the CID', uri === `ipfs://${cid}`, uri || 'n/a'),
            !verify
                ? check('payload verification skipped', true, 'the CID has no payload behind it by design')
                : verification != null
                  ? verificationCheck(verification)
                  : check('payload verified (content, binding, history)', false, 'no passport on the destination'),
        ],
    })
    return receipt
}

export async function runFlow(flows: FlowRecord[], name: string, body: (flow: FlowRecord) => Promise<void>) {
    const flow: FlowRecord = { flow: name, status: 'PASS', steps: [] }
    flows.push(flow)
    log(`=== ${name} ===`)
    try {
        await body(flow)
    } catch (error) {
        flow.status = 'FAIL'
        flow.error = error instanceof FlowFailed ? error.message : String((error as Error).stack ?? error)
        // The submission is recorded even though no receipt was seen, so the report names the transaction to reconcile.
        if (error instanceof TxNotConfirmed)
            flow.steps.push({
                step: error.provisionalReceipt ? 'submitted, receipt unsealed' : 'submitted, no receipt seen',
                provisionalReceipt: error.provisionalReceipt,
                network: error.network,
                txHash: error.txHash,
                checks: [check('sealed receipt seen', false, error.message)],
            })
        log(`FAIL ${name}: ${flow.error}`)
    }
    log(`=== ${name}: ${flow.status} ===`)
}

// Flows ---------------------------------------------------------------------------------------------------------

export async function localFlow(ctx: Ctx, flow: FlowRecord, chain: Chain) {
    const tokenId = await mintStep(ctx, flow, chain, `local ${chain.network}`)
    await reviseNow(ctx, flow, chain, tokenId, `local ${chain.network}`)
    const cid = historyOf(ctx, tokenId).slice(-1)[0]
    await transferStep(ctx, flow, chain, tokenId, 1, cid)
}

export async function staleFlow(ctx: Ctx, flow: FlowRecord, chain: Chain) {
    const tokenId = await mintStep(ctx, flow, chain, `stale ${chain.network}`)
    // Two revisions prepared against the same revision 0, as two editors working in parallel would.
    const first = await prepareRevision(ctx, chain, tokenId, `stale ${chain.network}, editor A`)
    const second = await prepareRevision(ctx, chain, tokenId, `stale ${chain.network}, editor B`)
    finishStep(flow, {
        step: 'prepare two revisions against revision 0',
        network: chain.network,
        checks: [
            check(
                'both prepared against the same revision',
                first.expectedRevision === 0 && second.expectedRevision === 0,
                `${first.expectedRevision}, ${second.expectedRevision}`
            ),
            check('the two payloads differ', first.cid !== second.cid, `${first.cid} vs ${second.cid}`),
        ],
    })
    await reviseStep(ctx, flow, chain, tokenId, first)
    await staleReviseStep(ctx, flow, chain, tokenId, second, 1, first.cid)
    await wrongTokenIdStep(ctx, flow, chain)
}

export async function roundTripFlow(ctx: Ctx, flow: FlowRecord, a: Chain, b: Chain) {
    const label = `round trip ${a.network} <-> ${b.network}`
    const tokenId = await mintStep(ctx, flow, a, label)
    await reviseNow(ctx, flow, a, tokenId, label)
    const history = () => historyOf(ctx, tokenId)
    await sendStep(ctx, flow, a, b, tokenId, 1, history()[1])
    await reviseNow(ctx, flow, b, tokenId, label)
    await sendStep(ctx, flow, b, a, tokenId, 2, history()[2])
}

export async function cycleFlow(ctx: Ctx, flow: FlowRecord, arbitrum: Chain, base: Chain, sepolia: Chain) {
    const label = 'cycle'
    const tokenId = await mintStep(ctx, flow, arbitrum, label)
    const history = () => historyOf(ctx, tokenId)
    await sendStep(ctx, flow, arbitrum, base, tokenId, 0, history()[0])
    await reviseNow(ctx, flow, base, tokenId, label)
    await sendStep(ctx, flow, base, sepolia, tokenId, 1, history()[1])
    await reviseNow(ctx, flow, sepolia, tokenId, label)
    await sendStep(ctx, flow, sepolia, arbitrum, tokenId, 2, history()[2])
}

// Checks the manifest and the accounts, and builds the run context shared by the live tasks (e2e:flows, e2e:latency).
/**
 * Per send, in the native coin of the source chain: a stop for a mispriced quote, far above the LayerZero fees of the
 * three chains (at most 0.00015 ETH in the quotes of 2026-10-19, eval3-deployment-readback-1792440181462.json).
 */
export const DEFAULT_MAX_SEND_FEE = '0.1'

export type RunOptions = {
    /** Ceiling for the fee of one send, in the native coin (decimal string). */
    readonly allowUnknownScan?: boolean
    readonly maxSendFee?: string
    /** Label of the observation window, for example `2026-10-20T08:00Z`. */
    readonly window?: string
    /** Every parameter of the task, for the run header. */
    readonly params: Readonly<Record<string, string | number | boolean>>
    /** The sends the run plans, by network name: Scan must show LayerZero handling them before it starts (`scanPreflight`). */
    readonly sends?: readonly { readonly from: string; readonly to: string }[]
}

/** The pathways of the planned sends, with this application's outbound nonce on each from the source endpoint. */
export async function plannedPathways(
    chains: readonly Chain[],
    sends: readonly { readonly from: string; readonly to: string }[]
): Promise<PlannedPathway[]> {
    const byName = (n: string) => {
        const c = chains.find((x) => x.network === n)
        if (c == null) throw new Error(`a planned send names ${n}, which is not a network of the run`)
        return c
    }
    const pathways: PlannedPathway[] = []
    for (const send of sends) {
        const [from, to] = [byName(send.from), byName(send.to)]
        const endpoint = new ethers.Contract(
            (await from.distillery.endpoint()) as string,
            ['function outboundNonce(address sender, uint32 dstEid, bytes32 receiver) view returns (uint64)'],
            from.wallet.provider
        )
        const receiver = (await from.distillery.peers(to.eid)) as string
        const nonce = (await endpoint.outboundNonce(from.distillery.address, to.eid, receiver)) as BigNumber
        pathways.push({
            from: { network: from.network, eid: from.eid, address: from.distillery.address },
            to: { network: to.network, eid: to.eid, address: ethers.utils.hexDataSlice(receiver, 12) },
            outboundNonce: nonce.toNumber(),
        })
    }
    return pathways
}

export async function setupRun(
    hre: HardhatRuntimeEnvironment,
    networks: string[],
    timeoutSeconds: number,
    runId: string,
    options: RunOptions = { params: {} }
) {
    const pinata = pinataConfigFromEnv(process.env)
    const manifest = readManifest(hre)
    if (manifest == null) throw new Error('deployments/manifest.json is missing (run lz:manifest)')
    const drift = manifestDrift(hre, manifest)
    if (drift.length > 0) throw new Error(`deployments/manifest.json is out of date:\n${drift.join('\n')}`)

    const chains = networks.map((n) => loadChain(hre, n.trim()))
    for (const chain of chains) {
        if (!manifest.chains.some((c) => c.network === chain.network)) {
            throw new Error(`${chain.network} is not part of deployment ${manifest.deploymentId}`)
        }
    }
    for (const chain of chains) {
        const [balance, owner, issuer, prefix] = await Promise.all([
            chain.wallet.getBalance(),
            chain.distillery.owner(),
            chain.distillery.isIssuer(chain.wallet.address),
            chain.distillery.idPrefix(),
        ])
        log(
            `${chain.network}: ${chain.distillery.address}, balance ${ethers.utils.formatEther(balance)}, idPrefix ${prefix}`
        )
        if (owner !== chain.wallet.address)
            throw new Error(`${chain.network}: account ${chain.wallet.address} is not the owner ${owner}`)
        if (issuer !== true) throw new Error(`${chain.network}: account ${chain.wallet.address} is not an issuer`)
        if (!BigNumber.from(prefix).eq(chain.chainId))
            throw new Error(`${chain.network}: idPrefix ${prefix} != chainId ${chain.chainId}`)
        if (balance.isZero()) throw new Error(`${chain.network}: account has no native balance`)
    }
    // Read only: Scan's record of every pathway the run will use, against the endpoint's outbound nonce (PROTOCOL.md).
    let preflight: string | undefined
    if (options.sends != null && options.sends.length > 0) {
        const result = await scanPreflight(await plannedPathways(chains, options.sends))
        preflight = describePreflight(result)
        log(`Scan preflight: ${preflight}`)
        const blocked = result.pathways.filter((v) => blocksRun(v, options.allowUnknownScan))
        if (blocked.length > 0)
            throw new Error(
                `LayerZero Scan does not have, or has stuck, a send of this application on ${blocked.map((v) => v.pathway).join(', ')}; nothing was sent. ` +
                    'If a run sent on it minutes ago, Scan may still be catching up: try again in a few minutes. Otherwise a later ' +
                    'nonce cannot be delivered before that one is verified, or skipped by the owner, which strands its token for good ' +
                    `(${preflight})`
            )
    }

    const ctx: Ctx = {
        runId,
        deploymentId: manifest.deploymentId,
        pinata,
        verify: { gateway: pinata.gateway, deploymentId: manifest.deploymentId, cache: new Map() },
        histories: new Map(),
        timeoutSeconds,
        maxSendFeeWei: ethers.utils.parseEther(options.maxSendFee ?? DEFAULT_MAX_SEND_FEE),
        scanGraceSeconds: SCAN_GRACE_SECONDS,
        scanStuckSeconds: SCAN_STUCK_SECONDS,
    }
    log(`Deployment ${ctx.deploymentId}, gateway ${pinata.gateway}, upload path ${pinata.uploadPath}`)
    const header: RunHeader = await buildRunHeader({
        root: hre.config.paths.root,
        deploymentId: manifest.deploymentId,
        chains: chains.map((c) => ({
            network: c.network,
            chainId: c.chainId,
            eid: c.eid,
            address: c.distillery.address,
            rpcUrl: httpNetwork(hre, c.network).url,
            provider: c.wallet.provider,
            recordBytecode: (readDeploymentRecord(hre, c.network) as unknown as { deployedBytecode?: string })
                .deployedBytecode,
        })),
        tools: toolVersions(hre.version),
        window: options.window,
        // the fee policy is part of every run: it can change how fast a transaction is included
        params: {
            ...options.params,
            priorityFeeFloorWei: PRIORITY_FEE_WEI.toNumber(),
            feePolicy: FEE_POLICY_ID,
            maxSendFee: options.maxSendFee ?? DEFAULT_MAX_SEND_FEE,
            ...(preflight != null
                ? {
                      scanGraceSeconds: SCAN_GRACE_SECONDS,
                      scanStuckSeconds: SCAN_STUCK_SECONDS,
                      scanPreflight: preflight,
                  }
                : {}),
        },
    })
    if (header.gitDirty) log('WARNING: the working tree is dirty; the report records it in its run header')
    return { ctx, chains, manifest, header }
}

task('e2e:flows', 'Runs the core WhiskyDistillery user flows against the live deployments')
    .addOptionalParam('networks', 'Comma-separated networks', 'arbitrum-sepolia,base-sepolia,sepolia', types.string)
    .addOptionalParam(
        'flows',
        `Comma-separated flow kinds: ${FLOW_KINDS.join(', ')}`,
        'local,stale,crosschain,cycle',
        types.string
    )
    .addOptionalParam('timeout', 'Seconds to wait for each cross-chain delivery', 1800, types.int)
    .addOptionalParam('window', 'Label of the observation window recorded in the run header', undefined, types.string)
    .addFlag('allowUnknownScan', 'Explicitly allow a Scan preflight that could not be read')
    .addOptionalParam(
        'maxSendFee',
        'Refuse a send quoted above this fee, in the native coin of the source chain',
        DEFAULT_MAX_SEND_FEE,
        types.string
    )
    .setAction(
        async (
            args: {
                networks: string
                flows: string
                timeout: number
                window?: string
                maxSendFee: string
                allowUnknownScan: boolean
            },
            hre
        ) => {
            const runId = String(Date.now())
            const requested = args.flows.split(',').map((k) => k.trim())
            const unknown = requested.filter((k) => !(FLOW_KINDS as readonly string[]).includes(k))
            if (unknown.length > 0)
                throw new Error(`Unknown flows: ${unknown.join(', ')} (known: ${FLOW_KINDS.join(', ')})`)
            const kinds = new Set(requested as FlowKind[])
            const listed = args.networks.split(',').map((n) => n.trim())
            if (kinds.has('cycle') && CYCLE_NETWORKS.some((n) => !listed.includes(n)))
                throw new Error(`The cycle flow needs ${CYCLE_NETWORKS.join(', ')} in --networks`)

            const { ctx, chains, header } = await setupRun(hre, args.networks.split(','), args.timeout, runId, {
                window: args.window,
                allowUnknownScan: args.allowUnknownScan,
                maxSendFee: args.maxSendFee,
                params: {
                    networks: args.networks,
                    flows: args.flows,
                    timeout: args.timeout,
                    allowUnknownScan: args.allowUnknownScan,
                },
                // The pathways the run will send on: every ordered pair for crosschain, the three hops of the cycle.
                sends: kinds.has('crosschain')
                    ? allPairs(args.networks.split(',').map((n) => n.trim()))
                    : kinds.has('cycle')
                      ? CYCLE_NETWORKS.map((from, i) => ({ from, to: CYCLE_NETWORKS[(i + 1) % CYCLE_NETWORKS.length] }))
                      : [],
            })
            const byNetwork = (network: string): Chain => {
                const chain = chains.find((c) => c.network === network)
                if (chain == null) throw new Error(`The cycle flow needs ${CYCLE_NETWORKS.join(', ')} in --networks`)
                return chain
            }
            if (kinds.has('cycle')) CYCLE_NETWORKS.forEach(byNetwork)

            const flows: FlowRecord[] = []
            const deployments = chains.map((c) => ({
                network: c.network,
                chainId: c.chainId,
                eid: c.eid,
                address: c.distillery.address,
            }))
            let report = ''
            const checkpoint = () => {
                report = writeReport(
                    hre.config.paths.root,
                    runId,
                    ctx.deploymentId,
                    chains[0]?.wallet.address,
                    deployments,
                    flows,
                    header,
                    'flows',
                    interruptedStatus(ctx)
                )
            }
            const detach = installRunSignals(ctx, chains, flows, checkpoint)
            const sending = () => runStopped(ctx) == null
            try {
                if (kinds.has('local')) {
                    for (const chain of chains) {
                        if (!sending()) break
                        await runFlow(flows, `local ${chain.network}`, (flow) => localFlow(ctx, flow, chain))
                    }
                }

                if (kinds.has('stale')) {
                    for (const chain of chains) {
                        if (!sending()) break
                        await runFlow(flows, `stale ${chain.network}`, (flow) => staleFlow(ctx, flow, chain))
                    }
                }

                // After a send LayerZero did not pick up, no flow that sends is started (PROTOCOL.md, early stop).
                if (kinds.has('crosschain')) {
                    for (let i = 0; i < chains.length && sending(); i++) {
                        for (let j = i + 1; j < chains.length && sending(); j++) {
                            const [a, b] = [chains[i], chains[j]]
                            await runFlow(flows, `round trip ${a.network} <-> ${b.network}`, (flow) =>
                                roundTripFlow(ctx, flow, a, b)
                            )
                        }
                    }
                }

                if (kinds.has('cycle') && sending()) {
                    await runFlow(
                        flows,
                        'cycle arbitrum-sepolia -> base-sepolia -> sepolia -> arbitrum-sepolia',
                        (flow) =>
                            cycleFlow(
                                ctx,
                                flow,
                                byNetwork('arbitrum-sepolia'),
                                byNetwork('base-sepolia'),
                                byNetwork('sepolia')
                            )
                    )
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
            if (!sending()) log(`Stopped after ${runStopped(ctx)}; the flows after it were not started`)
            if (summary.failed > 0 || summary.verificationFailures > 0) process.exitCode = 1
        }
    )
