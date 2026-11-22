import { expect } from 'chai'

import { confirmRows, ds1Coverage, gasLatex, gasRows, operationOf, readFlowReports, stateOf } from '../gas-report'
import { indexRows } from '../data-index'
import { MAX_CID_FLOW, edgeCases, edgeMarkdown } from '../edge-report'
import { poolWindows, renderPooledMarkdown } from '../latency-pool'
import { renderLatencyLatex } from '../latency-report'
import { summarize } from '../statistics'
import { escapeLatex, latexTable } from '../latex'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const step = (step: string, network: string, gasUsed?: string) => ({ step, network, gasUsed, checks: [] })

describe('latex tables', () => {
    it('escapes LaTeX specials and builds a booktabs table', () => {
        expect(escapeLatex('a_b & 50% #1')).to.equal('a\\_b \\& 50\\% \\#1')
        const t = latexTable(
            'lr',
            [
                ['Name', 'n'],
                ['x_y', '2'],
            ],
            'A caption',
            'tab:t'
        )
        expect(t).to.contain('\\toprule').and.to.contain('\\midrule').and.to.contain('\\bottomrule')
        expect(t).to.contain('x\\_y & 2 \\\\')
        expect(t).to.contain('\\label{tab:t}')
    })

    it('renders the latency table with undelivered directions left blank', () => {
        const none = { n: 0, summary: null, seconds: [] }
        const tex = renderLatencyLatex([{ direction: 'a -> b', sent: 2, delivered: 0, chain: none, poll: none }])
        expect(tex).to.contain('Q1--Q3')
        expect(tex).to.contain('a -> b & 2 & 0 & 0 &')
    })
})

describe('gas report', () => {
    it('keeps operations and drops reverted steps', () => {
        expect(operationOf('mint')).to.equal('mint')
        expect(operationOf('revise (expectedRevision 1)')).to.equal('revise')
        expect(operationOf('send base-sepolia -> sepolia')).to.equal('send base-sepolia -> sepolia')
        expect(operationOf('transfer')).to.equal('transfer')
        expect(operationOf('revise (stale expectedRevision 0)')).to.equal(null)
        expect(operationOf('mint (wrong expectedTokenId)')).to.equal(null)
        // setup steps and the expected reverts of e2e:edge are not observations of the operation
        expect(operationOf('mint (setup)')).to.equal(null)
        expect(operationOf('mint (not an issuer)')).to.equal(null)
        expect(operationOf('revise (holder, not an issuer)')).to.equal(null)
        expect(operationOf('approve')).to.equal('approve')
        expect(operationOf('prepare two revisions against revision 0')).to.equal(null)
    })

    it('groups by operation and chain, only for the requested deployment', () => {
        const flow = (steps: ReturnType<typeof step>[]) => ({ flow: 'f', status: 'PASS' as const, steps })
        const rows = gasRows(
            [
                {
                    runId: '1',
                    deploymentId: 'd',
                    flows: [
                        flow([
                            step('mint', 'arbitrum-sepolia', '100'),
                            step('mint', 'arbitrum-sepolia', '300'),
                            step('mint', 'base-sepolia', '200'),
                            step('mint (wrong expectedTokenId)', 'arbitrum-sepolia', '999'),
                        ]),
                    ],
                },
                { runId: '2', deploymentId: 'other', flows: [flow([step('mint', 'arbitrum-sepolia', '1')])] },
            ],
            'd'
        )
        expect(rows.map((r) => [r.operation, r.network, r.summary.n, r.summary.median])).to.deep.equal([
            ['mint', 'arbitrum-sepolia', 2, 200],
            ['mint', 'base-sepolia', 1, 200],
        ])
        expect(gasLatex(rows, 'd')).to.contain('mint & arbitrum-sepolia &  & 2 & 100 & 200 & 300')
    })

    it('keeps slot states apart: revision depth from old reports, the recorded state from new ones', () => {
        expect(stateOf({ step: 'revise (expectedRevision 0)', network: 'x', checks: [] })).to.equal('depth 1')
        expect(stateOf({ step: 'revise (expectedRevision 4)', network: 'x', checks: [] })).to.equal('depth 5')
        expect(stateOf({ step: 'mint', network: 'x', checks: [] })).to.equal('')
        expect(stateOf({ step: 'send a -> b', network: 'x', state: 'first arrival', checks: [] })).to.equal(
            'first arrival'
        )

        const withState = (name: string, gas: string, state?: string) => ({
            ...step(name, 'arbitrum-sepolia', gas),
            state,
        })
        const rows = gasRows(
            [
                {
                    runId: '1',
                    deploymentId: 'd',
                    flows: [
                        {
                            flow: 'f',
                            status: 'PASS' as const,
                            steps: [
                                withState('send a -> b', '300', 'first arrival'),
                                withState('send a -> b', '200', 'return'),
                                withState('send a -> b', '210', 'return'),
                                step('revise (expectedRevision 9)', 'arbitrum-sepolia', '60'),
                                step('revise (expectedRevision 1)', 'arbitrum-sepolia', '50'),
                            ],
                        },
                    ],
                },
            ],
            'd'
        )
        expect(rows.map((r) => [r.operation, r.state, r.summary.n])).to.deep.equal([
            ['revise', 'depth 2', 1],
            ['revise', 'depth 10', 1],
            ['send a -> b', 'first arrival', 1],
            ['send a -> b', 'return', 2],
        ])
    })

    it('reads reports written before the instrumentation, with no header and no timing fields', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-'))
        const old = {
            runId: '1',
            deploymentId: 'd',
            flows: [
                {
                    flow: 'f',
                    status: 'PASS',
                    steps: [{ step: 'mint', network: 'arbitrum-sepolia', gasUsed: '10', checks: [] }],
                },
            ],
        }
        fs.writeFileSync(path.join(dir, 'flows-1.json'), JSON.stringify(old))
        fs.writeFileSync(path.join(dir, 'flows-2.json'), JSON.stringify({ runId: '2', flows: [] })) // before deploymentId existed
        const reports = readFlowReports(dir)
        expect(reports).to.have.length(1)
        expect(gasRows(reports, 'd').map((r) => [r.operation, r.state, r.feeWei])).to.deep.equal([['mint', '', []]])
    })
})

