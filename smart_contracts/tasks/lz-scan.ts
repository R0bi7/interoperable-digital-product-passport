import { providers } from 'ethers'

// LayerZero Scan, the primary source on whether LayerZero is handling this application's messages and where a hop
// stands.
//
// A send that LayerZero never picks up would otherwise wait out the full delivery timeout
// (docs/evaluation/PROTOCOL.md, section 1.1 on the preflight and the early stop). Two uses:
// - before a run that sends, Scan's record of each pathway the run will use, against the endpoint's outbound nonce
//   (`scanPreflight`): a send of this application that Scan does not have, or has stuck, blocks the run. Scan's newest
//   messages from each source chain, of any application, are recorded beside it, but decide nothing: a quiet testnet
//   has gaps of days, and other applications' messages say little about this one's DVN and pathways;
// - during a hop, Scan's record of the send (`hopVerdict`): no record after the grace period, or a record not delivered
//   after the stuck limit, stops the run; a terminal failure ends the hop at once.
// These are stop criteria on Scan's view, not proof of what LayerZero did.

export const LZ_SCAN_API = 'https://scan-testnet.layerzero-api.com/v1'
/** Seconds after a send at which a source transaction Scan still has no record of stops the run (PROTOCOL.md). */
export const SCAN_GRACE_SECONDS = 300
/** Seconds after a send at which a message Scan knows but has not delivered stops the run (PROTOCOL.md section 1.1). */
export const SCAN_STUCK_SECONDS = 900
/** Scan statuses after which the message will not be delivered without someone acting (retry, recovery, config). */
export const TERMINAL_FAILURES = ['FAILED', 'BLOCKED', 'PAYLOAD_STORED', 'APPLICATION_BURNED', 'APPLICATION_SKIPPED']
/** Messages per source chain the preflight records from Scan, newest first. */
const SOURCE_SAMPLE = 25
/** One Scan request may not hold up a wait loop that reads it every minute. */
const SCAN_TIMEOUT_MS = 15_000
/** Block range of one `eth_getLogs` call; shrunk to the floor for an RPC that caps it (some public RPCs allow 100). */
export const LOG_CHUNK = 1_000
const LOG_CHUNK_FLOOR = 100

const scanFetch = (url: string) => fetch(url, { signal: AbortSignal.timeout(SCAN_TIMEOUT_MS) })

/** Status of a source transaction on Scan, as the run log prints it. */
export async function lzScanStatus(txHash: string): Promise<string> {
    try {
        const response = await scanFetch(`${LZ_SCAN_API}/messages/tx/${txHash}`)
        if (!response.ok) return `scan HTTP ${response.status}`
        const body = (await response.json()) as { data?: { status?: { name?: string; message?: string } }[] }
        const status = body.data?.[0]?.status
        return status == null ? 'not indexed' : `${status.name}${status.message ? ` (${status.message})` : ''}`
    } catch (error) {
        return `scan unreachable: ${(error as Error).message}`
    }
}

/** Scan answered and has no record of the transaction. An unreachable Scan, a rate limit or a 5xx says nothing. */
export const noScanRecord = (status: string) => status === 'scan HTTP 404' || status === 'not indexed'

const statusName = (status: string) => status.split(' ')[0]
/** Scan answered with a record of the message (any status name, not an HTTP or network failure). */
const scanKnows = (status: string) => !noScanRecord(status) && !status.startsWith('scan ')

/**
 * What a hop's wait loop does with Scan's record of the send, `elapsedSeconds` after it: "no record" after the grace
 * period and "stuck" (known, not delivered) after the stuck limit stop the run; "failed" (a terminal status) ends the hop.
 */
export function hopVerdict(
    status: string,
    elapsedSeconds: number,
    limits: { graceSeconds?: number; stuckSeconds?: number; consecutiveErrors?: number } = {}
): 'wait' | 'no record' | 'stuck' | 'failed' {
    const grace = limits.graceSeconds ?? SCAN_GRACE_SECONDS
    const stuck = limits.stuckSeconds ?? SCAN_STUCK_SECONDS
    if (noScanRecord(status)) return elapsedSeconds >= grace ? 'no record' : 'wait'
    if (!scanKnows(status))
        return elapsedSeconds >= grace && (limits.consecutiveErrors ?? 0) >= 3 ? 'no record' : 'wait'
    if (TERMINAL_FAILURES.includes(statusName(status))) return 'failed'
    return statusName(status) !== 'DELIVERED' && elapsedSeconds >= stuck ? 'stuck' : 'wait'
}

