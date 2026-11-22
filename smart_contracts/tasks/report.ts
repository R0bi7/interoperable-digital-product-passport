import type { providers } from 'ethers'

import fs from 'node:fs'
import path from 'node:path'

import { Verdict, Verification, allVerified } from './payload'
import { RunHeader, headerMarkdown } from './run-header'

// Report types and rendering of the live flows (e2e_reports/flows-<runId>.{json,md}).

export const liveEvidenceLabel = (deploymentId: string): string => `LIVE (${deploymentId})`

export type ReportPrefix = 'flows' | 'ops' | 'edge'

export type Check = { readonly name: string; readonly ok: boolean; readonly detail: string }

/** The destination side of a delivery: the `ONFTReceived` event located on the destination chain. */
export type ReceiveRecord = {
    readonly txHash: string
    readonly blockNumber: number
    readonly blockTimestamp: number
    /** Gas used by the whole delivery transaction (the executor's call into the endpoint), not only `lzReceive`. */
    readonly gasUsed?: string
}

export type StepRecord = {
    readonly step: string
    readonly network: string
    readonly txHash?: string
    /** Diagnostic only: an unsealed receipt, excluded from measured gas, fees and block fields. */
    readonly provisionalReceipt?: providers.TransactionReceipt
    readonly gasUsed?: string
    /** LayerZero fee quoted for a send and paid as `msg.value`, in wei. */
    readonly nativeFee?: string
    /** `effectiveGasPrice` of the receipt, in wei. Together with `gasUsed` it gives `feeWei`. */
    readonly effectiveGasPrice?: string
    /** Receipt gas fee, `gasUsed * effectiveGasPrice`, in wei; excludes Base L1 data charge. */
    readonly feeWei?: string
    /** Supplementary Base L1 data charge from the matching raw receipt; absent when unavailable, separate from feeWei. */
    readonly l1FeeWei?: string
    readonly blockNumber?: number
    /** Block timestamp of the inclusion block, in seconds. */
    readonly blockTimestamp?: number
    /** Wall-clock time at which the node accepted the transaction, and at which the first receipt was seen (ms). */
    readonly submittedAtMs?: number
    readonly includedAtMs?: number
    /** Same-chain clock 1: wall-clock seconds from the node's answer to the submission to the first receipt. */
    readonly confirmSeconds?: number
    /** Same-chain clock 2: block timestamp of the inclusion block minus that of the head block read just after the submission was answered. */
    readonly blockSeconds?: number
    /** Bytes of the canonical payload and length of the CID written or carried by this step. */
    readonly payloadBytes?: number
    readonly cidLength?: number
    /** Slot state that changes the gas: for example `depth 3` of a revise, `first arrival` or `return` of a send. */
    readonly state?: string
    /** Whether the token was seen on the destination within the timeout (a delivered hop can lack both clocks). */
    readonly delivered?: boolean
    /** Cross-chain delivery, primary clock: source `ONFTSent` block timestamp to destination `ONFTReceived` block timestamp. */
    readonly deliverySecondsChain?: number
    /** Cross-chain delivery, continuity clock: source block timestamp to the first poll that saw the token (about 5 s). */
    readonly deliverySeconds?: number
    readonly received?: ReceiveRecord
    /** Outcome of locating `ONFTReceived` on the destination. Anything but `found` means no primary-clock value. */
    readonly receivedLookup?: 'found' | 'not found' | 'error'
    /** Set when the receipt was confirmed but its block could not be read, so block fields are missing. */
    readonly measureNote?: string
    /** LayerZero Scan status of a send, as last seen. */
    readonly scanStatus?: string
    /** What an expected revert produced, for example `StaleRevision(0, 1)`. */
    readonly outcome?: string
    /** The three results for the payload behind the passport this step read. */
    readonly verification?: Verification
    readonly checks: Check[]
}

export type FlowRecord = {
    readonly flow: string
    status: 'PASS' | 'FAIL'
    tokenId?: string
    error?: string
    readonly steps: StepRecord[]
}

export type RunSummary = {
    readonly flowsRun: number
    readonly passed: number
    readonly failed: number
    /** Steps where content, binding or history is not `verified`. */
    readonly verificationFailures: number
}

export type Deployment = { network: string; chainId: number; eid: number; address: string }

