import fs from 'node:fs'
import path from 'node:path'

import { utils } from 'ethers'

import { latexTable } from './latex'
import {
    CLOCK_HEADER,
    CLOCK_RULE,
    ClockStats,
    DirectionStats,
    clockRow,
    renderLatencyLatex,
    renderLatencyMarkdown,
} from './latency-report'
import { FlowRecord, liveEvidenceLabel } from './report'
import { RunHeader } from './run-header'
import { MIN_N_FOR_INTERVAL, summarize } from './statistics'

// Pooling of the latency windows of DS2 (docs/evaluation/PROTOCOL.md, rules 2 to 5 and the Stop rule of DS2).
//
// - The two clocks are pooled each within itself and never with each other (rule 2).
// - Every window is reported on its own, as raw values, and the pool beside it (rule 4; no calendar-day requirement). Pooling across windows is
//   allowed; the four hops of a window are back to back on one token, so the pooled interval is optimistic.
// - Intervals come only from n >= 10 (rule 5); `summarize` enforces it, so a pooled cell with fewer observations shows
//   no interval.
// - A direction whose pooled primary-clock n is under 10 is owed an extra window (Stop rule). Extra windows are marked
//   in the manifest and reported as a data-dependent extension of n, beside the window that fell short.

/** Sends per direction that DS2 asks for: three windows of four (PROTOCOL.md, DS2). */
export const PLANNED_PER_DIRECTION = 12
export const PLANNED_WINDOWS = 3

export type LatencyReportFile = {
    readonly runId: string
    readonly deploymentId: string
    readonly header?: Partial<RunHeader>
    readonly hops?: number
    readonly directions: readonly DirectionStats[]
    readonly flows?: readonly FlowRecord[]
}

/** Source-side cost of the delivered sends of one direction, one entry per send that has the field. */
export type SendCost = {
    readonly gas: readonly number[]
    readonly feeWei: readonly string[]
    readonly layerZeroFeeWei: readonly string[]
}

export type WindowCell = {
    readonly window: string
    readonly runId: string
    /** True for a window added because a direction was short of n = 10 (data-dependent extension). */
    readonly extension: boolean
    readonly sent: number
    readonly delivered: number
    readonly chain: ClockStats
    readonly poll: ClockStats
}

export type PooledDirection = {
    readonly direction: string
    readonly windows: readonly WindowCell[]
    readonly sent: number
    readonly delivered: number
    /** Primary clock over all windows. */
    readonly chain: ClockStats
    /** Continuity clock over all windows; never merged with the primary one. */
    readonly poll: ClockStats
    readonly cost: SendCost
    /** Planned sends (12) minus delivered hops: windows not run, hops not sent and hops not delivered all count. */
    readonly shortfall: number
    /** The Stop rule: the pooled primary-clock n is under 10, so an extra window is owed. */
    readonly extraWindowOwed: boolean
}

export type WindowCheck = {
    readonly windows: readonly string[]
    readonly extensionWindows: readonly string[]
    /** UTC starts from the run headers, distinct from user-selected window labels. */
    readonly starts: readonly { readonly window: string; readonly startedAt?: string }[]
    /** Distinct UTC calendar days of the windows. */
    readonly days: readonly string[]
    readonly threeWindows: boolean
}

export type Pooled = {
    readonly deploymentId: string
    readonly directions: readonly PooledDirection[]
    readonly check: WindowCheck
}

const pool = (values: readonly (readonly number[])[]): ClockStats => {
    const seconds = values.flat()
    return { n: seconds.length, summary: seconds.length > 0 ? summarize(seconds) : null, seconds }
}

/**
 * Pools the latency reports of one deployment. `extensions` names the run ids that are extra windows. A report with
 * no window label is refused: each run must identify its window (rule 4). UTC starts come from the header.
 */
