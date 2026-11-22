import fs from 'node:fs'
import path from 'node:path'

import { latexTable } from './latex'
import { FlowRecord, StepRecord, liveEvidenceLabel } from './report'
import { RunHeader, headerMarkdown } from './run-header'
import { MIN_N_FOR_INTERVAL, Summary, summarize } from './statistics'

// Per-direction delivery statistics of the latency runs and their report (e2e_reports/latency-<runId>.{json,md}).

export type ClockStats = {
    readonly n: number
    readonly summary: Summary | null
    readonly seconds: readonly number[]
}

export type DirectionStats = {
    readonly direction: string
    /** Sends attempted, and sends after which the token was seen on the destination within the timeout. */
    readonly sent: number
    readonly delivered: number
    /** Primary clock: block timestamp of the source `ONFTSent` to block timestamp of the destination `ONFTReceived`. */
    readonly chain: ClockStats
    /** Continuity clock: block timestamp of the send to the first 5 s poll that saw the token. */
    readonly poll: ClockStats
}

const DIRECTION = /^send (.+ -> .+)$/

const clock = (values: readonly (number | undefined)[]): ClockStats => {
    const seconds = values.filter((v): v is number => v != null)
    return { n: seconds.length, summary: seconds.length > 0 ? summarize(seconds) : null, seconds }
}

/**
 * Groups the sends of the flows by direction. A send that has no delivery time counts as sent, not delivered. The two
 * clocks are kept apart and never pooled (docs/evaluation/PROTOCOL.md, rule 2): a delivered hop whose destination
 * event could not be located counts for the continuity clock only.
 */
/** Per direction; `planned` adds a row with nothing sent for a planned direction the run never reached. */
export function directionStats(flows: readonly FlowRecord[], planned: readonly string[] = []): DirectionStats[] {
    const sends = flows.flatMap((f) => f.steps).filter((s: StepRecord) => DIRECTION.test(s.step))
    const directions = [...new Set([...sends.map((s) => s.step.replace(/^send /, '')), ...planned])]
    return directions.map((direction) => {
        const mine = sends.filter((s) => s.step === `send ${direction}`)
        return {
            direction,
            sent: mine.length,
            delivered: mine.filter((s) => s.delivered ?? s.deliverySeconds != null).length,
            chain: clock(mine.map((s) => s.deliverySecondsChain)),
            poll: clock(mine.map((s) => s.deliverySeconds)),
        }
    })
}

const f = (v: number, d = 1) => v.toFixed(d)
const interval = (c: { low: number; high: number } | null, n: number) =>
    c == null ? (n < MIN_N_FOR_INTERVAL ? `n < ${MIN_N_FOR_INTERVAL}` : 'n/a') : `${f(c.low)} to ${f(c.high)}`

export const CLOCK_HEADER =
    '| Direction | n | Median | Q1 to Q3 | p95 | Min | Max | Outliers | Mean | Mean 95% CI | Median 95% CI |'
export const CLOCK_RULE = '| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |'

export const clockRow = (direction: string, c: ClockStats) => {
    const s = c.summary
    // Rule 5: below n = 10 only raw values are printed; the raw values section of the report holds them.
    if (s != null && c.n < MIN_N_FOR_INTERVAL)
        return `| ${direction} | ${c.n} | raw values only (n < ${MIN_N_FOR_INTERVAL}) | | | | | | | | |`
    return s == null
        ? `| ${direction} | 0 | | | | | | | | | |`
        : `| ${direction} | ${c.n} | ${f(s.median)} | ${f(s.q1)} to ${f(s.q3)} | ${f(s.p95)} | ${f(s.min, 0)} | ${f(s.max, 0)} | ${s.outliers} | ${f(s.mean)} | ${interval(s.meanCi95, c.n)} | ${interval(s.medianCi95, c.n)} |`
}

