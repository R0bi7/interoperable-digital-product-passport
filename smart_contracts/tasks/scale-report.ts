import fs from 'node:fs'
import path from 'node:path'

import { FlowRecord, StepRecord } from './report'
import { RunHeader, headerMarkdown } from './run-header'
import { Summary, summarize } from './statistics'

export const DS4_REFERENCE = {
    mintGas: {
        source: 'DS1 ops-1792442510606, Base later mint to self',
        median: 155874,
        low: 148081,
        high: 163667,
        blockDifferenceMedianSeconds: 2,
    },
    sendGas: {
        source: 'DS2 latency-1792443397016, -1792454208270, -1792465019048, L2 source send',
        median: 234531,
        low: 222805,
        high: 246257,
    },
    nativeFee: {
        source: 'DS2 latency-1792443397016, -1792454208270, -1792465019048, Base to Arbitrum',
        paidWei: '108472967710967',
        lowWei: '103049319325419',
        highWei: '113896616096515',
    },
    delivery: {
        source: 'DS2 latency-1792443397016, -1792454208270, -1792465019048, Base to Arbitrum',
        lowSeconds: 26,
        highSeconds: 52,
    },
} as const

export type ScaleStep = StepRecord & {
    readonly nonce?: number
    readonly minedStatus?: number
    readonly quotedNativeFee?: string
    readonly tokenId?: string
    readonly firstPollAtSeconds?: number
    readonly hopStop?: string
    readonly lateObservation?: { readonly observedAtMs: number; readonly method: 'ownerOf'; readonly owner: string }
}
export type LedgerNote = {
    readonly tokenId: string
    readonly nonce?: number
    readonly state: 'filed' | 'absent' | 'unresolved'
    readonly note: string
    readonly errorCode?: string
}

/** An interrupt writes immediately, before asynchronous owner reads can finish. */
export function ledgerNotesForReport(
    mints: readonly ScaleStep[],
    filedIds: ReadonlySet<string>,
    reconciled: ReadonlyMap<string, LedgerNote>
): LedgerNote[] {
    const notes = [...reconciled.values()]
    for (const step of mints) {
        if (step.tokenId == null || reconciled.has(step.tokenId)) continue
        if (step.minedStatus === 1 && step.checks.every((item) => item.ok)) continue
        notes.push({
            tokenId: step.tokenId,
            nonce: step.nonce,
            state: 'unresolved',
            errorCode: 'NOT_CHECKED',
            note: filedIds.has(step.tokenId)
                ? 'ledger row filed from first receipt; ownerOf not yet reconciled; manual chain check required'
                : 'broadcast mint id not yet reconciled with ownerOf; manual chain check required',
        })
    }
    return notes
}
export type BatchFigures = {
    readonly submittedToLastReceiptSeconds?: number
    readonly firstToLastBlockSeconds?: number
    readonly distinctBlocks: number
    readonly maxInOneBlock: number
    readonly blocksSpanned?: number
    readonly lastDeliverySecondsChain?: number
    readonly lastDeliverySecondsPoll?: number
}

export function batchFigures(steps: readonly ScaleStep[], delivery = false): BatchFigures {
    const submitted = steps.flatMap((s) => (s.submittedAtMs == null ? [] : [s.submittedAtMs]))
    const included = steps.flatMap((s) => (s.includedAtMs == null ? [] : [s.includedAtMs]))
    const timestamps = steps.flatMap((s) => (s.blockTimestamp == null ? [] : [s.blockTimestamp]))
    const blocks = steps.flatMap((s) => (s.blockNumber == null ? [] : [s.blockNumber]))
    const counts = [...new Set(blocks)].map((block) => blocks.filter((b) => b === block).length)
    const received = steps.flatMap((s) => (s.hopStop != null || s.received == null ? [] : [s.received.blockTimestamp]))
    const polls = steps.flatMap((s) =>
        s.hopStop != null || s.deliverySeconds == null || s.blockTimestamp == null
            ? []
            : [s.blockTimestamp + s.deliverySeconds]
    )
    return {
        submittedToLastReceiptSeconds:
            submitted.length && included.length ? (Math.max(...included) - Math.min(...submitted)) / 1000 : undefined,
        firstToLastBlockSeconds: timestamps.length ? Math.max(...timestamps) - Math.min(...timestamps) : undefined,
        distinctBlocks: counts.length,
        maxInOneBlock: Math.max(0, ...counts),
        blocksSpanned: blocks.length ? Math.max(...blocks) - Math.min(...blocks) + 1 : undefined,
        ...(delivery && timestamps.length
            ? {
                  lastDeliverySecondsChain: received.length
                      ? Math.max(...received) - Math.min(...timestamps)
                      : undefined,
                  lastDeliverySecondsPoll: polls.length ? Math.max(...polls) - Math.min(...timestamps) : undefined,
              }
            : {}),
    }
}

