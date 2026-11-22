import fs from 'node:fs'
import path from 'node:path'

import { FlowReportFile } from './gas-report'
import { latexTable } from './latex'
import { StepRecord, liveEvidenceLabel } from './report'

// DS3 table: per case and chain, whether the rule held (docs/evaluation/PROTOCOL.md, DS3). Built from the raw edge
// reports of the runs that docs/evaluation/runs.json lists as DS3. A step with a failed check counts as a failure of
// its case, never as a missing observation.

const REJECTIONS: readonly { readonly label: string; readonly test: RegExp }[] = [
    { label: 'mint by a non-issuer', test: /^mint \(not an issuer\)$/ },
    { label: 'revise by the holder', test: /^revise \(holder, not an issuer\)$/ },
    { label: 'revise with a stale revision', test: /^revise \(stale expectedRevision \d+\)$/ },
    { label: 'mint with a wrong expected token id', test: /^mint \(wrong expectedTokenId\)$/ },
]

const CONFIG_CHECK = /^(\w+) by the second account: eth_call reverts with (\w+)\(/

const allOk = (s: StepRecord) => s.checks.every((c) => c.ok)
const minedReverted = (s: StepRecord) =>
    s.checks.some((c) => c.name === 'transaction mined and reverted on chain' && c.ok)
// The error the step expected is in the name of its simulation check, which exists whether or not the check held.
const expectedError = (s: StepRecord) =>
    s.checks.map((c) => /^eth_call reverts with (\w+)/.exec(c.name)?.[1]).find((n) => n != null) ?? 'none recorded'

export type RejectionRow = {
    readonly case: string
    readonly network: string
    readonly n: number
    readonly expectedError: string
    /** Observations whose checks all held: the simulation gave the named error with the expected arguments and the mined transaction has status 0. */
    readonly held: number
    readonly minedReverts: number
    readonly gas: readonly number[]
}

export type PermittedRow = {
    readonly case: string
    readonly network: string
    readonly n: number
    readonly succeeded: number
    readonly gas: readonly number[]
}

/** A call refused by an eth_call only (DS3 from 2026-10-18): no transaction, so no gas and no receipt. */
export type ConfigRow = {
    readonly call: string
    readonly network: string
    readonly n: number
    readonly expectedError: string
    readonly held: number
}

export type MaxCidRow = {
    readonly route: string
    readonly n: number
    readonly delivered: number
    /** Primary clock, block timestamp of `ONFTSent` to block timestamp of `ONFTReceived`, per delivered hop. */
    readonly seconds: readonly number[]
    /** Gas used by the whole delivery transaction on the destination (the executor's call), per hop. */
    readonly deliveryTxGas: readonly number[]
    readonly enforcedGas: number | null
    readonly replays: number
    readonly replaysRejected: number
}

/** Flow name prefix of the maximum-length CID case; the rest of the name is the route `source -> destination`. */
export const MAX_CID_FLOW = 'edge maximum-length CID'

export type EdgeCases = {
    readonly deploymentId: string
    readonly runs: readonly string[]
    readonly rejections: readonly RejectionRow[]
    readonly permitted: readonly PermittedRow[]
    readonly configuration: readonly ConfigRow[]
    readonly maxCid: readonly MaxCidRow[]
}

/** Enforced `lzReceive` gas per destination network, read from layerzero.config.ts by the caller. */
export type EnforcedGas = Readonly<Record<string, number>>

const by = <T>(xs: readonly T[], key: (x: T) => string) => {
    const m = new Map<string, T[]>()
    for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x])
    return m
}