export function poolWindows(
    reports: readonly LatencyReportFile[],
    deploymentId: string,
    extensions: ReadonlySet<string> = new Set()
): Pooled {
    const mine = reports.filter((r) => r.deploymentId === deploymentId)
    for (const r of mine) if (r.header?.window == null) throw new Error(`latency run ${r.runId} has no window label`)
    const byWindow = [...mine].sort((a, b) => a.header!.window!.localeCompare(b.header!.window!))
    const directions = [...new Set(byWindow.flatMap((r) => r.directions.map((d) => d.direction)))].sort()
    const pooled = directions.map((direction): PooledDirection => {
        const windows = byWindow.flatMap((r) =>
            r.directions
                .filter((d) => d.direction === direction)
                .map((d): WindowCell => ({
                    window: r.header!.window!,
                    runId: r.runId,
                    extension: extensions.has(r.runId),
                    sent: d.sent,
                    delivered: d.delivered,
                    chain: d.chain,
                    poll: d.poll,
                }))
        )
        const chain = pool(windows.map((w) => w.chain.seconds))
        const sent = windows.reduce((sum, w) => sum + w.sent, 0)
        const delivered = windows.reduce((sum, w) => sum + w.delivered, 0)
        const steps = byWindow.flatMap((r) =>
            (r.flows ?? []).flatMap((fl) => fl.steps).filter((st) => st.step === `send ${direction}`)
        )
        const cost: SendCost = {
            gas: steps.filter((st) => st.gasUsed != null).map((st) => Number(st.gasUsed)),
            feeWei: steps.filter((st) => st.feeWei != null).map((st) => st.feeWei as string),
            layerZeroFeeWei: steps.filter((st) => st.nativeFee != null).map((st) => st.nativeFee as string),
        }
        return {
            direction,
            windows,
            sent,
            delivered,
            cost,
            chain,
            poll: pool(windows.map((w) => w.poll.seconds)),
            shortfall: Math.max(0, PLANNED_PER_DIRECTION - delivered),
            extraWindowOwed: chain.n < MIN_N_FOR_INTERVAL,
        }
    })
    const planned = byWindow.filter((r) => !extensions.has(r.runId)).map((r) => r.header!.window!)
    const starts = byWindow.map((r) => {
        const recorded = r.header?.startedAt
        const startedAt =
            recorded != null && Number.isFinite(Date.parse(recorded)) ? new Date(recorded).toISOString() : undefined
        return { window: r.header!.window!, startedAt }
    })
    const days = [...new Set(starts.flatMap((s) => (s.startedAt == null ? [] : [s.startedAt.slice(0, 10)])))].sort()
    return {
        deploymentId,
        directions: pooled,
        check: {
            windows: byWindow.map((r) => r.header!.window!),
            extensionWindows: byWindow.filter((r) => extensions.has(r.runId)).map((r) => r.header!.window!),
            days,
            starts,
            threeWindows: planned.length >= PLANNED_WINDOWS,
        },
    }
}

const f = (v: number) => v.toFixed(1)

const COIN: Record<string, string> = {
    'arbitrum-sepolia': 'ETH',
    'base-sepolia': 'ETH',
    sepolia: 'ETH',
}
const coinOf = (direction: string) => COIN[direction.split(' -> ')[0]] ?? 'native'
const bigMin = (xs: readonly string[]) => xs.map((x) => BigInt(x)).reduce((a, b) => (b < a ? b : a))
const bigMax = (xs: readonly string[]) => xs.map((x) => BigInt(x)).reduce((a, b) => (b > a ? b : a))
const amount = (xs: readonly string[], coin: string) => {
    if (xs.length === 0) return 'n/a'
    const lo = bigMin(xs)
    const hi = bigMax(xs)
    const fmt = (v: bigint) => utils.formatEther(v.toString())
    return lo === hi ? `${fmt(lo)} ${coin}` : `${fmt(lo)} to ${fmt(hi)} ${coin}`
}
const gasRange = (xs: readonly number[]) =>
    xs.length === 0
        ? 'n/a'
        : Math.min(...xs) === Math.max(...xs)
          ? Math.min(...xs).toLocaleString('en-US')
          : `${Math.min(...xs).toLocaleString('en-US')} to ${Math.max(...xs).toLocaleString('en-US')}`

const costHeader = ['Direction', 'Sends', 'Source gas used', 'Source receipt gas fee', 'LayerZero fee paid (msg.value)']
const costCells = (d: PooledDirection) => [
    d.direction,
    String(d.cost.gas.length),
    gasRange(d.cost.gas),
    amount(d.cost.feeWei, coinOf(d.direction)),
    amount(d.cost.layerZeroFeeWei, coinOf(d.direction)),
]
// Rule 5: below n = 10 only raw values are printed, so the row names the count and nothing else.
const pooledRow = (direction: string, c: ClockStats) =>
    c.n < MIN_N_FOR_INTERVAL
        ? `| ${direction} | ${c.n} | raw values only (n < ${MIN_N_FOR_INTERVAL}) | | | | | | | | |`
        : clockRow(direction, c)