describe('dataset selection and DS1 coverage', () => {
    const flow = (steps: object[]) => ({ flow: 'f', status: 'PASS' as const, steps })
    const s = (step: string, state: string, confirmSeconds?: number) => ({
        step,
        network: 'n',
        gasUsed: '10',
        state,
        confirmSeconds,
        checks: [],
    })

    it('reads only the runs it is told to include', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reports-'))
        for (const id of ['1', '2'])
            fs.writeFileSync(
                path.join(dir, `ops-${id}.json`),
                JSON.stringify({ runId: id, deploymentId: 'd', flows: [] })
            )
        expect(readFlowReports(dir, 'ops').map((r) => r.runId)).to.have.members(['1', '2'])
        expect(readFlowReports(dir, 'ops', new Set(['2'])).map((r) => r.runId)).to.deep.equal(['2'])
    })

    it('reports missing revision depths and counts per cell', () => {
        const reports = [
            {
                runId: '1',
                deploymentId: 'd',
                flows: [
                    flow([
                        s('revise (expectedRevision 0)', 'depth 1', 4),
                        s('revise (expectedRevision 1)', 'depth 2', 6),
                        s('mint', 'later mint, to self'),
                    ]),
                ],
            },
        ]
        const cov = ds1Coverage(gasRows(reports as never, 'd'))
        expect(cov.map((c) => c.operation)).to.deep.equal(['mint to self', 'revise (depths 1 to 10)', 'transferFrom'])
        expect(cov.find((c) => c.operation === 'revise (depths 1 to 10)')).to.include({ n: 2, depthsMissing: true })
        expect(cov.find((c) => c.operation === 'revise (depths 1 to 10)')?.detail).to.contain('3, 4')
        expect(cov.find((c) => c.operation === 'mint to self')?.n).to.equal(1)
        const rows = confirmRows(reports as never, 'd')
        expect(rows.find((r) => r.operation === 'revise')?.summary.median).to.equal(5)
        expect(rows.find((r) => r.operation === 'mint')).to.equal(undefined)
    })
})