export function edgeCases(reports: readonly FlowReportFile[], deploymentId: string, enforced: EnforcedGas): EdgeCases {
    const mine = reports.filter((r) => r.deploymentId === deploymentId)
    const steps = mine.flatMap((r) => r.flows.flatMap((f) => f.steps))
    const rejections: RejectionRow[] = []
    for (const { label, test } of REJECTIONS) {
        for (const [network, group] of by(
            steps.filter((s) => test.test(s.step)),
            (s) => s.network
        )) {
            rejections.push({
                case: label,
                network,
                n: group.length,
                expectedError: [...new Set(group.map(expectedError))].join(', '),
                held: group.filter(allOk).length,
                minedReverts: group.filter(minedReverted).length,
                gas: group.filter((s) => s.gasUsed != null).map((s) => Number(s.gasUsed)),
            })
        }
    }
    const permitted: PermittedRow[] = []
    const transfers = steps.filter((s) => s.step === 'transfer' && s.state?.includes('transferFrom'))
    for (const [network, group] of by(transfers, (s) => s.network)) {
        permitted.push({
            case: 'transferFrom by an approved operator',
            network,
            n: group.length,
            succeeded: group.filter(allOk).length,
            gas: group.filter((s) => s.gasUsed != null).map((s) => Number(s.gasUsed)),
        })
    }
    const configuration: ConfigRow[] = []
    const configChecks = steps
        .filter((s) => s.step === 'configuration and receive (not the owner, not the endpoint)')
        .flatMap((s) => s.checks.map((c) => ({ network: s.network, ok: c.ok, m: CONFIG_CHECK.exec(c.name) })))
        .filter((c) => c.m != null)
    for (const [key, group] of by(configChecks, (c) => `${c.m?.[1]}|${c.network}`)) {
        const [call, network] = key.split('|')
        configuration.push({
            call,
            network,
            n: group.length,
            expectedError: group[0].m?.[2] ?? 'none recorded',
            held: group.filter((c) => c.ok).length,
        })
    }
    const sends = steps.filter((s) => /^send .+ -> .+$/.test(s.step) && s.cidLength === 96)
    const replays = steps.filter((s) => /^replay of .+ -> .+$/.test(s.step))
    const maxCid: MaxCidRow[] = []
    // A planned route whose flow has no send (a run that stopped before it) gets a row with n = 0.
    const planned = mine.flatMap((r) =>
        r.flows.filter((f) => f.flow.startsWith(`${MAX_CID_FLOW} `)).map((f) => f.flow.slice(MAX_CID_FLOW.length + 1))
    )
    const routes = by(sends, (s) => s.step.replace(/^send /, ''))
    for (const route of planned) if (!routes.has(route)) routes.set(route, [])
    for (const [route, group] of routes) {
        const destination = route.split(' -> ')[1]
        const rep = replays.filter((s) => s.step === `replay of ${route}`)
        maxCid.push({
            route,
            n: group.length,
            delivered: group.filter((s) => s.delivered === true).length,
            seconds: group.map((s) => s.deliverySecondsChain).filter((v): v is number => v != null),
            deliveryTxGas: group
                .map((s) => s.received?.gasUsed)
                .filter((v): v is string => v != null)
                .map(Number),
            enforcedGas: enforced[destination] ?? null,
            replays: rep.length,
            replaysRejected: rep.filter((s) => allOk(s) && minedReverted(s)).length,
        })
    }
    const sortBy = <T>(xs: T[], f: (x: T) => string) => xs.sort((a, b) => f(a).localeCompare(f(b)))
    return {
        deploymentId,
        runs: mine.map((r) => r.runId).sort(),
        rejections: sortBy(rejections, (r) => `${r.case}|${r.network}`),
        permitted: sortBy(permitted, (r) => `${r.case}|${r.network}`),
        configuration: sortBy(configuration, (r) => `${r.call}|${r.network}`),
        maxCid: sortBy(maxCid, (r) => r.route),
    }
}

const range = (xs: readonly number[]) =>
    xs.length === 0
        ? 'n/a'
        : Math.min(...xs) === Math.max(...xs)
          ? Math.min(...xs).toLocaleString('en-US')
          : `${Math.min(...xs).toLocaleString('en-US')} to ${Math.max(...xs).toLocaleString('en-US')}`

const rejHeader = ['Case', 'Chain', 'n', 'Expected error', 'Held', 'Mined as reverted', 'Gas of the reverted tx']
const rejCells = (r: RejectionRow) => [
    r.case,
    r.network,
    String(r.n),
    r.expectedError,
    `${r.held} of ${r.n}`,
    `${r.minedReverts} of ${r.n}`,
    range(r.gas),
]
const perHeader = ['Case', 'Chain', 'n', 'Succeeded', 'Gas used']
const perCells = (r: PermittedRow) => [r.case, r.network, String(r.n), `${r.succeeded} of ${r.n}`, range(r.gas)]
const cfgHeader = ['Call', 'Chain', 'n', 'Expected error', 'Held']
const cfgCells = (r: ConfigRow) => [r.call, r.network, String(r.n), r.expectedError, `${r.held} of ${r.n}`]
const maxHeader = [
    'Route',
    'n',
    'Delivered',
    'Primary clock (s)',
    'Delivery tx gas used',
    'Enforced lzReceive gas',
    'Replays rejected',
]
const maxCells = (r: MaxCidRow) => [
    r.route,
    String(r.n),
    `${r.delivered} of ${r.n}`,
    r.seconds.join(', '),
    range(r.deliveryTxGas),
    r.enforcedGas == null ? 'n/a' : r.enforcedGas.toLocaleString('en-US'),
    `${r.replaysRejected} of ${r.replays}`,
]

