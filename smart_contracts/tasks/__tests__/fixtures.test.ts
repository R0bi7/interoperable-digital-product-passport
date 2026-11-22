import { expect } from 'chai'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
    CHAIN_DEPTHS,
    FIXTURE_DEPLOYMENT_ID,
    FIXTURE_TOKEN_ID,
    MAX_CID_BYTES,
    appendLedger,
    canonicalLength,
    fixtureDir,
    fixtureDrift,
    fixtureFiles,
    hostileSet,
    ledgerPath,
    maxLengthCid,
    padToBytes,
    payloadFixtures,
    revisionChain,
    writeFixtures,
} from '../fixtures'
import {
    HistoryEntry,
    MAX_PAYLOAD_BYTES,
    canonicalizeEnvelope,
    computeCidV1,
    isProfileCid,
    verifyBinding,
    verifyContent,
    verifyHistory,
} from '../payload'

const entryOf = (e: Parameters<typeof canonicalizeEnvelope>[0]): HistoryEntry => ({
    cid: computeCidV1(canonicalizeEnvelope(e)),
    envelope: e,
})

describe('fixtures', () => {
    it('has the payload shapes of the plan: casks, bottles with 1, 3 and 10 source casks, batches, exact sizes', () => {
        const byName = new Map(payloadFixtures().map((f) => [f.name, f.envelope]))
        const casks = (name: string) =>
            ((byName.get(name)?.data as { sourceCasks?: unknown[] }).sourceCasks ?? []).length
        expect([casks('bottle-1-cask'), casks('bottle-3-casks'), casks('bottle-10-casks')]).to.deep.equal([1, 3, 10])
        expect(byName.get('cask-batch')?.granularity).to.equal('batch')
        expect(byName.get('bottle-batch')?.kind).to.equal('bottle')
        expect(canonicalLength(byName.get('size-2-kib')!)).to.equal(2_048)
        expect(canonicalLength(byName.get('size-64-kib')!)).to.equal(MAX_PAYLOAD_BYTES)
        for (const { name, envelope } of payloadFixtures()) {
            expect(isProfileCid(computeCidV1(canonicalizeEnvelope(envelope))), name).to.equal(true)
        }
    })

    it('refuses to pad an envelope that is already longer than the target', () => {
        const [first] = payloadFixtures()
        expect(() => padToBytes(first.envelope, 10)).to.throw('longer than 10 bytes')
    })

    it('builds linked revision chains of depth 1, 5, 10 and 20 that verify as history', () => {
        for (const depth of CHAIN_DEPTHS) {
            const chain = revisionChain(depth)
            expect(chain).to.have.length(depth)
            expect(verifyHistory(chain.map(entryOf)).status, `depth ${depth}`).to.equal('verified')
        }
    })

    it('has a CID string of exactly the longest length the contract accepts', () => {
        expect(maxLengthCid()).to.have.length(MAX_CID_BYTES)
    })

    describe('hostile set: every case is caught by the check it targets', () => {
        const tokenId = FIXTURE_TOKEN_ID + 300n
        const cases = new Map(hostileSet(tokenId).map((h) => [h.name, h]))
        const record = (revision: number) => ({ deploymentId: FIXTURE_DEPLOYMENT_ID, tokenId, revision })

        it('a1 and a2 fail binding', () => {
            expect(verifyBinding(cases.get('a1-other-token')!.envelopes[0], record(0)).status).to.equal('failed')
            expect(verifyBinding(cases.get('a2-other-deployment')!.envelopes[0], record(0)).status).to.equal('failed')
        })

        it('b fails content when the served bytes are altered', () => {
            const e = cases.get('b-altered-bytes')!.envelopes[0]
            const bytes = canonicalizeEnvelope(e)
            expect(verifyContent(bytes, computeCidV1(bytes)).status).to.equal('verified')
            const altered = bytes.slice()
            altered[10] ^= 1
            expect(verifyContent(altered, computeCidV1(bytes)).status).to.equal('failed')
        })

        it('c fails history on the recorded chain', () => {
            const entries = cases.get('c-broken-chain')!.envelopes.map(entryOf)
            expect(verifyHistory(entries).status).to.equal('failed')
        })

        it('the decoy predecessor passes a reader that follows previousCid and fails one that compares with the chain', () => {
            const c = cases.get('decoy-predecessor')!
            const recorded = c.envelopes.map(entryOf)
            const decoy = entryOf(c.served![0])
            // the reader's view: the current payload's previousCid leads to the decoy, which is revision 0
            const followed = [decoy, recorded[1]]
            expect(recorded[1].envelope.previousCid).to.equal(decoy.cid)
            expect(verifyHistory(followed).status, 'the weakness of a reader without recorded CIDs').to.equal(
                'verified'
            )
            expect(
                verifyHistory(
                    followed,
                    recorded.map((r) => r.cid)
                ).status
            ).to.equal('failed')
        })

        it('a future revision fails binding against the revision on chain', () => {
            const e = cases.get('future-revision')!.envelopes[1]
            expect(e.revision).to.equal('5')
            expect(verifyBinding(e, record(1)).status).to.equal('failed')
        })
    })

    it('matches the committed files, byte for byte', () => {
        // A drift here means the generator changed without `npx hardhat e2e:fixtures` being run.
        expect(fixtureDrift(fixtureDir(path.resolve(__dirname, '../..')))).to.deep.equal([])
    })

    it('detects missing, changed and unexpected files', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixtures-'))
        writeFixtures(dir)
        expect(fixtureDrift(dir)).to.deep.equal([])
        fs.writeFileSync(path.join(dir, 'payloads/cask-minimal.json'), 'x')
        fs.rmSync(path.join(dir, 'sizes.json'))
        fs.writeFileSync(path.join(dir, 'payloads/stray.json'), '{}')
        expect(fixtureDrift(dir).sort()).to.deep.equal([
            'changed payloads/cask-minimal.json',
            'missing sizes.json',
            'unexpected payloads/stray.json',
        ])
    })

    it('writes canonical bytes with no trailing newline, so they hash to the CID in sizes.json', () => {
        const files = fixtureFiles()
        const sizes = JSON.parse(files.get('sizes.json') ?? '{}') as {
            payloads: { name: string; cid: string; bytes: number }[]
        }
        for (const p of sizes.payloads) {
            const content = files.get(`payloads/${p.name}.json`) ?? ''
            expect(Buffer.byteLength(content), p.name).to.equal(p.bytes)
            expect(computeCidV1(new Uint8Array(Buffer.from(content))), p.name).to.equal(p.cid)
        }
    })
})

