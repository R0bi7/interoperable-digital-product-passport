import fs from 'node:fs'
import path from 'node:path'

import { RunEntry } from './gas-report'
import { FlowRecord } from './report'

// docs/evaluation/data-index.md: every run in e2e_reports/ with its dataset, window label, commit, deployment, n and
// files (PROTOCOL.md rule 9). Generated from docs/evaluation/runs.json and the run headers, so it cannot
// disagree with the raw files; a report with no manifest entry, or an entry with no report, is an error.

type RawReport = {
    readonly runId: string
    readonly deploymentId?: string
    readonly header?: {
        readonly window?: string
        readonly gitSha?: string
        readonly gitDirty?: boolean | null
        readonly chains?: readonly {
            readonly network: string
            readonly address: string
            readonly onChainCodeHash: string
        }[]
    }
    readonly flows: readonly FlowRecord[]
    readonly mints?: readonly FlowRecord['steps'][number][]
    readonly sends?: readonly FlowRecord['steps'][number][]
    readonly directions?: readonly { readonly sent: number; readonly delivered: number }[]
}

export type IndexRow = {
    readonly runId: string
    readonly task: string
    readonly dataset: string
    readonly role: string
    readonly window: string
    readonly commit: string
    readonly deployment: string
    readonly n: string
    readonly files: readonly string[]
    readonly note: string
}

const TASKS = ['flows', 'ops', 'edge', 'latency', 'scale', 'ui'] as const

const nOf = (task: string, r: RawReport): string => {
    if (task === 'scale')
        return `${r.mints?.length ?? 0} mints, ${r.sends?.length ?? 0} sends, ${r.sends?.filter((s) => s.delivered).length ?? 0} delivered`
    if (task === 'ui') {
        // Browser and storage runs: one entry per test or reader load, summarised from docs/acceptance/.
        const passed = r.flows.filter((f) => f.status === 'PASS').length
        const transactions = r.flows.flatMap((f) => f.steps).filter((s) => s.txHash != null).length
        return `${passed} of ${r.flows.length} checks passed, ${transactions} transactions`
    }
    if (task === 'latency') {
        const sent = (r.directions ?? []).reduce((s, d) => s + d.sent, 0)
        const delivered = (r.directions ?? []).reduce((s, d) => s + d.delivered, 0)
        return `${sent} sends, ${delivered} delivered`
    }
    const passed = r.flows.filter((f) => f.status === 'PASS').length
    const transactions = r.flows.flatMap((f) => f.steps).filter((s) => s.txHash != null).length
    return `${passed} of ${r.flows.length} flows passed, ${transactions} transactions`
}

/** `gitDirty: null` (a ui record whose run did not record the tree state) is shown as such, never as clean. */
const dirtyMark = (dirty: boolean | null | undefined) =>
    dirty === null ? ' (tree state not recorded)' : dirty ? ' (dirty)' : ''

export function indexRows(root: string, runs: readonly RunEntry[]): IndexRow[] {
    const dir = path.join(root, 'e2e_reports')
    const names = fs.readdirSync(dir)
    const onDisk = new Set(
        names
            .filter((f) => new RegExp(`^(${TASKS.join('|')})-\\d+\\.json$`).test(f))
            .map((f) => f.replace(/\.json$/, ''))
    )
    const listed = new Set(runs.map((r) => `${r.task}-${r.runId}`))
    const unlisted = [...onDisk].filter((f) => !listed.has(f))
    if (unlisted.length > 0)
        throw new Error(`Reports with no entry in docs/evaluation/runs.json: ${unlisted.join(', ')}`)
    const missing = [...listed].filter((f) => !onDisk.has(f))
    if (missing.length > 0) throw new Error(`Entries of runs.json with no report: ${missing.join(', ')}`)
    return [...runs]
        .sort((a, b) => a.runId.localeCompare(b.runId))
        .map((e) => {
            const base = `${e.task}-${e.runId}`
            const r = JSON.parse(fs.readFileSync(path.join(dir, `${base}.json`), 'utf8')) as RawReport
            const sha = r.header?.gitSha
            return {
                runId: e.runId,
                task: e.task,
                dataset: e.dataset,
                role: e.role,
                window: r.header?.window ?? 'not recorded',
                commit: sha == null ? 'not recorded' : `${sha.slice(0, 7)}${dirtyMark(r.header?.gitDirty)}`,
                deployment: r.deploymentId ?? 'not recorded',
                n: nOf(e.task, r),
                files: names.filter((f) => f.startsWith(`${base}.`)).sort(),
                note: e.note,
            }
        })
}

