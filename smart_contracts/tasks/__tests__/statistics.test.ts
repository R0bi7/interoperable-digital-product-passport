import { expect } from 'chai'

import { directionStats } from '../latency-report'
import { MIN_N_FOR_INTERVAL, medianBootstrapCi95, quantile, summarize, tCritical975 } from '../statistics'

describe('statistics', () => {
    it('computes mean, sample sd and quartiles of a known sample', () => {
        const s = summarize([2, 4, 4, 4, 5, 5, 7, 9])
        expect(s.n).to.equal(8)
        expect(s.mean).to.equal(5)
        expect(s.sd).to.be.closeTo(2.13809, 1e-4) // sqrt(32 / 7)
        expect(s.median).to.equal(4.5)
        expect(s.q1).to.equal(4)
        expect(s.q3).to.equal(5.5)
        expect(s.min).to.equal(2)
        expect(s.max).to.equal(9)
    })

    it('gives the t interval of the mean from n = 10', () => {
        const s = summarize([10, 12, 14, 10, 12, 14, 10, 12, 14, 12])
        // mean 12, sum of squares 24, sd sqrt(24 / 9), se sd / sqrt(10), t(9) = 2.262
        const margin = (2.262 * Math.sqrt(24 / 9)) / Math.sqrt(10)
        expect(s.meanCi95?.low).to.be.closeTo(12 - margin, 1e-9)
        expect(s.meanCi95?.high).to.be.closeTo(12 + margin, 1e-9)
        expect(s.medianCi95).to.not.equal(null)
    })

    it('prints no interval below n = 10, where raw values are the result', () => {
        for (const values of [
            [10, 12, 14],
            [1, 2, 3, 4, 5, 6, 7, 8, 9],
        ]) {
            const s = summarize(values)
            expect(s.meanCi95, `n = ${values.length}`).to.equal(null)
            expect(s.medianCi95, `n = ${values.length}`).to.equal(null)
        }
        expect(MIN_N_FOR_INTERVAL).to.equal(10)
    })

    it('counts Tukey outliers without removing them', () => {
        const s = summarize([10, 11, 11, 12, 12, 12, 13, 13, 14, 100])
        expect(s.outliers).to.equal(1)
        expect(s.n).to.equal(10)
        expect(s.max).to.equal(100)
    })

    it('handles n = 1 and n = 2 without intervals that cannot exist', () => {
        const one = summarize([5])
        expect(one.sd).to.equal(0)
        expect(one.meanCi95).to.equal(null)
        expect(one.medianCi95).to.equal(null)
        const two = summarize([5, 7])
        expect(two.sd).to.be.closeTo(Math.SQRT2, 1e-12)
        expect(two.meanCi95).to.equal(null)
        expect(two.medianCi95).to.equal(null)
    })

    it('interpolates quantiles and rejects empty samples', () => {
        expect(quantile([1, 2, 3, 4], 0.5)).to.equal(2.5)
        expect(quantile([1, 2, 3, 4], 0.95)).to.be.closeTo(3.85, 1e-9)
        expect(() => summarize([])).to.throw()
    })

    it('has a deterministic bootstrap interval that contains the median', () => {
        const values = [30, 35, 40, 45, 50, 55, 60, 65, 70, 120]
        const a = medianBootstrapCi95(values)
        const b = medianBootstrapCi95(values)
        expect(a).to.deep.equal(b)
        expect(a).to.not.equal(null)
        const median = summarize(values).median
        expect(a!.low).to.be.at.most(median)
        expect(a!.high).to.be.at.least(median)
    })

    it('looks up t critical values', () => {
        expect(tCritical975(1)).to.equal(12.706)
        expect(tCritical975(19)).to.equal(2.093)
        expect(tCritical975(500)).to.equal(1.96)
        expect(tCritical975(0)).to.be.NaN
    })
})

describe('directionStats', () => {
    const step = (step: string, deliverySeconds?: number, deliverySecondsChain?: number) => ({
        step,
        network: 'x',
        deliverySeconds,
        deliverySecondsChain,
        checks: [],
    })

    it('groups sends by direction and counts an undelivered send as sent only', () => {
        const stats = directionStats([
            {
                flow: 'f',
                status: 'FAIL',
                steps: [
                    step('mint'),
                    step('send a -> b', 40, 37),
                    step('send b -> a', 60, 55),
                    step('send a -> b', 50, 44),
                    step('send b -> a', undefined),
                ],
            },
        ])
        expect(stats.map((d) => [d.direction, d.sent, d.delivered])).to.deep.equal([
            ['a -> b', 2, 2],
            ['b -> a', 2, 1],
        ])
        expect(stats[0].poll.summary?.mean).to.equal(45)
        expect(stats[0].chain.summary?.mean).to.equal(40.5)
        expect(stats[1].poll.seconds).to.deep.equal([60])
        expect(stats[1].chain.seconds).to.deep.equal([55])
    })

    it('gives a planned direction the run never reached a row with nothing sent', () => {
        // A Scan stop on the first hop a -> b: the reverse direction was planned but never sent (DS2 stop rule).
        const stats = directionStats(
            [{ flow: 'f', status: 'FAIL', steps: [step('send a -> b', undefined)] }],
            ['a -> b', 'b -> a']
        )
        expect(stats.map((d) => [d.direction, d.sent, d.delivered, d.chain.n])).to.deep.equal([
            ['a -> b', 1, 0, 0],
            ['b -> a', 0, 0, 0],
        ])
    })

    it('counts a delivered hop that has no clock value as delivered, and only for the clocks it has', () => {
        const [a] = directionStats([
            {
                flow: 'f',
                status: 'PASS',
                steps: [
                    { step: 'send a -> b', network: 'x', delivered: true, checks: [] },
                    step('send a -> b', 40, 37),
                ],
            },
        ])
        expect([a.sent, a.delivered, a.poll.n, a.chain.n]).to.deep.equal([2, 2, 1, 1])
    })

    it('keeps the two clocks apart: a hop without a located destination event counts for the poll clock only', () => {
        const [a] = directionStats([
            { flow: 'f', status: 'PASS', steps: [step('send a -> b', 40, 37), step('send a -> b', 52, undefined)] },
        ])
        expect(a.delivered).to.equal(2)
        expect(a.poll.n).to.equal(2)
        expect(a.chain.n).to.equal(1)
    })
})