describe('fixture ledger', () => {
    it('refuses to append to a ledger with another column layout', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-old-'))
        fs.mkdirSync(path.dirname(ledgerPath(root)), { recursive: true })
        fs.writeFileSync(
            ledgerPath(root),
            '# Fixture ledger\n\n| Token id | Network | Purpose | Run id |\n| --- | --- | --- | --- |\n'
        )
        expect(() =>
            appendLedger(root, [{ tokenId: '1', network: 'n', deploymentId: 'd', purpose: 'p', runId: '1' }])
        ).to.throw('another column layout')
    })

    it('is created with a header, appends rows, and does not repeat a token on a network', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'))
        const row = { tokenId: '421614000000000001', network: 'arbitrum-sepolia', deploymentId: 'gen-1' }
        appendLedger(root, [{ ...row, purpose: 'ops | mint', runId: '1' }])
        appendLedger(root, [
            { ...row, purpose: 'again', runId: '2' },
            { ...row, network: 'base-sepolia', purpose: 'same id elsewhere', runId: '2' },
            { ...row, deploymentId: 'gen-2', purpose: 'same id after a redeploy', runId: '3' },
        ])
        const text = fs.readFileSync(ledgerPath(root), 'utf8')
        expect(text).to.contain('# Fixture ledger')
        expect(text).to.contain('| 421614000000000001 | arbitrum-sepolia | gen-1 | ops \\| mint | 1 |')
        expect(text).to.not.contain('again')
        expect(text).to.contain('| 421614000000000001 | base-sepolia | gen-1 | same id elsewhere | 2 |')
        expect(text).to.contain('| 421614000000000001 | arbitrum-sepolia | gen-2 | same id after a redeploy | 3 |')
    })
})