export const edgeMarkdown = (e: EdgeCases) =>
    [
        `# DS3: edge cases on chain, deployment ${e.deploymentId}`,
        '',
        `Runs: ${e.runs.join(', ')}. Generated by \`e2e:tables --source edge\` from the raw edge reports that \`docs/evaluation/runs.json\` lists as DS3. Evidence label ${liveEvidenceLabel(e.deploymentId)}. A step with a failed check counts in n and not in Held or Succeeded. No clock is used for the authorisation cases.`,
        '',
        '## Rejection cases',
        '',
        'Held: the `eth_call` reverted with the named custom error and the expected arguments, and the same call broadcast with a fixed gas limit was mined with status 0. The harness uses a fixed limit of 400,000. Reported gas comes from the sealed receipt; it is the gas of a rejected transaction, not a cost of the rule.',
        '',
        `| ${rejHeader.join(' | ')} |`,
        '| --- | --- | ---: | --- | ---: | ---: | ---: |',
        ...e.rejections.map((r) => `| ${rejCells(r).join(' | ')} |`),
        '',
        '## Permitted cases',
        '',
        `| ${perHeader.join(' | ')} |`,
        '| --- | --- | ---: | ---: | ---: |',
        ...e.permitted.map((r) => `| ${perCells(r).join(' | ')} |`),
        '',
        '## Configuration and receive by another account (eth_call, no transaction)',
        '',
        'Held: the `eth_call` from the second account reverted with the named custom error naming that account. No transaction is sent, so there is no receipt and no gas.',
        '',
        `| ${cfgHeader.join(' | ')} |`,
        '| --- | --- | ---: | --- | ---: |',
        ...e.configuration.map((r) => `| ${cfgCells(r).join(' | ')} |`),
        '',
        '## Maximum-length CID (96 bytes), sent from the cheapest other chain and replayed',
        '',
        "Delivery tx gas is the gas used by the whole delivery transaction on the destination (the executor's call into the endpoint), which is more than `lzReceive` alone; it is shown beside the enforced `lzReceive` gas of `layerzero.config.ts` and is not a measure of the headroom. A replay is the packet of the delivered send executed again on the destination endpoint; it must be rejected (`LZ_PayloadHashNotFound`).",
        '',
        `| ${maxHeader.join(' | ')} |`,
        '| --- | ---: | ---: | --- | ---: | ---: | ---: |',
        ...e.maxCid.map((r) => `| ${maxCells(r).join(' | ')} |`),
        '',
    ].join('\n')

export const edgeLatex = (e: EdgeCases) => [
    latexTable(
        'llrlrrr',
        [rejHeader, ...e.rejections.map(rejCells)],
        `Rejection cases on deployment ${e.deploymentId}: n observations per case and chain, how many held (named custom error from the simulation and a transaction mined with status 0). ${liveEvidenceLabel(e.deploymentId)}, no clock. Gas of the reverted transaction: the harness sets a limit of 400,000.`,
        'tab:edge-rejections'
    ),
    latexTable(
        'llrrr',
        [perHeader, ...e.permitted.map(perCells)],
        `Permitted cases on deployment ${e.deploymentId}: n observations per case and chain. ${liveEvidenceLabel(e.deploymentId)}, no clock.`,
        'tab:edge-permitted'
    ),
    latexTable(
        'llrlr',
        [cfgHeader, ...e.configuration.map(cfgCells)],
        `Owner-only configuration and endpoint-only receive called by another account on deployment ${e.deploymentId}: n eth_calls per call and chain, how many reverted with the named custom error. ${liveEvidenceLabel(e.deploymentId)}, no transaction, no clock.`,
        'tab:edge-configuration'
    ),
    latexTable(
        'lrrlrrr',
        [maxHeader, ...e.maxCid.map(maxCells)],
        `Maximum-length (96-byte) CID on deployment ${e.deploymentId}: n deliveries per route, primary delivery clock of each in seconds, gas used by the whole delivery transaction against the enforced lzReceive gas, and replays rejected. ${liveEvidenceLabel(e.deploymentId)}.`,
        'tab:edge-maxcid'
    ),
]

export function writeEdgeCases(
    root: string,
    deploymentId: string,
    reports: readonly FlowReportFile[],
    enforced: EnforcedGas
): string {
    const e = edgeCases(reports, deploymentId, enforced)
    if (e.runs.length === 0) throw new Error(`No DS3 edge runs for deployment ${deploymentId}`)
    const base = path.join(root, 'e2e_reports', `edge-cases-${deploymentId}`)
    fs.writeFileSync(`${base}.json`, JSON.stringify(e, null, 2) + '\n')
    fs.writeFileSync(`${base}.md`, edgeMarkdown(e))
    fs.writeFileSync(`${base}.tex`, edgeLatex(e).join('\n'))
    return `${base}.tex`
}

/** Enforced gas per destination network: the constants named in `layerzero.config.ts`. */
export function readEnforcedGas(root: string): EnforcedGas {
    const text = fs.readFileSync(path.join(root, 'layerzero.config.ts'), 'utf8')
    const num = (name: string) => {
        const m = new RegExp(`const ${name} = ([\\d_]+)`).exec(text)
        if (m == null) throw new Error(`${name} not found in layerzero.config.ts`)
        return Number(m[1].replace(/_/g, ''))
    }
    const evm = num('LZ_RECEIVE_GAS')
    return { 'arbitrum-sepolia': evm, 'base-sepolia': evm, sepolia: num('SEPOLIA_LZ_RECEIVE_GAS') }
}