describe('latency pooling over windows', () => {
    const clock = (seconds: number[]) => ({
        n: seconds.length,
        summary: seconds.length > 0 ? summarize(seconds) : null,
        seconds,
    })
    const dir = (direction: string, sent: number, primary: number[], poll: number[] = primary.map((s) => s + 2)) => ({
        direction,
        sent,
        delivered: primary.length,
        chain: clock(primary),
        poll: clock(poll),
    })
    const report = (runId: string, window: string | undefined, directions: ReturnType<typeof dir>[]) => ({
        runId,
        deploymentId: 'd',
        header: window == null ? undefined : { window },
        directions,
    })

    it('keeps the clocks apart, gives no interval under n = 10 and owes an extra window', () => {
        const reports = [
            report('1', '2026-10-14T13:00Z', [dir('a -> b', 4, [10, 11, 12, 13])]),
            report('2', '2026-10-14T18:00Z', [dir('a -> b', 4, [10, 11, 12, 13])]),
        ]
        const p = poolWindows(reports, 'd')
        const d = p.directions[0]
        expect(d.chain.n).to.equal(8)
        expect(d.chain.summary?.medianCi95).to.equal(null)
        expect(d.extraWindowOwed).to.equal(true)
        expect(d.shortfall).to.equal(4)
        expect(d.poll.seconds).to.deep.equal([12, 13, 14, 15, 12, 13, 14, 15])
        expect(p.check.threeWindows).to.equal(false)
        expect(renderPooledMarkdown(p)).to.contain('raw values only (n < 10)')
    })

    it('pools windows to n >= 10 with an interval, extension marked', () => {
        const four = [10, 11, 12, 13]
        const reports = [
            report('1', '2026-10-14T13:00Z', [dir('a -> b', 4, four)]),
            report('2', '2026-10-14T18:00Z', [dir('a -> b', 4, four)]),
            report('3', '2026-10-15T08:00Z', [dir('a -> b', 4, four)]),
            report('4', '2026-10-15T12:00Z', [dir('a -> b', 4, four)]),
        ]
        const p = poolWindows(reports, 'd', new Set(['4']))
        const d = p.directions[0]
        expect(d.chain.n).to.equal(16)
        expect(d.chain.summary?.medianCi95).to.not.equal(null)
        expect(d.extraWindowOwed).to.equal(false)
        expect(d.shortfall).to.equal(0)
        expect(p.check).to.deep.include({ threeWindows: true })
        expect(p.check.extensionWindows).to.deep.equal(['2026-10-15T12:00Z'])
        expect(d.windows.map((w) => w.extension)).to.deep.equal([false, false, false, true])
    })

    it('counts a failed hop as sent but not delivered, and refuses an unlabelled window', () => {
        const p = poolWindows([report('1', '2026-10-14T13:00Z', [dir('a -> b', 4, [10, 11, 12])])], 'd')
        expect(p.directions[0].sent).to.equal(4)
        expect(p.directions[0].delivered).to.equal(3)
        expect(() => poolWindows([report('2', undefined, [])], 'd')).to.throw('no window label')
    })

    it('owes the shortfall of a direction a stopped window never sent', () => {
        const stopped = report('3', '2026-10-18T19:05Z', [dir('a -> b', 1, []), dir('b -> a', 0, [])])
        const p = poolWindows([stopped], 'd')
        const back = p.directions.find((d) => d.direction === 'b -> a')
        expect(back?.sent).to.equal(0)
        expect(back?.shortfall).to.equal(12)
        expect(back?.extraWindowOwed).to.equal(true)
    })

    it('ignores reports of another deployment', () => {
        const other = { ...report('9', '2026-10-14T13:00Z', [dir('a -> b', 4, [1, 2, 3, 4])]), deploymentId: 'x' }
        expect(poolWindows([other], 'd').directions).to.have.length(0)
    })
})

describe('rule 5 in the latency reports and the send cost', () => {
    const clock = (seconds: number[]) => ({ n: seconds.length, summary: summarize(seconds), seconds })
    const four = { direction: 'a -> b', sent: 4, delivered: 4, chain: clock([1, 2, 3, 40]), poll: clock([2, 3, 4, 41]) }

    it('prints no statistic and names n, clock, run, window and label below n = 10', () => {
        const tex = renderLatencyLatex([four], { runId: '7', window: '2026-10-14T14:20Z', deploymentId: 'd' })
        expect(tex).to.contain('a -> b & 4 & 4 & 4 &  &')
        expect(tex).to.not.contain('2.5')
        expect(tex).to.contain('primary clock').and.to.contain('Run 7').and.to.contain('2026-10-14T14:20Z')
        expect(tex).to.contain('LIVE (d)').and.to.contain('tab:delivery-latency-7')
    })

    it('pools the cost of the sends of a direction with exact amounts', () => {
        const step = (gasUsed: string, feeWei: string, nativeFee: string) => ({
            step: 'send a -> b',
            network: 'base-sepolia',
            gasUsed,
            feeWei,
            nativeFee,
            checks: [],
        })
        const flows = [{ flow: 'f', status: 'PASS' as const, steps: [step('100', '5', '1000000000000000000')] }]
        const p = poolWindows(
            [
                {
                    ...{ runId: '1', deploymentId: 'd', header: { window: '2026-10-14T14:20Z' }, directions: [four] },
                    flows,
                },
            ] as never,
            'd'
        )
        expect(p.directions[0].cost.gas).to.deep.equal([100])
        const md = renderPooledMarkdown(p)
        expect(md).to.contain('| a -> b | 1 | 100 | 0.000000000000000005 native | 1.0 native |')
    })
})