type ScanRecord = {
    created?: string
    status?: { name?: string }
    pathway?: { nonce?: number; dstEid?: number }
}

async function scanList(url: string): Promise<ScanRecord[] | string> {
    try {
        const response = await scanFetch(url)
        // An empty filter is `200 {"data":[]}`; a 404 means the route itself was not found, which decides nothing.
        if (!response.ok) return `scan HTTP ${response.status}`
        return ((await response.json()) as { data?: ScanRecord[] }).data ?? []
    } catch (error) {
        return `scan unreachable: ${(error as Error).message}`
    }
}

/** Scan's id of a pathway: source eid, destination eid, sender and receiver addresses in lower case. */
export const pathwayId = (srcEid: number, dstEid: number, sender: string, receiver: string) =>
    `${srcEid}-${dstEid}-${sender.toLowerCase()}-${receiver.toLowerCase()}`

export type PathwayMessage = { readonly nonce: number; readonly status: string; readonly created: string }

/** Scan's newest message on a pathway (newest first); a string when Scan did not answer. */
export async function latestOnPathway(id: string): Promise<PathwayMessage[] | string> {
    const list = await scanList(`${LZ_SCAN_API}/messages/pathway/${id}?limit=1`)
    if (typeof list === 'string') return list
    return list
        .filter((m) => typeof m.pathway?.nonce === 'number' && !Number.isNaN(Date.parse(m.created ?? '')))
        .map((m) => ({
            nonce: m.pathway?.nonce as number,
            status: m.status?.name ?? 'unknown',
            created: m.created as string,
        }))
}

export type SourceMessage = { readonly created: string; readonly status: string; readonly dstEid: number }

/** Scan's newest messages sent from `eid` by any application, newest first; a string when Scan did not answer. */
export async function latestFromSource(eid: number): Promise<SourceMessage[] | string> {
    const list = await scanList(`${LZ_SCAN_API}/messages/latest?srcChainIds=${eid}&limit=${SOURCE_SAMPLE}`)
    if (typeof list === 'string') return list
    return list
        .filter((m) => !Number.isNaN(Date.parse(m.created ?? '')))
        .map((m) => ({
            created: m.created as string,
            status: m.status?.name ?? 'unknown',
            dstEid: m.pathway?.dstEid ?? 0,
        }))
}

/** A pathway the run will send on, with the endpoint's outbound nonce of this application on it. */
export type PlannedPathway = {
    readonly from: { readonly network: string; readonly eid: number; readonly address: string }
    readonly to: { readonly network: string; readonly eid: number; readonly address: string }
    readonly outboundNonce: number
}

export type PathwayVerdict = {
    readonly pathway: string
    readonly verdict: 'ok' | 'unused' | 'not on scan' | 'stuck' | 'unknown'
    readonly detail: string
}

const ageText = (seconds: number) =>
    seconds >= 5400 ? `${(seconds / 3600).toFixed(1)} h` : `${Math.round(seconds / 60)} min`

/**
 * Judges a pathway of this application: no send yet ("unused"); a nonce the endpoint has sent but Scan does not have
 * ("not on scan"); Scan's newest message in a terminal failure, or not delivered after the stuck limit ("stuck");
 * otherwise "ok". A Scan that did not answer decides nothing ("unknown").
 */
export function judgePathway(
    p: PlannedPathway,
    scan: readonly PathwayMessage[] | string,
    nowMs: number,
    stuckSeconds = SCAN_STUCK_SECONDS
): PathwayVerdict {
    const pathway = `${p.from.network} -> ${p.to.network}`
    if (typeof scan === 'string') return { pathway, verdict: 'unknown', detail: `Scan did not answer: ${scan}` }
    if (p.outboundNonce === 0) return { pathway, verdict: 'unused', detail: 'no send yet on this pathway' }
    const newest = scan[0]
    if (newest == null || newest.nonce < p.outboundNonce)
        return {
            pathway,
            verdict: 'not on scan',
            detail: `the endpoint has sent nonce ${p.outboundNonce}; Scan's newest is ${newest == null ? 'none' : `nonce ${newest.nonce}`}`,
        }
    const age = (nowMs - Date.parse(newest.created)) / 1000
    const at = `nonce ${newest.nonce} ${newest.status}, ${ageText(age)} ago`
    if (TERMINAL_FAILURES.includes(newest.status) || (newest.status !== 'DELIVERED' && age >= stuckSeconds))
        return { pathway, verdict: 'stuck', detail: at }
    return { pathway, verdict: 'ok', detail: at }
}

