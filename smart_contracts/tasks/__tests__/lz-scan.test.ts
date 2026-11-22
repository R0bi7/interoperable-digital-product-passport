import { expect } from 'chai'
import { providers } from 'ethers'

import {
    PlannedPathway,
    allPairs,
    blocksRun,
    describeSource,
    getLogsChunked,
    hopVerdict,
    judgePathway,
    noScanRecord,
    pathwayId,
    scanPreflight,
} from '../lz-scan'

const NOW = Date.parse('2026-10-18T19:40:00Z')
const at = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString()
const ARB = { network: 'arbitrum-sepolia', eid: 40231, address: '0x1111111111111111111111111111111111111111' }
const BASE = { network: 'base-sepolia', eid: 40245, address: '0x3C7335Cf23E20a1BAfD1d6759a6297aded65eCc1' }
const arbToBase = (outboundNonce: number): PlannedPathway => ({ from: ARB, to: BASE, outboundNonce })

describe('LayerZero Scan preflight and early stop', function () {
    it('treats only a 404 or an empty answer as no record; a rate limit or an unreachable Scan says nothing', function () {
        expect(noScanRecord('scan HTTP 404')).to.equal(true)
        expect(noScanRecord('not indexed')).to.equal(true)
        expect(noScanRecord('scan HTTP 429')).to.equal(false)
        expect(noScanRecord('scan unreachable: fetch failed')).to.equal(false)
        expect(noScanRecord('INFLIGHT')).to.equal(false)
    })

    it('stops a hop on no record after the grace period, on a known but undelivered message after the stuck limit, and on a terminal status at once', function () {
        expect(hopVerdict('scan HTTP 404', 299)).to.equal('wait')
        expect(hopVerdict('scan HTTP 404', 300)).to.equal('no record')
        expect(hopVerdict('not indexed', 900)).to.equal('no record')
        expect(hopVerdict('scan HTTP 503', 2000)).to.equal('wait')
        expect(hopVerdict('scan HTTP 503', 299, { consecutiveErrors: 3 })).to.equal('wait')
        expect(hopVerdict('scan HTTP 503', 300, { consecutiveErrors: 2 })).to.equal('wait')
        expect(hopVerdict('scan HTTP 503', 300, { consecutiveErrors: 3 })).to.equal('no record')
        expect(hopVerdict('scan unreachable: aborted', 2000)).to.equal('wait')
        expect(hopVerdict('CONFIRMING', 899)).to.equal('wait')
        expect(hopVerdict('CONFIRMING (Waiting for source confirmations)', 900)).to.equal('stuck')
        expect(hopVerdict('INFLIGHT', 900)).to.equal('stuck')
        expect(hopVerdict('DELIVERED', 2000)).to.equal('wait') // the destination RPC has not caught up yet
        expect(hopVerdict('FAILED (Executor transaction simulation reverted)', 30)).to.equal('failed')
        expect(hopVerdict('PAYLOAD_STORED', 30)).to.equal('failed')
        expect(hopVerdict('INFLIGHT', 60, { stuckSeconds: 30 })).to.equal('stuck')
    })

    it('blocks a pathway whose send the endpoint made but Scan does not have', function () {
        const v = judgePathway(arbToBase(1), [], NOW)
        expect(v.verdict).to.equal('not on scan')
        expect(v.detail).to.contain('nonce 1').and.to.contain('none')
        expect(blocksRun(v)).to.equal(true)
        // Scan behind the endpoint by one nonce is the same case.
        const behind = judgePathway(arbToBase(20), [{ nonce: 19, status: 'DELIVERED', created: at(600) }], NOW)
        expect(behind.verdict).to.equal('not on scan')
    })

    it('blocks a pathway whose newest message is stuck or failed, and passes a delivered or recent one', function () {
        const msg = (status: string, secondsAgo: number) => [{ nonce: 3, status, created: at(secondsAgo) }]
        expect(judgePathway(arbToBase(3), msg('CONFIRMING', 39 * 3600), NOW).verdict).to.equal('stuck')
        expect(judgePathway(arbToBase(3), msg('PAYLOAD_STORED', 60), NOW).verdict).to.equal('stuck')
        expect(judgePathway(arbToBase(3), msg('INFLIGHT', 120), NOW).verdict).to.equal('ok')
        // A quiet pathway is healthy: the age of a delivered message says nothing (testnets go quiet for days).
        expect(judgePathway(arbToBase(3), msg('DELIVERED', 4 * 86400), NOW).verdict).to.equal('ok')
    })

    it('decides nothing on a pathway never used or a Scan that did not answer', function () {
        expect(judgePathway(arbToBase(0), [], NOW).verdict).to.equal('unused')
        const unknown = judgePathway(arbToBase(1), 'scan HTTP 404', NOW)
        expect(unknown.verdict).to.equal('unknown')
        expect(blocksRun(unknown)).to.equal(true)
        expect(blocksRun(unknown, true)).to.equal(false)
    })

    it("asks Scan for each pathway by its id and records the source chains' traffic without judging it", async function () {
        const asked: string[] = []
        const sepolia = { network: 'sepolia', eid: 40161, address: BASE.address }
        const result = await scanPreflight(
            [arbToBase(1), { from: ARB, to: sepolia, outboundNonce: 0 }],
            {
                pathway: async (id) => {
                    asked.push(id)
                    return []
                },
                source: async () => [{ created: at(4 * 86400), status: 'DELIVERED', dstEid: 40161 }],
            },
            NOW
        )
        expect(asked[0]).to.equal(pathwayId(40231, 40245, ARB.address, BASE.address))
        expect(asked[0]).to.equal(`40231-40245-${ARB.address.toLowerCase()}-${BASE.address.toLowerCase()}`)
        expect(result.pathways.map((v) => v.verdict)).to.deep.equal(['not on scan', 'unused'])
        expect(result.sources).to.deep.equal([
            'arbitrum-sepolia: newest of any application 96.0 h ago; last 1: 1 DELIVERED',
        ])
        expect(describeSource('base-sepolia', 'scan HTTP 500', NOW)).to.contain('did not answer')
    })

    it('plans every ordered pair', function () {
        expect(allPairs(['a', 'b', 'c'])).to.deep.equal([
            { from: 'a', to: 'b' },
            { from: 'a', to: 'c' },
            { from: 'b', to: 'a' },
            { from: 'b', to: 'c' },
            { from: 'c', to: 'a' },
            { from: 'c', to: 'b' },
        ])
    })

    it('shrinks the getLogs range to 100 blocks when the RPC caps it, keeps that range, and rethrows other errors', async function () {
        const calls: [number, number][] = []
        const capped = {
            async getLogs(filter: { fromBlock: number; toBlock: number }) {
                calls.push([filter.fromBlock, filter.toBlock])
                if (filter.toBlock - filter.fromBlock + 1 > 100)
                    throw new Error(
                        'server returned an error response: error code -32602: block range too large: total block range in this request exceeds the maximum of 100 blocks'
                    )
                return filter.fromBlock <= 150 && 150 <= filter.toBlock ? [{ blockNumber: 150 }] : []
            },
        } as unknown as providers.Provider
        const seen: number[] = []
        await getLogsChunked(capped, {}, 0, 499, (logs) => {
            seen.push(...logs.map((l) => l.blockNumber))
        })
        expect(seen).to.deep.equal([150])
        expect(calls).to.deep.equal([
            [0, 499], // the whole range, which the RPC refuses
            [0, 99],
            [100, 199],
            [200, 299],
            [300, 399],
            [400, 499],
        ])
        // the same provider is not probed again, and the visitor can stop the walk
        calls.length = 0
        await getLogsChunked(capped, {}, 100, 499, (logs) => logs.length > 0)
        expect(calls).to.deep.equal([[100, 199]])

        // a range error at the floor, and any other error, are thrown
        const thrown = async (message: string) => {
            const provider = {
                getLogs: async () => {
                    throw new Error(message)
                },
            } as unknown as providers.Provider
            let error: unknown
            await getLogsChunked(provider, {}, 0, 499, () => undefined).catch((e) => (error = e))
            return String(error)
        }
        expect(await thrown('block range too large: exceeds the maximum of 50 blocks')).to.contain('50 blocks')
        expect(await thrown('rate limited')).to.contain('rate limited')
    })
})
