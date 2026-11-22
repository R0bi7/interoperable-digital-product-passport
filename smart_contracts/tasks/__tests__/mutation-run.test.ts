import { expect } from 'chai'

import { classify, onlyArgument, selectMutants } from '../mutation-run'

const run = (tests: Record<string, string>) =>
    JSON.stringify({
        'test/foundry/A.t.sol:ATest': {
            test_results: Object.fromEntries(
                Object.entries(tests).map(([t, status]) => [
                    t,
                    { status, reason: status === 'Failure' ? 'boom' : null },
                ])
            ),
        },
    })

describe('mutation run classification', () => {
    it('kills only when a test failed, and names the failing tests', () => {
        const v = classify(run({ test_a: 'Success', test_b: 'Failure' }), 1)
        expect(v.kind).to.equal('killed')
        if (v.kind === 'killed') expect(v.failed.map((f) => f.test)).to.deep.equal(['ATest.test_b'])
    })

    it('survives when every test passes or is skipped', () => {
        expect(classify(run({ test_a: 'Success', test_b: 'Skipped' }), 0).kind).to.equal('survived')
    })

    it('never turns a crash, a timeout, empty or unreadable output, or a silent non-zero exit into a kill', () => {
        expect(classify('', null)).to.deep.include({ kind: 'error' })
        expect(classify('not json', 1).kind).to.equal('error')
        expect(classify('{}', 1).kind).to.equal('error')
        expect(classify(run({ test_a: 'Success' }), 2).kind).to.equal('error')
    })
})

describe('--only', () => {
    it('is absent, given as a value, or given without one', () => {
        expect(onlyArgument(['--write'])).to.equal(undefined)
        expect(onlyArgument(['--only', 'M01,M02'])).to.equal('M01,M02')
        expect(onlyArgument(['--only=M05'])).to.equal('M05')
        // a flag without a value must not fall back to running every mutant
        expect(onlyArgument(['--only'])).to.equal('')
        expect(onlyArgument(['--only', '--write'])).to.equal('')
        expect(() => selectMutants([{ id: 'M01' }], onlyArgument(['--only']))).to.throw('needs a comma-separated list')
    })
})

describe('mutant selection', () => {
    const all = [{ id: 'M01' }, { id: 'M02' }, { id: 'M03' }]
    it('takes all, or the named ones in the order of the list', () => {
        expect(selectMutants(all, undefined)).to.have.length(3)
        expect(selectMutants(all, 'M03, M01').map((m) => m.id)).to.deep.equal(['M01', 'M03'])
    })
    it('rejects an empty or unknown selection instead of testing nothing', () => {
        expect(() => selectMutants(all, '')).to.throw('needs a comma-separated list')
        expect(() => selectMutants(all, 'M01,M99')).to.throw('unknown mutant ids: M99')
    })
})