const raw = (c: ClockStats) => (c.seconds.length === 0 ? 'none' : c.seconds.join(', '))

export function renderPooledMarkdown(p: Pooled): string {
    const lines = [
        `# DS2: delivery time pooled over windows, deployment ${p.deploymentId}`,
        '',
        `Generated by \`e2e:tables --source latency\` from the latency runs that \`docs/evaluation/runs.json\` lists as DS2. Evidence label ${liveEvidenceLabel(p.deploymentId)}. The primary clock (block timestamp of \`ONFTSent\` to block timestamp of \`ONFTReceived\`) and the continuity clock (block timestamp of the send to the first 5 s poll) are pooled each within itself and never with each other. Intervals appear only from n = 10. Outliers are Tukey-fence counts and stay in the sample. Chain clocks can differ by seconds and their skew is not measured.`,
        '',
        'The four hops of a window are back to back on one token, so they are not independent draws; a pooled interval is optimistic and describes these windows, not the pathway in general.',
        '',
        '## Windows',
        '',
        `- Window labels: ${p.check.windows.join(', ')}.`,
        ...p.check.starts.map((s) => `  - ${s.window}: ${s.startedAt ?? 'UTC start not recorded'}.`),
        `- ${PLANNED_WINDOWS} windows planned, ${p.check.windows.length - p.check.extensionWindows.length} taken: ${p.check.threeWindows ? 'complete' : 'incomplete'}. Observation days (UTC): ${p.check.days.join(', ') || 'not recorded'}.`,
        ...(p.check.extensionWindows.length === 0
            ? []
            : [
                  `- Extra windows added because a direction was short of n = ${MIN_N_FOR_INTERVAL} (data-dependent extension of n): ${p.check.extensionWindows.join(', ')}.`,
              ]),
        '',
        '## Sent and delivered per window',
        '',
        '| Direction | Window | Run | Sent | Delivered |',
        '| --- | --- | --- | ---: | ---: |',
        ...p.directions.flatMap((d) =>
            d.windows.map(
                (w) =>
                    `| ${d.direction} | ${w.window}${w.extension ? ' (extra)' : ''} | ${w.runId} | ${w.sent} | ${w.delivered} |`
            )
        ),
        '',
        '## Pooled over all windows',
        '',
        '| Direction | Sent | Delivered | Planned | Shortfall | Extra window owed |',
        '| --- | ---: | ---: | ---: | ---: | --- |',
        ...p.directions.map(
            (d) =>
                `| ${d.direction} | ${d.sent} | ${d.delivered} | ${PLANNED_PER_DIRECTION} | ${d.shortfall} | ${d.extraWindowOwed ? 'yes' : 'no'} |`
        ),
        '',
        '## Gas and fees of a send, all windows',
        '',
        'Gas units and native amounts (rule 6), min and max over the sends of the direction. The source receipt gas fee is `gasUsed × effectiveGasPrice`; on Base it excludes the separate L1 data charge and is not the complete transaction cost. Supplementary L1 charges, when available, remain separate in raw JSON. The LayerZero fee is the `msg.value` set to the `quoteSend` value. The receiving transaction is paid by the executor and is outside these figures. Testnet coins, no conversion.',
        '',
        `| ${costHeader.join(' | ')} |`,
        '| --- | ---: | ---: | --- | --- |',
        ...p.directions.map((d) => `| ${costCells(d).join(' | ')} |`),
        '',
        '### Primary clock, pooled (seconds)',
        '',
        CLOCK_HEADER,
        CLOCK_RULE,
        ...p.directions.map((d) => pooledRow(d.direction, d.chain)),
        '',
        '### Continuity clock, pooled (seconds)',
        '',
        CLOCK_HEADER,
        CLOCK_RULE,
        ...p.directions.map((d) => pooledRow(d.direction, d.poll)),
        '',
        '## Raw values per window (seconds)',
        '',
        'Per-window cells have too few observations for a summary; the values are the result.',
        '',
        ...p.directions.flatMap((d) =>
            d.windows.flatMap((w) => [
                `- ${d.direction}, ${w.window}${w.extension ? ' (extra)' : ''}, primary: ${raw(w.chain)}`,
                `- ${d.direction}, ${w.window}${w.extension ? ' (extra)' : ''}, continuity: ${raw(w.poll)}`,
            ])
        ),
        '',
    ]
    return lines.join('\n')
}