export function summarize(flows: readonly FlowRecord[]): RunSummary {
    const passed = flows.filter((f) => f.status === 'PASS').length
    const verificationFailures = flows
        .flatMap((f) => f.steps)
        .filter((s) => s.verification != null && !allVerified(s.verification)).length
    return { flowsRun: flows.length, passed, failed: flows.length - passed, verificationFailures }
}

export const summaryLine = (summary: RunSummary): string =>
    `${summary.flowsRun} flows run, ${summary.passed} passed, ${summary.verificationFailures} verification failures`

const cell = (verdict: Verdict | undefined): string =>
    verdict == null ? '' : verdict.status === 'verified' ? 'verified' : `${verdict.status}: ${verdict.reason ?? ''}`

export function renderMarkdown(
    runId: string,
    deploymentId: string,
    account: string | undefined,
    deployments: readonly Deployment[],
    flows: readonly FlowRecord[],
    header?: RunHeader
): string {
    const lines = [
        `# WhiskyDistillery core flows, run ${runId}`,
        '',
        `Started ${new Date(Number(runId)).toISOString()}. Deployment \`${deploymentId}\`. Account ${account}.`,
        '',
        `**Summary: ${summaryLine(summarize(flows))}.**`,
        '',
        '| Network | Chain ID | eid | Contract |',
        '| --- | ---: | ---: | --- |',
        ...deployments.map((d) => `| ${d.network} | ${d.chainId} | ${d.eid} | \`${d.address}\` |`),
        '',
        ...(header == null ? [] : headerMarkdown(header)),
        "Receipt gas fee is `gasUsed × effectiveGasPrice`; on Base it excludes the separate L1 data charge. Supplementary L1 values, when available, are stored separately in JSON. The LayerZero fee is the send's `msg.value`.",
        '',
        '| Flow | Status | Token ID | Steps |',
        '| --- | --- | --- | --- |',
        ...flows.map(
            (f) => `| ${f.flow} | ${f.status} | ${f.tokenId ?? ''} | ${f.steps.map((s) => s.step).join('; ')} |`
        ),
        '',
    ]
    for (const f of flows) {
        lines.push(`## ${f.flow}: ${f.status}`, '')
        if (f.error) lines.push(`Error: ${f.error}`, '')
        lines.push(
            `| Step | Tx | Gas used | Receipt gas fee (wei) | LZ fee (wei) | Confirm (s) | Block (s) | Delivery block to block (s) | Delivery to poll (s) | LayerZero Scan | Outcome | Content | Binding | History | Checks |`,
            '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- | --- |'
        )
        for (const s of f.steps) {
            const checks = s.checks.map((c) => `${c.ok ? '✓' : '✗'} ${c.name}`).join('<br>')
            lines.push(
                `| ${s.step} | ${s.txHash ? `\`${s.txHash}\`` : ''} | ${s.gasUsed ?? ''} | ${s.feeWei ?? ''} | ${s.nativeFee ?? ''} | ${s.confirmSeconds ?? ''} | ${s.blockSeconds ?? ''} | ${s.deliverySecondsChain ?? ''} | ${s.deliverySeconds ?? ''} | ${s.scanStatus ?? ''} | ${s.outcome ?? ''} | ${cell(s.verification?.content)} | ${cell(s.verification?.binding)} | ${cell(s.verification?.history)} | ${checks} |`
            )
        }
        lines.push('')
    }
    return lines.join('\n')
}

export function writeReport(
    root: string,
    runId: string,
    deploymentId: string,
    account: string | undefined,
    deployments: readonly Deployment[],
    flows: readonly FlowRecord[],
    header?: RunHeader,
    // `flows` for e2e:flows; `ops` and `edge` keep the datasets of docs/evaluation/PROTOCOL.md in files of their own.
    prefix: ReportPrefix = 'flows',
    status?: 'interrupted'
): string {
    const dir = path.join(root, 'e2e_reports')
    fs.mkdirSync(dir, { recursive: true })
    const summary = summarize(flows)
    fs.writeFileSync(
        path.join(dir, `${prefix}-${runId}.json`),
        JSON.stringify(
            { runId, deploymentId, header, ...(status ? { status } : {}), summary, deployments, flows },
            null,
            2
        ) + '\n'
    )
    const file = path.join(dir, `${prefix}-${runId}.md`)
    fs.writeFileSync(
        file,
        (status ? `Run status: ${status}\n\n` : '') +
            renderMarkdown(runId, deploymentId, account, deployments, flows, header)
    )
    return file
}