export function renderLatencyMarkdown(
    runId: string,
    deploymentId: string,
    hops: number,
    stats: DirectionStats[],
    header?: RunHeader
) {
    const lines = [
        `# WhiskyDistillery delivery latency, run ${runId}`,
        '',
        `Started ${new Date(Number(runId)).toISOString()}. Deployment \`${deploymentId}\`. Requested hops per pair: ${hops}.${header?.window == null ? '' : ` Window \`${header.window}\`.`}`,
        '',
        ...(header == null ? [] : headerMarkdown(header)),
        'Public RPCs unless the header says otherwise, one account, one token per pair, no revision between hops. Each hop is one observation; a hop that was not delivered within the timeout is counted in *Sent* and *Delivered*, not dropped. Intervals appear only from n = 10 (Student t for the mean, percentile bootstrap with 2000 resamples for the median); below that the raw values are the result. Outliers are Tukey-fence counts and stay in the sample. The two clocks are never pooled.',
        '',
        '| Direction | Sent | Delivered |',
        '| --- | ---: | ---: |',
        ...stats.map((d) => `| ${d.direction} | ${d.sent} | ${d.delivered} |`),
        '',
        '## Primary clock: block timestamp of `ONFTSent` to block timestamp of `ONFTReceived` (seconds)',
        '',
        'Resolution is the block time of the two chains. Chain clocks can differ by seconds and their skew is not measured.',
        '',
        CLOCK_HEADER,
        CLOCK_RULE,
        ...stats.map((d) => clockRow(d.direction, d.chain)),
        '',
        '## Continuity clock: block timestamp of the send to the first 5 s poll that sees the token (seconds)',
        '',
        'The destination is polled every 5 s after the receipt and the source state have been read, and each RPC call adds its own time, so the value is an upper bound of the delivery with no fixed error limit; first inclusion, not finality.',
        '',
        CLOCK_HEADER,
        CLOCK_RULE,
        ...stats.map((d) => clockRow(d.direction, d.poll)),
        '',
        '## Raw values (seconds)',
        '',
        ...stats.flatMap((d) => [
            `- ${d.direction}, primary: ${d.chain.seconds.join(', ')}`,
            `- ${d.direction}, continuity: ${d.poll.seconds.join(', ')}`,
        ]),
        '',
    ]
    return lines.join('\n')
}

export type LatexContext = { readonly runId: string; readonly window?: string; readonly deploymentId: string }

export function renderLatencyLatex(stats: DirectionStats[], context?: LatexContext): string {
    const rows = stats.map((d) => {
        // Rule 5: no statistic below n = 10; the values are in the Markdown report.
        const s = d.chain.n < MIN_N_FOR_INTERVAL ? null : d.chain.summary
        return s == null
            ? [d.direction, String(d.sent), String(d.delivered), String(d.chain.n), '', '', '', '']
            : [
                  d.direction,
                  String(d.sent),
                  String(d.delivered),
                  String(d.chain.n),
                  f(s.median),
                  `${f(s.q1)}--${f(s.q3)}`,
                  f(s.p95),
                  `${f(s.min, 0)}--${f(s.max, 0)}`,
              ]
    })
    return latexTable(
        'lrrrrrrr',
        [['Direction', 'Sent', 'Delivered', 'n', 'Median (s)', 'Q1--Q3', 'p95', 'Range'], ...rows],
        `Delivery time per hop in seconds, primary clock: from the block timestamp of the send to the block timestamp of the delivery on the destination.${context == null ? '' : ` Run ${context.runId}, deployment ${context.deploymentId}, window ${context.window ?? 'not labelled'}, ${liveEvidenceLabel(context.deploymentId)}.`} n counts delivered hops with both timestamps; a row with n under ${MIN_N_FOR_INTERVAL} shows no statistic (rule 5), the values are in the Markdown report.`,
        context == null ? 'tab:delivery-latency' : `tab:delivery-latency-${context.runId}`
    )
}

export function writeLatencyReport(
    root: string,
    runId: string,
    deploymentId: string,
    hops: number,
    flows: readonly FlowRecord[],
    header?: RunHeader,
    planned: readonly string[] = [],
    status?: 'interrupted'
): string {
    const dir = path.join(root, 'e2e_reports')
    fs.mkdirSync(dir, { recursive: true })
    const stats = directionStats(flows, planned)
    fs.writeFileSync(
        path.join(dir, `latency-${runId}.json`),
        JSON.stringify(
            { runId, deploymentId, header, ...(status ? { status } : {}), hops, directions: stats, flows },
            null,
            2
        ) + '\n'
    )
    fs.writeFileSync(
        path.join(dir, `latency-${runId}.tex`),
        renderLatencyLatex(stats, { runId, window: header?.window, deploymentId })
    )
    const file = path.join(dir, `latency-${runId}.md`)
    fs.writeFileSync(
        file,
        (status ? `Run status: ${status}\n\n` : '') + renderLatencyMarkdown(runId, deploymentId, hops, stats, header)
    )
    return file
}