export function renderPooledLatex(p: Pooled): string {
    const rows = p.directions.map((d) => {
        const s = d.chain.n < MIN_N_FOR_INTERVAL ? null : d.chain.summary
        return s == null
            ? [d.direction, String(d.sent), String(d.delivered), String(d.chain.n), '', '', '', '', '']
            : [
                  d.direction,
                  String(d.sent),
                  String(d.delivered),
                  String(d.chain.n),
                  f(s.median),
                  `${f(s.q1)}--${f(s.q3)}`,
                  f(s.p95),
                  `${f(s.min)}--${f(s.max)}`,
                  s.medianCi95 == null
                      ? `n < ${MIN_N_FOR_INTERVAL}`
                      : `${f(s.medianCi95.low)}--${f(s.medianCi95.high)}`,
              ]
    })
    return latexTable(
        'lrrrrrrrr',
        [['Direction', 'Sent', 'Delivered', 'n', 'Median (s)', 'Q1--Q3', 'p95', 'Range', 'Median 95% CI'], ...rows],
        `Delivery time per hop in seconds on deployment ${p.deploymentId}, pooled over ${p.check.windows.length} windows (${p.check.windows.join(', ')}; labels; UTC starts in the Markdown report), from the block timestamp of the send to the block timestamp of the delivery on the destination. n counts delivered hops with both timestamps; a row with n under 10 shows no statistic (rule 5), its values are in the Markdown report. ${liveEvidenceLabel(p.deploymentId)}. The hops of a window are back to back on one token, so the interval is optimistic.`,
        'tab:delivery-latency-pooled'
    )
}

export const renderCostLatex = (p: Pooled) =>
    latexTable(
        'lrrll',
        [costHeader, ...p.directions.map(costCells)],
        `Gas and fees of a send per direction on deployment ${p.deploymentId}, over ${p.check.windows.length} windows (${p.check.windows.join(', ')}; labels; UTC starts in the Markdown report): gas used and source receipt gas fee (gasUsed * effectiveGasPrice; Base L1 data charge excluded, not complete transaction cost), and the LayerZero fee paid as msg.value. Min to max over the sends; testnet coins, no conversion. ${liveEvidenceLabel(p.deploymentId)}.`,
        'tab:send-cost'
    )

export function readLatencyReports(dir: string, include?: ReadonlySet<string>): LatencyReportFile[] {
    return fs
        .readdirSync(dir)
        .filter((f) => /^latency-\d+\.json$/.test(f))
        .filter((f) => include == null || include.has(f.replace(/^latency-(\d+)\.json$/, '$1')))
        .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as LatencyReportFile)
}

/** The per-run Markdown and LaTeX are generated from the raw JSON of the run, so they are regenerated from it. */
export function regenerateLatencyRuns(root: string, reports: readonly LatencyReportFile[]): void {
    const dir = path.join(root, 'e2e_reports')
    for (const r of reports) {
        if (r.hops == null) continue
        fs.writeFileSync(
            path.join(dir, `latency-${r.runId}.md`),
            renderLatencyMarkdown(r.runId, r.deploymentId, r.hops, [...r.directions], r.header as RunHeader | undefined)
        )
        fs.writeFileSync(
            path.join(dir, `latency-${r.runId}.tex`),
            renderLatencyLatex([...r.directions], {
                runId: r.runId,
                window: r.header?.window,
                deploymentId: r.deploymentId,
            })
        )
    }
}

export function writePooledLatency(
    root: string,
    deploymentId: string,
    include: ReadonlySet<string>,
    extensions: ReadonlySet<string>
): string {
    const dir = path.join(root, 'e2e_reports')
    const reports = readLatencyReports(dir, include)
    if (reports.filter((r) => r.deploymentId === deploymentId).length === 0)
        throw new Error(`No DS2 latency runs for deployment ${deploymentId} are listed in docs/evaluation/runs.json`)
    const pooled = poolWindows(reports, deploymentId, extensions)
    const base = path.join(dir, `latency-pooled-${deploymentId}`)
    fs.writeFileSync(`${base}.json`, JSON.stringify(pooled, null, 2) + '\n')
    fs.writeFileSync(`${base}.md`, renderPooledMarkdown(pooled))
    fs.writeFileSync(`${base}.tex`, renderPooledLatex(pooled))
    fs.writeFileSync(`${base}-cost.tex`, renderCostLatex(pooled))
    regenerateLatencyRuns(
        root,
        reports.filter((x) => x.deploymentId === deploymentId)
    )
    return `${base}.tex`
}
