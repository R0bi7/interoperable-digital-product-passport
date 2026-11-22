import { expect } from 'chai'
import { confirmLatex, gasLatex } from '../gas-report'
import { edgeCases, edgeLatex, edgeMarkdown } from '../edge-report'
import { poolWindows, renderCostLatex, renderPooledLatex, renderPooledMarkdown } from '../latency-pool'
import { renderMarkdown } from '../report'
import { renderLatencyLatex } from '../latency-report'

describe('generation labels', () => {
    it('names eval3 across table families', () => {
        const id = 'whisky-v2-eval3'
        const edge = edgeCases([], id, {})
        const pool = poolWindows([], id)
        const outputs = [
            gasLatex([], id, 'ops', ['ds1']),
            confirmLatex([], id, ['ds1']),
            renderLatencyLatex([], { runId: 'test', deploymentId: id, window: 'w1' }),
            renderPooledMarkdown(pool),
            renderPooledLatex(pool),
            renderCostLatex(pool),
            edgeMarkdown(edge),
            ...edgeLatex(edge),
        ]
        for (const out of outputs) {
            expect(out).to.contain('LIVE (whisky-v2-eval3)')
        }
    })
})

describe('eval3 fee qualifications', () => {
    it('keeps Base L1 separate and labels both L2 source amounts in ETH', () => {
        const id = 'whisky-v2-eval3'
        const none = { n: 0, summary: null, seconds: [] }
        const routes = ['arbitrum-sepolia -> base-sepolia', 'base-sepolia -> arbitrum-sepolia']
        const p = poolWindows(
            [
                {
                    runId: '1',
                    deploymentId: id,
                    header: { window: 'w1' },
                    directions: routes.map((direction) => ({
                        direction,
                        sent: 1,
                        delivered: 1,
                        chain: none,
                        poll: none,
                    })),
                    flows: [
                        {
                            flow: 'fees',
                            status: 'PASS',
                            steps: routes.map((route) => ({
                                step: `send ${route}`,
                                network: route.split(' -> ')[0],
                                gasUsed: '100',
                                feeWei: '1000000000000000000',
                                l1FeeWei: route.startsWith('base-sepolia') ? '3000000000000000000' : undefined,
                                nativeFee: '2000000000000000000',
                                checks: [],
                            })),
                        },
                    ],
                },
            ],
            id
        )
        for (const out of [renderPooledMarkdown(p), renderCostLatex(p)]) {
            expect(out).to.contain('Source receipt gas fee')
            expect(out).to.contain('L1 data charge')
            expect(out).to.match(/not (?:the )?complete transaction cost/)
            expect(out.match(/1\.0 ETH/g)).to.have.length(2)
            expect(out.match(/2\.0 ETH/g)).to.have.length(2)
            expect(out).not.to.contain('4.0 ETH')
        }
    })

    it('qualifies the per-run fee column', () => {
        const flow = { flow: 'f', status: 'PASS' as const, steps: [] }
        const current = renderMarkdown('1', 'whisky-v2-eval3', undefined, [], [flow])
        expect(current).to.contain('Receipt gas fee (wei)')
        expect(current).to.contain('on Base it excludes the separate L1 data charge')
    })
})

describe('eval3 window labels and UTC starts', () => {
    it('derives calendar days from UTC instants rather than short labels', () => {
        const id = 'whisky-v2-eval3'
        const p = poolWindows(
            [
                {
                    runId: '1',
                    deploymentId: id,
                    header: { window: 'w1', startedAt: '2026-10-20T00:56:39+02:00' },
                    directions: [],
                },
                {
                    runId: '2',
                    deploymentId: id,
                    header: { window: 'w2', startedAt: '2026-10-20T01:56:40Z' },
                    directions: [],
                },
            ],
            id
        )
        expect(p.check.days).to.deep.equal(['2026-10-19', '2026-10-20'])
        const out = renderPooledMarkdown(p)
        expect(out).to.contain('Window labels: w1, w2')
        expect(out).to.contain('w1: 2026-10-19T22:56:39.000Z')
        expect(out).not.to.contain('Observation days (UTC): w1')
    })
    it('reports an absent timestamp without treating a label as a date', () => {
        const p = poolWindows(
            [{ runId: '1', deploymentId: 'whisky-v2-eval3', header: { window: 'w1' }, directions: [] }],
            'whisky-v2-eval3'
        )
        expect(p.check.days).to.deep.equal([])
        expect(renderPooledMarkdown(p)).to.contain('w1: UTC start not recorded')
    })
})