export type ComparisonItem = {
    readonly met: boolean
    readonly count: number
    readonly expected: number
    readonly detail: string
}
export type ScaleComparison = {
    readonly mintGas: ComparisonItem
    readonly sendGas: ComparisonItem
    readonly nativeFee: ComparisonItem
    readonly delivery: ComparisonItem
    readonly integrity: ComparisonItem
    readonly insideDs2DeliveryRange: number
}
const inRange = (value: number | undefined, low: number, high: number) => value != null && value >= low && value <= high

export function compareScale(
    mints: readonly ScaleStep[],
    sends: readonly ScaleStep[],
    requestedMints: number,
    requestedSends: number,
    batch: BatchFigures
): ScaleComparison {
    const mintGas = mints.filter(
        (s) => s.minedStatus === 1 && inRange(Number(s.gasUsed), DS4_REFERENCE.mintGas.low, DS4_REFERENCE.mintGas.high)
    ).length
    const sendGas = sends.filter(
        (s) => s.minedStatus === 1 && inRange(Number(s.gasUsed), DS4_REFERENCE.sendGas.low, DS4_REFERENCE.sendGas.high)
    ).length
    const fee = sends.filter(
        (s) =>
            s.nativeFee != null &&
            BigInt(s.nativeFee) >= BigInt(DS4_REFERENCE.nativeFee.lowWei) &&
            BigInt(s.nativeFee) <= BigInt(DS4_REFERENCE.nativeFee.highWei)
    ).length
    const delivered = sends.filter((s) => s.delivered === true && s.hopStop == null).length
    const inside = sends.filter(
        (s) =>
            s.hopStop == null &&
            inRange(s.deliverySecondsChain, DS4_REFERENCE.delivery.lowSeconds, DS4_REFERENCE.delivery.highSeconds)
    ).length
    const integrity = [...mints, ...sends].filter(
        (s) =>
            s.verification?.content.status === 'verified' &&
            s.verification.binding.status === 'verified' &&
            s.verification.history.status === 'verified' &&
            s.checks.every((c) => c.ok)
    ).length
    return {
        mintGas: {
            met: mintGas === requestedMints,
            count: mintGas,
            expected: requestedMints,
            detail: 'DS1 Base later mint to self ±5%',
        },
        sendGas: {
            met: sendGas === requestedSends,
            count: sendGas,
            expected: requestedSends,
            detail: 'DS2 L2 source send ±5%',
        },
        nativeFee: {
            met: fee === requestedSends,
            count: fee,
            expected: requestedSends,
            detail: 'DS2 Base to Arbitrum paid fee ±5%',
        },
        delivery: {
            met:
                delivered === requestedSends &&
                sends.every((s) => s.hopStop == null && s.deliverySecondsChain != null) &&
                inRange(
                    batch.lastDeliverySecondsChain,
                    DS4_REFERENCE.delivery.lowSeconds,
                    DS4_REFERENCE.delivery.highSeconds
                ),
            count: delivered,
            expected: requestedSends,
            detail: `${inside}/${requestedSends} individual primary clocks within 26–52 s; last delivery ${batch.lastDeliverySecondsChain ?? 'unavailable'} s`,
        },
        integrity: {
            met: integrity === requestedMints + requestedSends,
            count: integrity,
            expected: requestedMints + requestedSends,
            detail: 'content, binding, history and on-chain history hash',
        },
        insideDs2DeliveryRange: inside,
    }
}

type StatKey = 'gasUsed' | 'confirmSeconds' | 'deliverySecondsChain' | 'deliverySeconds' | 'nativeFee'
const statValues = (steps: readonly ScaleStep[], key: StatKey) =>
    steps.flatMap((step) =>
        ((key === 'deliverySecondsChain' || key === 'deliverySeconds') && step.hopStop != null) || step[key] == null
            ? []
            : [step[key]!]
    )

export const scaleStats = (steps: readonly ScaleStep[], key: StatKey): Summary | null => {
    const values = statValues(steps, key).map(Number)
    return values.length ? summarize(values) : null
}

export type ScaleReport = {
    readonly runId: string
    readonly deploymentId: string
    readonly header?: RunHeader
    readonly status?: 'interrupted'
    readonly params: {
        readonly mints: number
        readonly sends: number
        readonly sourceNonceLatest?: number
        readonly sourceNoncePending?: number
    }
    readonly flows: readonly FlowRecord[]
    readonly mints: readonly ScaleStep[]
    readonly sends: readonly ScaleStep[]
    readonly batches: { readonly mints: BatchFigures; readonly sends: BatchFigures }
    readonly comparison: ScaleComparison
    readonly ledgerNotes?: readonly LedgerNote[]
}