describe('DS3 edge cases table', () => {
    const ok = (name: string) => ({ name, ok: true, detail: '' })
    const bad = (name: string) => ({ name, ok: false, detail: '' })
    const reverted = (
        step: string,
        network: string,
        held: boolean,
        outcome = 'expected revert OwnableUnauthorizedAccount(0x1)'
    ) => ({
        step,
        network,
        gasUsed: '200000',
        outcome,
        checks: [
            (held ? ok : bad)(`eth_call reverts with ${outcome.split(' ')[2].split('(')[0]}(...)`),
            ok('transaction mined and reverted on chain'),
        ],
    })

    it('counts a failed check as a case that did not hold, not as a missing observation', () => {
        const flows = [
            {
                flow: 'f',
                status: 'FAIL' as const,
                steps: [
                    reverted('mint (not an issuer)', 'base-sepolia', true, 'expected revert NotIssuer(0x1)'),
                    reverted('mint (not an issuer)', 'base-sepolia', false, 'expected revert NotIssuer(0x1)'),
                    reverted(
                        'revise (stale expectedRevision 3)',
                        'base-sepolia',
                        true,
                        'expected revert StaleRevision(3, 4)'
                    ),
                ],
            },
        ]
        const e = edgeCases([{ runId: '1', deploymentId: 'd', flows }], 'd', {})
        const mint = e.rejections.find((r) => r.case === 'mint by a non-issuer')
        expect(mint).to.include({ n: 2, held: 1, minedReverts: 2, expectedError: 'NotIssuer' })
        expect(e.rejections.find((r) => r.case === 'revise with a stale revision')?.expectedError).to.equal(
            'StaleRevision'
        )
    })

    it('reports the 96-byte deliveries against the enforced gas and counts rejected replays', () => {
        const send = (gas: string) => ({
            step: 'send a -> sepolia',
            network: 'a',
            cidLength: 96,
            delivered: true,
            deliverySecondsChain: 70,
            received: { txHash: '0x', blockNumber: 1, blockTimestamp: 1, gasUsed: gas },
            checks: [ok('delivered')],
        })
        const replay = {
            step: 'replay of a -> sepolia',
            network: 'sepolia',
            checks: [ok('x'), ok('transaction mined and reverted on chain')],
        }
        const flows = [{ flow: 'f', status: 'PASS' as const, steps: [send('600000'), replay, send('640000'), replay] }]
        const e = edgeCases([{ runId: '1', deploymentId: 'd', flows }], 'd', { sepolia: 1_050_000 })
        expect(e.maxCid[0]).to.deep.include({
            n: 2,
            delivered: 2,
            enforcedGas: 1_050_000,
            replays: 2,
            replaysRejected: 2,
        })
        expect(e.maxCid[0].deliveryTxGas).to.deep.equal([600000, 640000])
        expect(edgeMarkdown(e)).to.contain('600,000 to 640,000')
        // no configuration case in the run: an empty list, and the section keeps its header
        expect(e.configuration).to.deep.equal([])
        expect(edgeMarkdown(e)).to.contain('## Configuration')
    })

    it('keeps a maximum-length CID case that a stopped run never started, with n = 0', () => {
        const flows = [
            {
                flow: `${MAX_CID_FLOW} a -> b`,
                status: 'FAIL' as const,
                error: 'not started: the run stopped sending',
                steps: [],
            },
        ]
        const e = edgeCases([{ runId: '1', deploymentId: 'd', flows }], 'd', {})
        expect(e.maxCid.map((r) => [r.route, r.n, r.delivered])).to.deep.equal([['a -> b', 0, 0]])
    })

    it('reports the eth_call configuration cases per call and chain', () => {
        const who = '0x00000000000000000000000000000000000000A1'
        const c = (call: string, error: string, held: boolean) => ({
            name: `${call} by the second account: eth_call reverts with ${error}(${who})`,
            ok: held,
            detail: '',
        })
        const step = {
            step: 'configuration and receive (not the owner, not the endpoint)',
            network: 'arbitrum-sepolia',
            checks: [c('setIssuer', 'OwnableUnauthorizedAccount', true), c('lzReceive', 'OnlyEndpoint', false)],
        }
        const flows = [{ flow: 'f', status: 'FAIL' as const, steps: [step] }]
        const e = edgeCases([{ runId: '1', deploymentId: 'd', flows }], 'd', {})
        expect(e.configuration).to.deep.equal([
            { call: 'lzReceive', network: 'arbitrum-sepolia', n: 1, expectedError: 'OnlyEndpoint', held: 0 },
            {
                call: 'setIssuer',
                network: 'arbitrum-sepolia',
                n: 1,
                expectedError: 'OwnableUnauthorizedAccount',
                held: 1,
            },
        ])
        expect(e.rejections).to.have.length(0) // an eth_call case is never a mined-revert row
        expect(edgeMarkdown(e)).to.contain('| setIssuer | arbitrum-sepolia | 1 | OwnableUnauthorizedAccount | 1 of 1 |')
    })
})