/** Scan's newest messages from a source chain, of any application: recorded with the preflight, deciding nothing. */
export function describeSource(network: string, messages: readonly SourceMessage[] | string, nowMs: number): string {
    if (typeof messages === 'string') return `${network}: Scan did not answer (${messages})`
    if (messages.length === 0) return `${network}: no message on Scan`
    const newest = Math.min(...messages.map((m) => (nowMs - Date.parse(m.created)) / 1000))
    const statuses = [...new Set(messages.map((m) => m.status))]
        .map((s) => `${messages.filter((m) => m.status === s).length} ${s}`)
        .join(', ')
    return `${network}: newest of any application ${ageText(newest)} ago; last ${messages.length}: ${statuses}`
}

export type Preflight = { readonly pathways: readonly PathwayVerdict[]; readonly sources: readonly string[] }

/** Before a run that sends: Scan's view of every pathway it will use, and of their source chains. Reads only. */
export async function scanPreflight(
    pathways: readonly PlannedPathway[],
    scan: {
        pathway?: (id: string) => Promise<PathwayMessage[] | string>
        source?: (eid: number) => Promise<SourceMessage[] | string>
    } = {},
    nowMs = Date.now()
): Promise<Preflight> {
    const onPathway = scan.pathway ?? latestOnPathway
    const fromSource = scan.source ?? latestFromSource
    const verdicts: PathwayVerdict[] = []
    for (const p of pathways)
        verdicts.push(
            judgePathway(p, await onPathway(pathwayId(p.from.eid, p.to.eid, p.from.address, p.to.address)), nowMs)
        )
    const sources: string[] = []
    for (const from of [...new Map(pathways.map((p) => [p.from.network, p.from])).values()])
        sources.push(describeSource(from.network, await fromSource(from.eid), nowMs))
    return { pathways: verdicts, sources }
}

/** A run that sends does not start while one of its pathways has a send Scan does not have or has stuck. */
export const blocksRun = (v: PathwayVerdict, allowUnknownScan = false) =>
    v.verdict === 'not on scan' || v.verdict === 'stuck' || (v.verdict === 'unknown' && !allowUnknownScan)

/** The preflight in one line, for the run log and the run header. */
export const describePreflight = (p: Preflight) =>
    [...p.pathways.map((v) => `${v.pathway} ${v.verdict} (${v.detail})`), ...p.sources].join('; ')

/** Every ordered pair of the chains: what a run that sends back and forth between all of them plans. */
export const allPairs = (networks: readonly string[]) =>
    networks.flatMap((from) => networks.filter((to) => to !== from).map((to) => ({ from, to })))

// The getLogs range each provider accepted, so a capped RPC is probed once per run, not once per lookup.
const chunks = new WeakMap<providers.Provider, number>()

function isRangeError(error: unknown): boolean {
    const e = error as { message?: unknown; error?: { message?: unknown }; body?: unknown }
    const text = [e?.message, e?.error?.message, e?.body].filter((x) => typeof x === 'string').join(' ')
    return /block range|range too large|exceeds the maximum|range limit|too many blocks/i.test(text)
}

/**
 * `eth_getLogs` from `fromBlock` to `toBlock` in ranges the RPC accepts: a range error shrinks the range to 100 blocks
 * and repeats the call; any other error is thrown. `visit` sees each range's logs in order and returns true to stop.
 */
export async function getLogsChunked(
    provider: providers.Provider,
    filter: { address?: string; topics?: (string | string[] | null)[] },
    fromBlock: number,
    toBlock: number,
    visit: (logs: providers.Log[]) => boolean | void
): Promise<void> {
    let chunk = chunks.get(provider) ?? LOG_CHUNK
    let lo = fromBlock
    while (lo <= toBlock) {
        const hi = Math.min(lo + chunk - 1, toBlock)
        let logs: providers.Log[]
        try {
            logs = await provider.getLogs({ ...filter, fromBlock: lo, toBlock: hi })
        } catch (error) {
            if (!isRangeError(error) || chunk <= LOG_CHUNK_FLOOR) throw error
            chunk = LOG_CHUNK_FLOOR
            chunks.set(provider, chunk)
            continue
        }
        if (visit(logs) === true) return
        lo = hi + 1
    }
}