export function renderScaleMarkdown(r: ScaleReport): string {
    const rows = Object.entries(r.comparison).filter(([name]) => name !== 'insideDs2DeliveryRange') as [
        string,
        ComparisonItem,
    ][]
    const stats: readonly [
        string,
        readonly ScaleStep[],
        'gasUsed' | 'confirmSeconds' | 'deliverySecondsChain' | 'deliverySeconds' | 'nativeFee',
    ][] = [
        ['mint gas (units)', r.mints, 'gasUsed'],
        ['mint receipt observation (s)', r.mints, 'confirmSeconds'],
        ['send source gas (units)', r.sends, 'gasUsed'],
        ['send receipt observation (s)', r.sends, 'confirmSeconds'],
        ['send LayerZero fee (wei)', r.sends, 'nativeFee'],
        ['delivery primary (s)', r.sends, 'deliverySecondsChain'],
        ['delivery continuity (s)', r.sends, 'deliverySeconds'],
    ]
    const interval = (range: { low: number; high: number } | null) =>
        range == null ? 'n < 10' : `${range.low}–${range.high}`
    return [
        `# DS4 minimal scale confirmation, run ${r.runId}`,
        '',
        `Deployment ${r.deploymentId}. Evidence label: LIVE (${r.deploymentId}).`,
        '',
        ...(r.status ? [`Run status: ${r.status}`, ''] : []),
        ...(r.header ? headerMarkdown(r.header) : []),
        'Local CIDs only: no payload was pinned or served by a gateway. Base receipt gas fees exclude the supplementary L1 data charge.',
        'One account submitted dependent transactions back to back; intervals are optimistic. Cross-chain clock skew is unmeasured.',
        '',
        '| Criterion | Met | Count | Expected | Detail |',
        '| --- | --- | ---: | ---: | --- |',
        ...rows.map(([name, v]) => `| ${name} | ${v.met ? 'yes' : 'no'} | ${v.count} | ${v.expected} | ${v.detail} |`),
        '',
        `Mint batch: ${JSON.stringify(r.batches.mints)}`,
        '',
        `Sequential block-time derivation: ${r.params.mints} × DS1 Base mint block-difference median ${DS4_REFERENCE.mintGas.blockDifferenceMedianSeconds} s = ${r.params.mints * DS4_REFERENCE.mintGas.blockDifferenceMedianSeconds} s; the observed batch wall clock and blocks are above. This arithmetic is not a pass rule.`,
        '',
        `Send batch: ${JSON.stringify(r.batches.sends)}`,
        '',
        '| Measure | n | Median | Q1–Q3 | p95 | Min–max | Outliers | Mean 95% CI | Median 95% CI |',
        '| --- | ---: | ---: | --- | ---: | --- | ---: | --- | --- |',
        ...stats.map(([name, steps, key]) => {
            const s = scaleStats(steps, key)
            if (s == null) return `| ${name} | 0 | | | | | | | |`
            if (s.n < 10) return `| ${name} | ${s.n} | raw: ${statValues(steps, key).join(', ')} | | | | | | |`
            return `| ${name} | ${s.n} | ${s.median} | ${s.q1}–${s.q3} | ${s.p95} | ${s.min}–${s.max} | ${s.outliers} | ${interval(s.meanCi95)} | ${interval(s.medianCi95)} |`
        }),
        '',
        'The raw JSON retains every transaction observation, including misses and both delivery clocks.',
        ...(r.sends.some((step) => step.lateObservation != null)
            ? [
                  '',
                  'Late destination observations after a final hop stop (excluded from delivery figures):',
                  ...r.sends
                      .filter((step) => step.lateObservation != null)
                      .map(
                          (step) =>
                              `- Token ${step.tokenId}: ${step.lateObservation!.method} at ${new Date(step.lateObservation!.observedAtMs).toISOString()} (${step.hopStop}).`
                      ),
              ]
            : []),
        ...(r.ledgerNotes?.length
            ? [
                  '',
                  'Ledger reconciliation notes:',
                  ...r.ledgerNotes.map(
                      (n) => `- Token ${n.tokenId}: ${n.note} [${n.state}${n.errorCode ? `, ${n.errorCode}` : ''}]`
                  ),
              ]
            : []),
        '',
    ].join('\n')
}

export function renderScaleTex(r: ScaleReport): string {
    const rows = Object.entries(r.comparison).filter(([name]) => name !== 'insideDs2DeliveryRange') as [
        string,
        ComparisonItem,
    ][]
    return [
        '% Generated from the scale run JSON; do not edit.',
        '\\begin{tabular}{lrrl}',
        '\\toprule',
        'Criterion & Within range & Planned & Met \\\\',
        '\\midrule',
        ...rows.map(
            ([name, v]) =>
                `${name.replace(/[A-Z]/g, (c) => ' ' + c.toLowerCase())} & ${v.count} & ${v.expected} & ${v.met ? 'yes' : 'no'} \\\\`
        ),
        '\\bottomrule',
        '\\end{tabular}',
        '',
    ].join('\n')
}

export function writeScaleReport(root: string, report: ScaleReport): string {
    const dir = path.join(root, 'e2e_reports')
    fs.mkdirSync(dir, { recursive: true })
    const base = path.join(dir, `scale-${report.runId}`)
    fs.writeFileSync(base + '.json', JSON.stringify(report, null, 2) + '\n')
    fs.writeFileSync(base + '.md', renderScaleMarkdown(report))
    fs.writeFileSync(base + '.tex', renderScaleTex(report))
    return base + '.md'
}
