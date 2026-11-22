import fs from 'node:fs'
import path from 'node:path'

import { latexTable } from './latex'
import { FlowRecord, ReportPrefix, StepRecord, liveEvidenceLabel } from './report'
import { Summary, summarize } from './statistics'

// Gas per operation and chain, gathered from the live flow reports (e2e_reports/flows-<runId>.json) of one deployment.
// Replaces collecting the figures by hand from the individual reports.

export type FlowReportFile = {
    readonly runId: string
    readonly deploymentId: string
    readonly flows: readonly FlowRecord[]
    readonly header?: { readonly window?: string }
}

export type GasRow = {
    readonly operation: string
    readonly network: string
    /** Slot state that changes the gas (revision depth, first arrival or return, first mint); empty if not recorded. */
    readonly state: string
    readonly summary: Summary
    readonly gas: readonly number[]
    /** Transaction fee in wei where the step recorded it (`gasUsed * effectiveGasPrice`); empty if not recorded. */
    readonly feeWei: readonly string[]
}

/** Same-chain time of one operation on one chain, all slot states together (PROTOCOL.md rule 2). */
export type ConfirmRow = {
    readonly operation: string
    readonly network: string
    readonly summary: Summary
    readonly confirmSeconds: readonly number[]
    /** Block-timestamp difference beside it, where the step recorded one. */
    readonly blockSeconds: readonly number[]
}

