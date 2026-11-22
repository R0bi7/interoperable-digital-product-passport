import { expect } from 'chai'
import { BigNumber } from 'ethers'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
    batchFigures,
    compareScale,
    DS4_REFERENCE,
    ledgerNotesForReport,
    renderScaleMarkdown,
    scaleStats,
    renderScaleTex,
    ScaleReport,
    ScaleStep,
    writeScaleReport,
} from '../scale-report'
import { localCid, localVerifyContext } from '../scale-cid'
import { verifyBinding, verifyContent, verifyHistory, parseEnvelope, verifyOnChainRecord } from '../payload'
import { assertNonceState, limitConcurrency, scaleError } from '../scale-utils'
import type { Ctx } from '../flows'

const good = (step: 'mint' | 'send', gas: string, time?: number): ScaleStep => ({
    step,
    network: 'base-sepolia',
    minedStatus: 1,
    gasUsed: gas,
    ...(step === 'send'
        ? {
              nativeFee: DS4_REFERENCE.nativeFee.paidWei,
              delivered: true,
              deliverySecondsChain: time,
          }
        : {}),
    verification: {
        content: { status: 'verified' },
        binding: { status: 'verified' },
        history: { status: 'verified' },
    },
    checks: [{ name: 'history hash', ok: true, detail: '' }],
})