describe('data index', () => {
    const makeRoot = (ids: string[]) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'index-'))
        fs.mkdirSync(path.join(root, 'e2e_reports'))
        for (const id of ids)
            fs.writeFileSync(
                path.join(root, 'e2e_reports', `ops-${id}.json`),
                JSON.stringify({
                    runId: id,
                    deploymentId: 'd',
                    header: { window: 'w', gitSha: 'abcdef1234', gitDirty: false },
                    flows: [
                        {
                            flow: 'f',
                            status: 'PASS',
                            steps: [{ step: 'mint', network: 'n', txHash: '0x1', checks: [] }],
                        },
                    ],
                })
            )
        return root
    }
    const entry = (runId: string, role: 'dataset' | 'excluded' = 'dataset') => ({
        runId,
        task: 'ops' as const,
        dataset: role === 'dataset' ? 'DS1' : 'pilot',
        role,
        note: 'n',
    })

    it('lists run id, window, commit, deployment and n from the headers', () => {
        const rows = indexRows(makeRoot(['1']), [entry('1')])
        expect(rows[0]).to.deep.include({ runId: '1', window: 'w', commit: 'abcdef1', deployment: 'd', dataset: 'DS1' })
        expect(rows[0].n).to.equal('1 of 1 flows passed, 1 transactions')
        expect(rows[0].files).to.deep.equal(['ops-1.json'])
    })

    it('counts the checks of a ui record', () => {
        const root = makeRoot([])
        fs.writeFileSync(
            path.join(root, 'e2e_reports', 'ui-5.json'),
            JSON.stringify({
                runId: '5',
                deploymentId: 'd',
                header: { window: 'ds12', gitSha: 'abcdef1234', gitDirty: false },
                flows: [
                    {
                        flow: 'mint',
                        status: 'PASS',
                        steps: [{ step: 'mint', network: 'n', txHash: '0x1', checks: [] }],
                    },
                    { flow: 'list', status: 'FAIL', steps: [] },
                ],
            })
        )
        const rows = indexRows(root, [{ ...entry('5'), task: 'ui' as const, dataset: 'DS12' }])
        expect(rows[0].n).to.equal('1 of 2 checks passed, 1 transactions')
        expect(rows[0].commit).to.equal('abcdef1')
        const raw = JSON.parse(fs.readFileSync(path.join(root, 'e2e_reports', 'ui-5.json'), 'utf8'))
        raw.header.gitDirty = null
        fs.writeFileSync(path.join(root, 'e2e_reports', 'ui-5.json'), JSON.stringify(raw))
        const unknown = indexRows(root, [{ ...entry('5'), task: 'ui' as const, dataset: 'DS12' }])
        expect(unknown[0].commit).to.equal('abcdef1 (tree state not recorded)')
        expect(rows[0].files).to.deep.equal(['ui-5.json'])
    })

    it('indexes a DS4 run by mints, sends and observed deliveries', () => {
        const root = makeRoot([])
        fs.writeFileSync(
            path.join(root, 'e2e_reports', 'scale-7.json'),
            JSON.stringify({
                runId: '7',
                deploymentId: 'whisky-v2-eval3',
                header: { window: 'ds4', gitSha: 'abcdef1234', gitDirty: false },
                flows: [],
                mints: [{}, {}, {}],
                sends: [{ delivered: true }, { delivered: false }],
            })
        )
        const rows = indexRows(root, [{ ...entry('7'), task: 'scale' as const, dataset: 'DS4' }])
        expect(rows[0].n).to.equal('3 mints, 2 sends, 1 delivered')
        expect(rows[0].files).to.deep.equal(['scale-7.json'])
    })

    it('refuses a report with no manifest entry and an entry with no report', () => {
        expect(() => indexRows(makeRoot(['1', '2']), [entry('1')])).to.throw('no entry')
        expect(() => indexRows(makeRoot(['1']), [entry('1'), entry('3', 'excluded')])).to.throw('no report')
    })
})
