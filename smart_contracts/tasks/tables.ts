import { task, types } from 'hardhat/config'

import fs from 'node:fs'
import path from 'node:path'

import { writeDataIndex } from './data-index'
import { readEnforcedGas, writeEdgeCases } from './edge-report'
import { RunEntry, readFlowReports, readRunManifest, writeGasReport } from './gas-report'
import { readLatencyReports, regenerateLatencyRuns, writePooledLatency } from './latency-pool'
import { ReportPrefix } from './report'
import { ScaleReport, renderScaleMarkdown, renderScaleTex } from './scale-report'
import { writeStorageTables } from './storage-report'

const SOURCES = ['flows', 'ops', 'edge', 'latency', 'scale', 'all'] as const

function scaleTables(root: string, runs: readonly RunEntry[]): string[] {
    return runs
        .filter((r) => r.task === 'scale' && r.dataset === 'DS4' && r.role === 'dataset')
        .flatMap((r) => {
            const base = path.join(root, 'e2e_reports', `scale-${r.runId}`)
            const raw = JSON.parse(fs.readFileSync(base + '.json', 'utf8')) as ScaleReport
            fs.writeFileSync(base + '.md', renderScaleMarkdown(raw))
            fs.writeFileSync(base + '.tex', renderScaleTex(raw))
            return [base + '.md', base + '.tex']
        })
}

function latencyTables(root: string, deployment: string, runs: readonly RunEntry[]): string {
    const ds2 = runs.filter((r) => r.task === 'latency' && r.dataset === 'DS2' && r.role === 'dataset')
    return writePooledLatency(
        root,
        deployment,
        new Set(ds2.map((r) => r.runId)),
        new Set(ds2.filter((r) => r.extension === true).map((r) => r.runId))
    )
}

function edgeTables(root: string, deployment: string, runs: readonly RunEntry[]): string[] {
    const ids = new Set(
        runs.filter((r) => r.task === 'edge' && r.dataset === 'DS3' && r.role === 'dataset').map((r) => r.runId)
    )
    return [
        writeEdgeCases(
            root,
            deployment,
            readFlowReports(path.join(root, 'e2e_reports'), 'edge', ids),
            readEnforcedGas(root)
        ),
        writeGasReport(root, deployment, 'edge', runs),
    ]
}

task('e2e:tables', 'Generates every table of the evaluation from the committed raw reports (JSON, Markdown, LaTeX)')
    .addOptionalParam('deployment', 'Deployment id whose reports are used', 'whisky-v2-eval3', types.string)
    .addOptionalParam(
        'source',
        'flows (e2e:flows), ops (DS1), edge (DS3), latency (DS2, pooled over windows) or all (every table, the DS5 render and the data index)',
        'flows',
        types.string
    )
    .setAction(async (args: { deployment: string; source: string }, hre) => {
        if (!(SOURCES as readonly string[]).includes(args.source))
            throw new Error(`--source must be one of ${SOURCES.join(', ')}, not ${args.source}`)
        const root = hre.config.paths.root
        // The datasets of the evaluation are built only from the runs the manifest lists (docs/evaluation/runs.json).
        const manifest = path.join(root, '..', 'docs', 'evaluation', 'runs.json')
        const runs = fs.existsSync(manifest) ? readRunManifest(manifest) : undefined
        const need = () => {
            if (runs == null)
                throw new Error('docs/evaluation/runs.json is needed to know which runs belong to a dataset')
            return runs
        }
        const wrote = (file: string) => console.log(`Wrote ${file}`)
        switch (args.source) {
            case 'latency':
                return wrote(latencyTables(root, args.deployment, need()))
            case 'edge':
                return edgeTables(root, args.deployment, need()).forEach(wrote)
            case 'scale':
                return scaleTables(root, need()).forEach(wrote)
            case 'all': {
                const r = need()
                wrote(writeGasReport(root, args.deployment, 'ops', r))
                edgeTables(root, args.deployment, r).forEach(wrote)
                wrote(latencyTables(root, args.deployment, r))
                scaleTables(root, r).forEach(wrote)
                // Every latency run gets the same rule-5 rendering from its raw JSON.
                regenerateLatencyRuns(root, readLatencyReports(path.join(root, 'e2e_reports')))
                writeStorageTables(root).forEach(wrote)
                return wrote(writeDataIndex(root, r))
            }
            default:
                return wrote(writeGasReport(root, args.deployment, args.source as ReportPrefix, runs))
        }
    })