describe('DS4 comparison and batch figures', () => {
    it('uses the predeclared inward-rounded limits and counts a miss without dropping it', () => {
        const mints = [good('mint', '148081'), good('mint', '163667')]
        const sends = [good('send', '222805', 26), good('send', '246257', 52)]
        const batch = { distinctBlocks: 1, maxInOneBlock: 2, lastDeliverySecondsChain: 52 }
        const pass = compareScale(mints, sends, 2, 2, batch)
        expect(
            Object.values(pass)
                .filter((v) => typeof v === 'object')
                .every((v) => v.met)
        ).to.equal(true)
        const miss = compareScale(
            mints,
            [
                { ...sends[0], gasUsed: '222804' },
                { ...sends[1], deliverySecondsChain: 53 },
            ],
            2,
            2,
            {
                ...batch,
                lastDeliverySecondsChain: 53,
            }
        )
        expect(miss.sendGas).to.include({ met: false, count: 1 })
        expect(miss.delivery).to.include({ met: false, count: 2 })
        expect(miss.insideDs2DeliveryRange).to.equal(1)
    })

    it('passes delivery with a 24 s hop and 45 s batch while reporting the individual count', () => {
        const sends = [good('send', '234531', 24), good('send', '234531', 45)]
        const result = compareScale([good('mint', '155874'), good('mint', '155874')], sends, 2, 2, {
            distinctBlocks: 1,
            maxInOneBlock: 2,
            lastDeliverySecondsChain: 45,
        })
        expect(result.delivery.met).to.equal(true)
        expect(result.insideDs2DeliveryRange).to.equal(1)
    })

    it('keeps a stopped hop failed when ownerOf sees the token later', () => {
        const stopped = {
            ...good('send', '234531', 35),
            hopStop: 'failed',
            delivered: true,
            lateObservation: { observedAtMs: 1000, method: 'ownerOf' as const, owner: '0xabc' },
            received: undefined,
            deliverySecondsChain: undefined,
        }
        const delivered = good('send', '234531', 45)
        const batch = batchFigures([stopped, delivered], true)
        expect(batch.lastDeliverySecondsChain).to.equal(undefined)
        const result = compareScale([good('mint', '155874'), good('mint', '155874')], [stopped, delivered], 2, 2, {
            ...batch,
            lastDeliverySecondsChain: 45,
        })
        expect(result.delivery).to.include({ met: false, count: 1 })
        expect(scaleStats([stopped], 'deliverySecondsChain')).to.equal(null)
    })

    it('marks every unchecked broadcast mint in an immediate checkpoint', () => {
        const pending = [1, 2].map((id) => ({
            ...good('mint', '155874'),
            tokenId: String(id),
            nonce: id,
            minedStatus: undefined,
            checks: [{ name: 'signed', ok: true, detail: '' }],
        }))
        const notes = ledgerNotesForReport(pending, new Set(['1']), new Map())
        expect(notes.map((note) => note.tokenId)).to.deep.equal(['1', '2'])
        expect(notes.every((note) => note.state === 'unresolved' && note.errorCode === 'NOT_CHECKED')).to.equal(true)
        expect(notes[0].note).to.include('ledger row filed from first receipt')
    })

    it('uses the exact DS1 Base block-difference median for the sequential comparison', () => {
        const report = JSON.parse(
            fs.readFileSync(path.join(__dirname, '../../e2e_reports/ops-1792442510606.json'), 'utf8')
        )
        const seconds = report.flows.flatMap((flow: { steps: ScaleStep[] }) =>
            flow.steps
                .filter(
                    (step) => step.network === 'base-sepolia' && step.step.includes('mint') && step.blockSeconds != null
                )
                .map((step) => step.blockSeconds)
        )
        seconds.sort((a: number, b: number) => a - b)
        expect(seconds).to.have.length(10)
        expect((seconds[4] + seconds[5]) / 2).to.equal(DS4_REFERENCE.mintGas.blockDifferenceMedianSeconds)
    })

    it('takes batch time from the earliest submission and latest receipt and counts shared blocks', () => {
        const steps: ScaleStep[] = [
            {
                ...good('mint', '155874'),
                submittedAtMs: 1000,
                includedAtMs: 3000,
                blockNumber: 20,
                blockTimestamp: 100,
            },
            {
                ...good('mint', '155874'),
                submittedAtMs: 1500,
                includedAtMs: 4000,
                blockNumber: 20,
                blockTimestamp: 100,
            },
            {
                ...good('mint', '155874'),
                submittedAtMs: 2000,
                includedAtMs: 5000,
                blockNumber: 22,
                blockTimestamp: 104,
            },
        ]
        expect(batchFigures(steps)).to.deep.equal({
            submittedToLastReceiptSeconds: 4,
            firstToLastBlockSeconds: 4,
            distinctBlocks: 2,
            maxInOneBlock: 2,
            blocksSpanned: 3,
        })
    })

    it('builds a 59-character local CID and verifies its bytes and binding without a gateway', () => {
        const ctx = { runId: 'ds4-test', deploymentId: 'whisky-v2-eval3', verify: { cache: new Map() } } as Ctx
        const item = localCid(ctx, BigNumber.from('84532000000000001'))
        const envelope = parseEnvelope(item.bytes)
        expect(item.cid).to.have.length(59)
        expect(ctx.verify.cache.get(item.cid)).to.deep.equal(item.bytes)
        expect(verifyContent(item.bytes, item.cid).status).to.equal('verified')
        expect(
            verifyBinding(envelope, { deploymentId: ctx.deploymentId, tokenId: item.tokenId.toString(), revision: 0 })
                .status
        ).to.equal('verified')
        expect(verifyHistory([{ cid: item.cid, envelope }], [item.cid]).status).to.equal('verified')
    })

    it('verifies local bytes through the record verifier and fails closed on a cache miss', async () => {
        const ctx = {
            runId: 'ds4-test',
            deploymentId: 'whisky-v2-eval3',
            verify: { deploymentId: 'whisky-v2-eval3', cache: new Map() },
        } as Ctx
        const item = localCid(ctx, BigNumber.from('84532000000000001'))
        const record = { tokenId: item.tokenId.toString(), revision: 0, cid: item.cid }
        const verified = await verifyOnChainRecord(localVerifyContext(ctx), record, [item.cid])
        expect(Object.values(verified).every((value) => value.status === 'verified')).to.equal(true)
        ctx.verify.cache.delete(item.cid)
        const missed = await verifyOnChainRecord(localVerifyContext(ctx), record, [item.cid])
        expect(Object.values(missed).every((value) => value.status === 'failed')).to.equal(true)
    })

    it('rejects an existing nonce gap and retains only safe task errors', () => {
        expect(() => assertNonceState({ latest: 10, pending: 11 })).to.throw('latest 10, pending 11')
        expect(() => assertNonceState({ latest: 10, pending: 10 })).not.to.throw()
        expect(scaleError(new Error('Base balance below twice the quoted DS4 batch cost'))).to.include('Base balance')
        expect(scaleError(Object.assign(new Error('secret RPC URL'), { code: 'SERVER_ERROR' }))).to.equal(
            'SERVER_ERROR'
        )
    })

    it('bounds metadata work at four concurrent reads', async () => {
        const limit = limitConcurrency(4)
        let active = 0
        let maximum = 0
        await Promise.all(
            Array.from({ length: 20 }, () =>
                limit(async () => {
                    maximum = Math.max(maximum, ++active)
                    await new Promise((resolve) => setTimeout(resolve, 1))
                    active--
                })
            )
        )
        expect(maximum).to.equal(4)
    })

    it('regenerates the comparison table from the raw report', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ds4-report-'))
        try {
            const mints = [good('mint', '155874')]
            const sends = [
                {
                    ...good('send', '234531', 35),
                    tokenId: '1',
                    delivered: false,
                    hopStop: 'failed',
                    lateObservation: { observedAtMs: 1000, method: 'ownerOf' as const, owner: '0xabc' },
                },
            ]
            const batches = {
                mints: batchFigures(mints),
                sends: { ...batchFigures(sends, true), lastDeliverySecondsChain: 35 },
            }
            const report: ScaleReport = {
                runId: '1',
                deploymentId: 'whisky-v2-eval3',
                params: { mints: 1, sends: 1 },
                flows: [],
                mints,
                sends,
                batches,
                comparison: compareScale(mints, sends, 1, 1, batches.sends),
                ledgerNotes: [
                    {
                        tokenId: '1',
                        nonce: 7,
                        state: 'unresolved',
                        errorCode: 'SERVER_ERROR',
                        note: 'manual chain check required',
                    },
                ],
            }
            writeScaleReport(root, report)
            const raw = JSON.parse(
                fs.readFileSync(path.join(root, 'e2e_reports', 'scale-1.json'), 'utf8')
            ) as ScaleReport
            expect(fs.readFileSync(path.join(root, 'e2e_reports', 'scale-1.tex'), 'utf8')).to.equal(renderScaleTex(raw))
            expect(raw.ledgerNotes?.[0]).to.include({ tokenId: '1', errorCode: 'SERVER_ERROR' })
            expect(renderScaleMarkdown(raw)).to.include('Late destination observations after a final hop stop')
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })
})