const row = (r: IndexRow) =>
    `| \`${r.runId}\` | ${r.task} | ${r.window} | \`${r.commit}\` | ${r.deployment} | ${r.n} | ${r.files.map((f) => `\`${f}\``).join(', ')} | ${r.note} |`
const HEAD = [
    '| Run id | Task | Window label | Commit | Deployment | n | Files | Note |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
]

/** Generated tables and what they are built from. Listed only if the file exists. */
const TABLES: readonly { readonly file: string; readonly from: string }[] = [
    ...[
        'gas-per-operation-whisky-v2-eval3-ops.tex',
        'gas-per-operation-whisky-v2-eval3-ops-confirmation.tex',
        'latency-pooled-whisky-v2-eval3.tex',
        'latency-pooled-whisky-v2-eval3-cost.tex',
        'edge-cases-whisky-v2-eval3.tex',
        'gas-per-operation-whisky-v2-eval3-edge.tex',
    ].map((file) => ({ file, from: 'datasets on whisky-v2-eval3' })),
    {
        file: 'storage-baseline.tex',
        from: 'DS5, `e2e:storage` (LOCAL, Foundry; no run id, `storage-baseline.json` is its raw file)',
    },
]

/** Compare addresses and runtime hashes within each generation, never across redeployments. */
export function deploymentSection(root: string, runs: readonly RunEntry[]): string[] {
    const dir = path.join(root, 'e2e_reports')
    const read = (e: RunEntry) =>
        JSON.parse(fs.readFileSync(path.join(dir, `${e.task}-${e.runId}.json`), 'utf8')) as RawReport
    const seen = new Map<string, Set<string>>()
    let compared = 0
    let missingHeaders = 0
    // `ui` records carry no contract code hashes (the browser runs read the manifest the app was built with).
    for (const e of runs.filter((r) => r.role === 'dataset' && r.task !== 'ui')) {
        const r = read(e)
        compared++
        if (!r.deploymentId || !r.header?.chains?.length) missingHeaders++
        for (const c of r.header?.chains ?? []) {
            const key = `${r.deploymentId ?? 'not recorded'} / ${c.network}`
            const set = seen.get(key) ?? new Set<string>()
            set.add(`${c.address} ${c.onChainCodeHash}`)
            seen.set(key, set)
        }
    }
    const same = [...seen.values()].every((set) => set.size === 1)
    const comparison =
        missingHeaders > 0 || compared === 0
            ? 'not fully assessable from the recorded headers'
            : same
              ? 'yes'
              : '**no, see the run headers**'
    const manifestFile = path.join(root, 'deployments', 'manifest.json')
    const current = fs.existsSync(manifestFile)
        ? (JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as { deploymentId?: string }).deploymentId
        : undefined
    const baseline = runs
        .filter((e) => e.dataset === 'smoke')
        .sort((a, b) => a.runId.localeCompare(b.runId))
        .map((e) => ({ entry: e, raw: read(e) }))
        .find(
            ({ raw }) =>
                current != null &&
                raw.deploymentId === current &&
                raw.header?.gitDirty === false &&
                raw.header.gitSha != null
        )
    return [
        '## Deployment and configuration',
        '',
        `- Within each generation, dataset runs (${compared} reports) name the same contract address and runtime code hash on each chain: ${comparison}.`,
        ...[...seen.entries()].map(
            ([network, set]) => `  - ${network}: ${[...set].map((v) => `\`${v.split(' ')[0]}\``).join(', ')}`
        ),
        baseline == null
            ? '- No clean smoke baseline is recorded for the current manifest generation.'
            : `- Current-generation baseline: \`${baseline.entry.task}-${baseline.entry.runId}\` (${current}), clean commit \`${baseline.raw.header?.gitSha}\`.`,
        '',
    ]
}

export function renderIndex(root: string, rows: readonly IndexRow[], runs: readonly RunEntry[]): string {
    const dir = path.join(root, 'e2e_reports')
    const datasets = [...new Set(rows.filter((r) => r.role === 'dataset').map((r) => r.dataset))].sort()
    const out = [
        '# Data index of the evaluation',
        '',
        'Generated by `npx hardhat e2e:tables --source all` from [`runs.json`](runs.json) and the run headers in `smart_contracts/e2e_reports/`; do not edit by hand. Regenerating gives an empty diff (PROTOCOL.md, rule 9). The per-run Markdown of `flows`, `ops` and `edge` runs is written by the task at run time and is not regenerated; the tables below are.',
        '',
        'Window label: the label recorded by the command (eval3 uses `ds1`, `w1` to `w3` and `ds3`); the run header and dataset write-up give the UTC start. Commit: the commit the harness ran from, with `(dirty)` if the tree had uncommitted changes (a dataset run must not be dirty). n: flows passed and transactions for `flows`, `ops` and `edge`; sends and deliveries for `latency`; checks passed (tests and reader loads) and transactions for `ui`, the browser and storage runs whose `ui-<run id>.json` summarises the raw files under `docs/acceptance/`.',
        '',
    ]
    for (const ds of datasets) {
        out.push(`## ${ds}`, '', ...HEAD, ...rows.filter((r) => r.role === 'dataset' && r.dataset === ds).map(row), '')
    }
    out.push(...deploymentSection(root, runs))
    out.push(
        '## Not in a dataset',
        '',
        'The smoke run and the aborted first DS12 attempt. They stay in the repository as the record; the tables do not read them.',
        '',
        '| Run id | Task | Kind | Window label | Commit | Deployment | n | Files | Note |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
        ...rows
            .filter((r) => r.role !== 'dataset')
            .map(
                (r) =>
                    `| \`${r.runId}\` | ${r.task} | ${r.dataset} | ${r.window} | \`${r.commit}\` | ${r.deployment} | ${r.n} | ${r.files.map((f) => `\`${f}\``).join(', ')} | ${r.note} |`
            ),
        '',
        '## Generated tables',
        '',
        '| File (in `smart_contracts/e2e_reports/`) | Built from |',
        '| --- | --- |',
        ...TABLES.filter((t) => fs.existsSync(path.join(dir, t.file))).map((t) => `| \`${t.file}\` | ${t.from} |`),
        ''
    )
    return out.join('\n')
}

export function writeDataIndex(root: string, runs: readonly RunEntry[]): string {
    const file = path.join(root, '..', 'docs', 'evaluation', 'data-index.md')
    fs.writeFileSync(file, renderIndex(root, indexRows(root, runs), runs))
    return file
}
