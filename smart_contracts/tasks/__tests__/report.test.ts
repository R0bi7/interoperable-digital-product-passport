import { expect } from 'chai'

import { failed, skipped, verified } from '../payload'
import { FlowRecord, renderMarkdown, summarize, summaryLine } from '../report'

const ok = { content: verified(), binding: verified(), history: verified() }

const flows: FlowRecord[] = [
    {
        flow: 'stale arbitrum-sepolia',
        status: 'PASS',
        tokenId: '421614000000000010',
        steps: [
            {
                step: 'mint',
                network: 'arbitrum-sepolia',
                verification: ok,
                checks: [{ name: 'a', ok: true, detail: '' }],
            },
            {
                step: 'revise (stale expectedRevision 0)',
                network: 'arbitrum-sepolia',
                outcome: 'expected revert StaleRevision(0, 1)',
                verification: ok,
                checks: [],
            },
        ],
    },
    {
        flow: 'cycle',
        status: 'FAIL',
        error: 'send failed',
        steps: [
            {
                step: 'send arbitrum-sepolia -> base-sepolia',
                network: 'arbitrum-sepolia',
                scanStatus: 'DELIVERED',
                deliverySeconds: 90,
                verification: {
                    content: failed('hash differs'),
                    binding: skipped('content not verified'),
                    history: skipped('x'),
                },
                checks: [],
            },
        ],
    },
]

describe('report', () => {
    it('summarizes flows run, passed and verification failures', () => {
        const summary = summarize(flows)
        expect(summary).to.deep.equal({ flowsRun: 2, passed: 1, failed: 1, verificationFailures: 1 })
        expect(summaryLine(summary)).to.equal('2 flows run, 1 passed, 1 verification failures')
    })

    it('does not count steps without a passport read as verification failures', () => {
        expect(
            summarize([{ flow: 'x', status: 'PASS', steps: [{ step: 'prepare', network: 'n', checks: [] }] }])
                .verificationFailures
        ).to.equal(0)
    })

    it('renders content, binding and history columns, the scan status and the expected revert', () => {
        const md = renderMarkdown('1791700000000', 'whisky-v2-eval3', '0xabc', [], flows)
        expect(md).to.include('**Summary: 2 flows run, 1 passed, 1 verification failures.**')
        expect(md).to.include('| Content | Binding | History |')
        expect(md).to.include('| DELIVERED |  | failed: hash differs | skipped: content not verified | skipped: x |')
        expect(md).to.include('expected revert StaleRevision(0, 1) | verified | verified | verified |')
    })
})
