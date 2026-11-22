import fs from 'node:fs'
import path from 'node:path'

import { latexTable } from './latex'

// DS5 of docs/evaluation/PROTOCOL.md: the tables built from `e2e_reports/storage-baseline.json`, which the Foundry test
// `test/foundry/StorageBaseline.t.sol` writes. Rendering is a pure function of that file, so the tables regenerate
// byte for byte.

export type StorageSingle = {
    readonly name: string
    readonly payloadBytes: number
    readonly cidBytes: number
    readonly registryIssueGas: number
    readonly bytesIssueGas: number
    readonly registryReviseGas: number
    readonly bytesReviseGas: number
    readonly bytesReviseOneWordGas: number
    readonly registrySlots: number
    readonly bytesSlots: number
}

export type StorageGrowth = {
    readonly revisions: number
    readonly payloadBytesAll: number
    readonly registryGas: number
    readonly bytesLatestGas: number
    readonly bytesAllGas: number
    readonly registrySlots: number
    readonly bytesLatestSlots: number
    readonly bytesAllSlots: number
}

export type StorageBaseline = {
    readonly forge: string
    readonly profile: string
    readonly emptyCallGas: number
    readonly maxCidBytes: number
    readonly single: readonly StorageSingle[]
    readonly growth: readonly StorageGrowth[]
}

/** A reference size for one block, against which a single transaction is marked; not a claim about any one chain. */
export const BLOCK_GAS_REFERENCE = 30_000_000

const SINGLE_KEYS = [
    'name',
    'payloadBytes',
    'cidBytes',
    'registryIssueGas',
    'bytesIssueGas',
    'registryReviseGas',
    'bytesReviseGas',
    'bytesReviseOneWordGas',
    'registrySlots',
    'bytesSlots',
] as const
const GROWTH_KEYS = [
    'revisions',
    'payloadBytesAll',
    'registryGas',
    'bytesLatestGas',
    'bytesAllGas',
    'registrySlots',
    'bytesLatestSlots',
    'bytesAllSlots',
] as const

export function parseStorageBaseline(text: string): StorageBaseline {
    const value = JSON.parse(text) as Partial<StorageBaseline>
    for (const key of ['forge', 'profile'] as const) {
        if (typeof value[key] !== 'string') throw new Error(`storage baseline: ${key} is missing`)
    }
    for (const key of ['emptyCallGas', 'maxCidBytes'] as const) {
        if (!Number.isSafeInteger(value[key]) || (value[key] as number) <= 0)
            throw new Error(`storage baseline: ${key} is missing`)
    }
    const rows = (name: 'single' | 'growth', keys: readonly string[]) => {
        const list = value[name] as readonly Record<string, unknown>[] | undefined
        if (!Array.isArray(list) || list.length === 0) throw new Error(`storage baseline: ${name} is empty`)
        for (const row of list) {
            for (const key of keys) {
                // Counts and gas are safe, non-negative integers; every figure that is a divisor below is positive.
                const ok = key === 'name' ? typeof row[key] === 'string' : Number.isSafeInteger(row[key])
                if (!ok) throw new Error(`storage baseline: ${name} row without a valid ${key}`)
                if (key !== 'name' && (row[key] as number) < 0)
                    throw new Error(`storage baseline: ${name} row has a negative ${key}`)
                if (/Gas$/.test(key) && key !== 'name' && row[key] === 0)
                    throw new Error(`storage baseline: ${name} row has ${key} = 0, which no transaction can cost`)
            }
        }
    }
    rows('single', SINGLE_KEYS)
    rows('growth', GROWTH_KEYS)
    return value as StorageBaseline
}

const n0 = (v: number) => v.toLocaleString('en-US')
const ratio = (bytes: number, registry: number) => (bytes / registry).toFixed(1)
const over = (gas: number) => (gas > BLOCK_GAS_REFERENCE ? ' †' : '')

const singleHeader = [
    'Payload',
    'Bytes',
    'Registry issue',
    'Bytes issue',
    'Ratio',
    'Registry revise',
    'Bytes revise, all words',
    'Ratio',
    'Bytes revise, one word',
    'Ratio',
    'Slots written (registry / bytes)',
]
const singleCells = (r: StorageSingle) => [
    r.name,
    n0(r.payloadBytes),
    n0(r.registryIssueGas),
    `${n0(r.bytesIssueGas)}${over(r.bytesIssueGas)}`,
    ratio(r.bytesIssueGas, r.registryIssueGas),
    n0(r.registryReviseGas),
    `${n0(r.bytesReviseGas)}${over(r.bytesReviseGas)}`,
    ratio(r.bytesReviseGas, r.registryReviseGas),
    `${n0(r.bytesReviseOneWordGas)}${over(r.bytesReviseOneWordGas)}`,
    ratio(r.bytesReviseOneWordGas, r.registryReviseGas),
    `${r.registrySlots} / ${n0(r.bytesSlots)}`,
]