// Steps that are expected to revert are broadcast with a fixed gas limit; their gas is not the cost of an operation.
// Setup steps prepare a case and are not observations of the operation they happen to be.
const NOT_AN_OPERATION = /\((stale|wrong|setup|not an issuer|holder, not an issuer)\b/
const OPERATION = /^(mint|approve|revise|transfer|send .+ -> .+)( \(.*\))?$/

export const operationOf = (step: string): string | null =>
    NOT_AN_OPERATION.test(step) ? null : (OPERATION.exec(step)?.[1] ?? null)

/**
 * Slot state of a step: its recorded `state`; without one, only the revision depth of a `revise` can be read back from
 * the step name.
 */
export function stateOf(step: StepRecord): string {
    if (step.state != null) return step.state
    const revise = /^revise \(expectedRevision (\d+)\)$/.exec(step.step)
    return revise == null ? '' : `depth ${Number(revise[1]) + 1}`
}

/**
 * Gas per (operation, network, state) over all flow reports of `deploymentId`. Reports of other deployments are
 * skipped. States are kept apart because the same operation costs different amounts on cold and warm storage.
 */
export function gasRows(reports: readonly FlowReportFile[], deploymentId: string): GasRow[] {
    const groups = new Map<
        string,
        { operation: string; network: string; state: string; gas: number[]; feeWei: string[] }
    >()
    for (const report of reports.filter((r) => r.deploymentId === deploymentId)) {
        for (const step of report.flows.flatMap((f) => f.steps)) {
            const operation = operationOf(step.step)
            if (operation == null || step.gasUsed == null) continue
            const state = stateOf(step)
            const key = `${operation}|${step.network}|${state}`
            const group = groups.get(key) ?? { operation, network: step.network, state, gas: [], feeWei: [] }
            group.gas.push(Number(step.gasUsed))
            if (step.feeWei != null) group.feeWei.push(step.feeWei)
            groups.set(key, group)
        }
    }
    return [...groups.values()]
        .sort(
            (a, b) =>
                a.operation.localeCompare(b.operation) ||
                a.network.localeCompare(b.network) ||
                a.state.localeCompare(b.state, 'en', { numeric: true })
        )
        .map((g) => ({ ...g, summary: summarize(g.gas) }))
}

const windowText = (windows: readonly string[]) =>
    windows.length === 0 ? 'window not recorded' : `window${windows.length > 1 ? 's' : ''} ${windows.join(', ')} (UTC)`

const n0 = (v: number) => Math.round(v).toLocaleString('en-US')

const header = ['Operation', 'Chain', 'State', 'n', 'Min', 'Median', 'Max']
const cells = (r: GasRow) => [
    r.operation,
    r.network,
    r.state,
    String(r.summary.n),
    n0(r.summary.min),
    n0(r.summary.median),
    n0(r.summary.max),
]

export const gasLatex = (
    rows: readonly GasRow[],
    deploymentId: string,
    prefix: ReportPrefix = 'flows',
    windows: readonly string[] = []
) =>
    latexTable(
        'lllrrrr',
        [header, ...rows.map(cells)],
        `Gas used per operation, chain and slot state on deployment ${deploymentId}. n counts observations in the live flow reports. A row with n below 10 is a list of observations, not a distribution.${prefix === 'flows' ? '' : ` Source: ${prefix} runs, ${windowText(windows)}, ${liveEvidenceLabel(deploymentId)}; gas units, no clock.`}`,
        prefix === 'flows' ? 'tab:gas-per-operation' : `tab:gas-per-operation-${prefix}`
    )

export const gasMarkdown = (rows: readonly GasRow[], deploymentId: string, prefix: ReportPrefix = 'flows') =>
    [
        `# Gas per operation, deployment ${deploymentId}`,
        '',
        `Observations from the live ${prefix === 'flows' ? 'flow' : prefix} reports (\`e2e_reports/${prefix}-*.json\`). Reverted steps are excluded. State is the slot state that changes the gas; empty where the report did not record it.`,
        '',
        `| ${header.join(' | ')} |`,
        '| --- | --- | --- | ---: | ---: | ---: | ---: |',
        ...rows.map((r) => `| ${cells(r).join(' | ')} |`),
        '',
    ].join('\n')

/** Submission-to-receipt time per (operation, network) of one deployment; steps without it are skipped. */
export function confirmRows(reports: readonly FlowReportFile[], deploymentId: string): ConfirmRow[] {
    const groups = new Map<string, { operation: string; network: string; confirm: number[]; block: number[] }>()
    for (const report of reports.filter((r) => r.deploymentId === deploymentId)) {
        for (const step of report.flows.flatMap((f) => f.steps)) {
            const operation = operationOf(step.step)
            if (operation == null || step.gasUsed == null || step.confirmSeconds == null) continue
            const key = `${operation}|${step.network}`
            const group = groups.get(key) ?? { operation, network: step.network, confirm: [], block: [] }
            group.confirm.push(step.confirmSeconds)
            if (step.blockSeconds != null) group.block.push(step.blockSeconds)
            groups.set(key, group)
        }
    }
    return [...groups.values()]
        .sort((a, b) => a.operation.localeCompare(b.operation) || a.network.localeCompare(b.network))
        .map((g) => ({
            operation: g.operation,
            network: g.network,
            summary: summarize(g.confirm),
            confirmSeconds: g.confirm,
            blockSeconds: g.block,
        }))
}

const f1 = (v: number) => v.toFixed(1)
const confirmHeader = [
    'Operation',
    'Chain',
    'n',
    'Median (s)',
    'Q1--Q3',
    'p95',
    'Range',
    'Outliers',
    'Block diff. median (s)',
]
const confirmCells = (r: ConfirmRow) => [
    r.operation,
    r.network,
    String(r.summary.n),
    f1(r.summary.median),
    `${f1(r.summary.q1)}--${f1(r.summary.q3)}`,
    f1(r.summary.p95),
    `${f1(r.summary.min)}--${f1(r.summary.max)}`,
    String(r.summary.outliers),
    r.blockSeconds.length === 0 ? '' : f1(summarize(r.blockSeconds).median),
]

export const confirmLatex = (rows: readonly ConfirmRow[], deploymentId: string, windows: readonly string[] = []) =>
    latexTable(
        'llrrrrrrr',
        [confirmHeader, ...rows.map(confirmCells)],
        `Same-chain time per operation and chain on deployment ${deploymentId}: submission to first receipt, wall clock of the harness, all slot states together. n is the number of observations in the row, ${windowText(windows)}, ${liveEvidenceLabel(deploymentId)}. Outliers are Tukey-fence counts and stay in the sample. Public RPCs, fee policy of rule 11. First receipt observation can be a Base preconfirmation; it does not measure finality. Intervals are not given; the observations of a run are back to back.`,
        'tab:confirmation-time'
    )

export const confirmMarkdown = (rows: readonly ConfirmRow[]) =>
    [
        '## Same-chain time (submission to first receipt, seconds)',
        '',
        'Wall clock of the harness, all slot states of an operation together; the block-timestamp difference (inclusion block against the head block read at submission) is beside it and is not the same clock. Outliers are Tukey-fence counts (1.5 IQR) and stay in the sample. Quartiles and p95 are descriptive; no interval is given.',
        '',
        `| ${confirmHeader.join(' | ')} |`,
        '| --- | --- | ---: | ---: | --- | ---: | --- | ---: | ---: |',
        ...rows.map((r) => `| ${confirmCells(r).join(' | ')} |`),
        '',
    ].join('\n')

export type Coverage = {
    readonly operation: string
    readonly network: string
    readonly n: number
    readonly detail: string
    readonly depthsMissing?: boolean
}

/**
 * DS1 pass check (PROTOCOL.md section 3): successful observations per operation and chain, and for `revise` the
 * revision depths covered. Counts only; whether n >= 10 is judged against the protocol in the report.
 */
export function ds1Coverage(rows: readonly GasRow[]): Coverage[] {
    const out: Coverage[] = []
    const networks = [...new Set(rows.map((r) => r.network))].sort()
    for (const network of networks) {
        const mine = rows.filter((r) => r.network === network)
        const count = (pred: (r: GasRow) => boolean) => mine.filter(pred).reduce((sum, r) => sum + r.summary.n, 0)
        out.push({
            operation: 'mint to self',
            network,
            n: count((r) => r.operation === 'mint' && r.state.endsWith('to self')),
            detail: '',
        })
        const revise = mine.filter((r) => r.operation === 'revise')
        const depths = new Set(
            revise
                .map((r) => /^depth (\d+)/.exec(r.state)?.[1])
                .filter((d) => d != null)
                .map(Number)
        )
        const missing = Array.from({ length: 10 }, (_, i) => i + 1).filter((d) => !depths.has(d))
        out.push({
            operation: 'revise (depths 1 to 10)',
            network,
            n: count((r) => r.operation === 'revise'),
            depthsMissing: missing.length > 0,
            detail: missing.length === 0 ? 'depths 1 to 10 covered' : `depths not covered: ${missing.join(', ')}`,
        })
        out.push({ operation: 'transferFrom', network, n: count((r) => r.operation === 'transfer'), detail: '' })
    }
    return out
}

export const coverageMarkdown = (cov: readonly Coverage[]) =>
    [
        '## Coverage against the DS1 pass criterion (n >= 10 per operation and chain)',
        '',
        '| Operation | Chain | n | Met | Note |',
        '| --- | --- | ---: | --- | --- |',
        ...cov.map(
            (c) =>
                `| ${c.operation} | ${c.network} | ${c.n} | ${c.n >= 10 && !c.depthsMissing ? 'yes' : 'no'} | ${c.detail} |`
        ),
        '',
    ].join('\n')

/** Run manifest `docs/evaluation/runs.json`: which report belongs to which dataset, and which runs are excluded. */
export type RunEntry = {
    readonly runId: string
    readonly task: ReportPrefix | 'latency' | 'scale' | 'ui'
    readonly dataset: string
    readonly role: 'dataset' | 'excluded'
    /** An extra window added because a direction was short of n = 10 (PROTOCOL.md, DS2 Stop rule). */
    readonly extension?: boolean
    readonly note: string
}

export const readRunManifest = (file: string): RunEntry[] => JSON.parse(fs.readFileSync(file, 'utf8')) as RunEntry[]

/**
 * Reads the reports of one family. With `include` only those run ids are read: the tables of a dataset are built from
 * the runs the manifest marks as that dataset, never from every file that happens to be in the directory.
 */
export function readFlowReports(
    dir: string,
    prefix: ReportPrefix = 'flows',
    include?: ReadonlySet<string>
): FlowReportFile[] {
    return fs
        .readdirSync(dir)
        .filter((f) => new RegExp(`^${prefix}-\\d+\\.json$`).test(f))
        .filter((f) => include == null || include.has(f.replace(/^[a-z]+-(\d+)\.json$/, '$1')))
        .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Partial<FlowReportFile>)
        .filter((r): r is FlowReportFile => typeof r.deploymentId === 'string' && Array.isArray(r.flows))
}