const growthHeader = [
    'Revisions',
    'Payload bytes in all',
    'Registry',
    'Bytes, latest only',
    'Ratio',
    'Bytes, all revisions',
    'Ratio',
    'Slots written (registry / latest / all)',
]
const growthCells = (g: StorageGrowth) => [
    String(g.revisions),
    n0(g.payloadBytesAll),
    n0(g.registryGas),
    n0(g.bytesLatestGas),
    ratio(g.bytesLatestGas, g.registryGas),
    n0(g.bytesAllGas),
    ratio(g.bytesAllGas, g.registryGas),
    `${g.registrySlots} / ${g.bytesLatestSlots} / ${n0(g.bytesAllSlots)}`,
]

const NOTE =
    'Each figure is the gas of one call measured with `gasleft()` around it while `forge test` runs every call as a transaction of its own (`isolate`), so storage is cold: ' +
    'the 21,000 base gas, the calldata, the execution and the dispatch of the caller. The call that does nothing, given above, is the floor. ' +
    'Registry = `PassportRegistry` as deployed (`(revision, historyHash, cid)` plus the `mintedCount` counter and the events, which carry the CID). ' +
    'Bytes = the payload itself as `bytes` in a mapping, with the same counter and a revision number; "all revisions" keeps every revision in an array. ' +
    'Issue = the first issue on a fresh contract (counter 0 to 1); revise = the first revision. ' +
    '"All words" rewrites every 32-byte word of the payload (the worst case), "one word" changes a single word (a localized edit). ' +
    'ERC-721 ownership is the same in both designs and left out. The payload bytes are the committed fixtures (`fixtures/`); the CID is 59 bytes in every row. ' +
    'Slot counts are calculated from the lengths, and checked only for what the stored values are, not for the layout. ' +
    'Pinning the payload off chain costs money outside gas and is not in these figures. ' +
    '† a single transaction above 30,000,000 gas, taken as a reference size for one block; the limit of each chain differs.'

export function storageMarkdown(b: StorageBaseline): string {
    const table = (header: readonly string[], rows: readonly (readonly string[])[], right: readonly boolean[]) => [
        `| ${header.join(' | ')} |`,
        `| ${right.map((r) => (r ? '---:' : '---')).join(' | ')} |`,
        ...rows.map((r) => `| ${r.join(' | ')} |`),
    ]
    return [
        '# On-chain storage baseline (DS5)',
        '',
        `Generated from \`e2e_reports/storage-baseline.json\`. ${b.forge}, profile \`${b.profile}\`. A call that does nothing costs ${n0(b.emptyCallGas)} gas.`,
        '',
        NOTE,
        '',
        '## One passport: issue and revise',
        '',
        ...table(singleHeader, b.single.map(singleCells), [
            false,
            true,
            true,
            true,
            true,
            true,
            true,
            true,
            true,
            true,
            true,
        ]),
        '',
        '## One passport over its revisions (cumulative gas of the issue and every revision)',
        '',
        ...table(growthHeader, b.growth.map(growthCells), [true, true, true, true, true, true, true, true]),
        '',
    ].join('\n')
}

export function storageLatex(b: StorageBaseline): string {
    return [
        latexTable(
            'lrrrrrrrrrr',
            [singleHeader, ...b.single.map(singleCells)],
            'Gas to issue and revise one passport, with the state as (revision, CID) and as the payload bytes (DS5). A dagger marks a single transaction above the reference of 30,000,000 gas.',
            'tab:storage-single'
        ),
        latexTable(
            'rrrrrrrr',
            [growthHeader, ...b.growth.map(growthCells)],
            'Cumulative gas of the issue and every revision of one passport (DS5).',
            'tab:storage-growth'
        ),
    ].join('\n')
}

/** Reads the raw result and writes the Markdown and LaTeX tables next to it. Returns the written paths. */
export function writeStorageTables(root: string): string[] {
    const dir = path.join(root, 'e2e_reports')
    const baseline = parseStorageBaseline(fs.readFileSync(path.join(dir, 'storage-baseline.json'), 'utf8'))
    const md = path.join(dir, 'storage-baseline.md')
    const tex = path.join(dir, 'storage-baseline.tex')
    fs.writeFileSync(md, storageMarkdown(baseline))
    fs.writeFileSync(tex, storageLatex(baseline))
    return [md, tex]
}