export function writeGasReport(
    root: string,
    deploymentId: string,
    prefix: ReportPrefix = 'flows',
    manifest?: readonly RunEntry[]
): string {
    const dir = path.join(root, 'e2e_reports')
    const include =
        manifest == null || prefix === 'flows'
            ? undefined
            : new Set(manifest.filter((r) => r.task === prefix && r.role === 'dataset').map((r) => r.runId))
    const reports = readFlowReports(dir, prefix, include)
    const rows = gasRows(reports, deploymentId)
    const windows = [
        ...new Set(
            reports
                .filter((r) => r.deploymentId === deploymentId)
                .map((r) => r.header?.window)
                .filter((w): w is string => w != null)
        ),
    ].sort()
    if (rows.length === 0)
        throw new Error(
            `No ${prefix} gas observations for deployment ${deploymentId} in ${dir}` +
                (include == null ? '' : ` (runs listed as datasets in docs/evaluation/runs.json: ${include.size})`)
        )
    // The table of the core flows keeps its name; the other datasets get a suffix.
    const base = path.join(dir, `gas-per-operation-${deploymentId}${prefix === 'flows' ? '' : `-${prefix}`}`)
    fs.writeFileSync(`${base}.json`, JSON.stringify({ deploymentId, rows }, null, 2) + '\n')
    fs.writeFileSync(`${base}.tex`, gasLatex(rows, deploymentId, prefix, windows))
    const confirm = confirmRows(reports, deploymentId)
    const extra =
        prefix === 'ops' && confirm.length > 0
            ? [confirmMarkdown(confirm), coverageMarkdown(ds1Coverage(rows))].join('\n')
            : ''
    fs.writeFileSync(`${base}.md`, gasMarkdown(rows, deploymentId, prefix) + (extra === '' ? '' : `\n${extra}`))
    if (prefix === 'ops' && confirm.length > 0) {
        fs.writeFileSync(`${base}-confirmation.json`, JSON.stringify({ deploymentId, rows: confirm }, null, 2) + '\n')
        fs.writeFileSync(`${base}-confirmation.tex`, confirmLatex(confirm, deploymentId, windows))
    }
    return `${base}.tex`
}
