import { createHash } from 'node:crypto'

import { expect } from 'chai'

import {
    MAX_PAYLOAD_BYTES,
    buildEnvelope,
    canonicalBytes,
    canonicalizeEnvelope,
    computeCidV1,
    isProfileCid,
    parseEnvelope,
} from '../payload'

// The shared test vector of docs/TECHNICAL-REFERENCE.md ("Canonical bytes and CID profile"). Every package that hashes
// uses it; the values below are copied from there, not computed.
const VECTOR_ENVELOPE = {
    schema: 'idpp-passport/1',
    deploymentId: 'whisky-v2-final',
    tokenId: '97000000000000',
    revision: '0',
    previousCid: null,
    kind: 'cask',
    granularity: 'item',
    data: {
        distillery: 'Demo Distillery',
        caskType: 'Bourbon barrel',
        caskNumber: '1',
        volumeLiters: '200',
        alcoholByVolume: '63.5',
        fillDate: '2026-10-01',
    },
} as const

const VECTOR_CANONICAL =
    '{"data":{"alcoholByVolume":"63.5","caskNumber":"1","caskType":"Bourbon barrel","distillery":"Demo Distillery","fillDate":"2026-10-01","volumeLiters":"200"},"deploymentId":"whisky-v2-final","granularity":"item","kind":"cask","previousCid":null,"revision":"0","schema":"idpp-passport/1","tokenId":"97000000000000"}'
const VECTOR_SHA256 = '2da18698cf972e03ca36702052154c30face10dc28b4d66110a23b90e03bc33b'
const VECTOR_CID = 'bafkreibnugdjrt4xfyb4untqebjbktbq7lhbbxbiwtlgcefchoioao6dhm'

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

describe('shared test vector', () => {
    const bytes = canonicalizeEnvelope(buildEnvelope({ ...VECTOR_ENVELOPE, data: { ...VECTOR_ENVELOPE.data } }))

    it('canonicalizes to the exact 312 bytes', () => {
        expect(text(bytes)).to.equal(VECTOR_CANONICAL)
        expect(bytes.byteLength).to.equal(312)
    })

    it('hashes to the sha2-256 digest', () => {
        expect(createHash('sha256').update(bytes).digest('hex')).to.equal(VECTOR_SHA256)
    })

    it('has the CID bafkrei... of the vector (CIDv1, raw, sha2-256, base32)', () => {
        expect(computeCidV1(bytes)).to.equal(VECTOR_CID)
        expect(VECTOR_CID.startsWith('bafkrei')).to.equal(true)
        expect(isProfileCid(VECTOR_CID)).to.equal(true)
    })

    it('gets the same bytes from the plain vector envelope as from buildEnvelope', () => {
        expect(text(canonicalBytes(VECTOR_ENVELOPE))).to.equal(VECTOR_CANONICAL)
    })

    it('parses back to the envelope', () => {
        expect(parseEnvelope(bytes)).to.deep.equal(VECTOR_ENVELOPE)
    })
})

describe('canonicalization (RFC 8785)', () => {
    it('sorts keys by UTF-16 code units and drops whitespace', () => {
        expect(text(canonicalBytes({ b: 1, a: { d: 'x', c: null }, '😀': 'e', '￿': 'f' }))).to.equal(
            '{"a":{"c":null,"d":"x"},"b":1,"😀":"e","￿":"f"}'
        )
    })

    it('encodes non-ASCII as UTF-8 and escapes control characters', () => {
        const bytes = canonicalBytes({ k: 'é\n\u0001' })
        expect(text(bytes)).to.equal('{"k":"é\\n\\u0001"}')
        expect(bytes.byteLength).to.equal('{"k":"'.length + 2 + 2 + 6 + '"}'.length)
    })

    it('is independent of the key order of the input', () => {
        const reordered = {
            schema: VECTOR_ENVELOPE.schema,
            data: VECTOR_ENVELOPE.data,
            tokenId: VECTOR_ENVELOPE.tokenId,
        }
        const other = { tokenId: VECTOR_ENVELOPE.tokenId, schema: VECTOR_ENVELOPE.schema, data: VECTOR_ENVELOPE.data }
        expect(text(canonicalBytes(reordered))).to.equal(text(canonicalBytes(other)))
    })

    it('rejects canonical bytes above 64 KiB', () => {
        const envelope = buildEnvelope({
            deploymentId: 'whisky-v2-final',
            tokenId: '1',
            revision: 0,
            previousCid: null,
            data: { description: 'x'.repeat(MAX_PAYLOAD_BYTES) },
        })
        expect(() => canonicalizeEnvelope(envelope)).to.throw(/limit is 65536/)
    })

    it('accepts canonical bytes of exactly 64 KiB', () => {
        const base = buildEnvelope({ deploymentId: 'd', tokenId: '1', revision: 0, previousCid: null, data: { f: '' } })
        const padding = MAX_PAYLOAD_BYTES - canonicalBytes(base).byteLength
        base.data = { f: 'x'.repeat(padding) }
        expect(canonicalizeEnvelope(base).byteLength).to.equal(MAX_PAYLOAD_BYTES)
    })
})

describe('CID profile', () => {
    it('changes with a single byte', () => {
        const bytes = canonicalBytes(VECTOR_ENVELOPE)
        const altered = bytes.slice()
        altered[0] ^= 1
        expect(computeCidV1(altered)).to.not.equal(VECTOR_CID)
    })

    it('rejects CIDs outside the profile', () => {
        expect(isProfileCid('QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG')).to.equal(false) // v0
        expect(isProfileCid('bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi')).to.equal(false) // dag-pb
        expect(isProfileCid(VECTOR_CID.toUpperCase())).to.equal(false)
        expect(isProfileCid('not a cid')).to.equal(false)
    })
})

describe('buildEnvelope', () => {
    it('builds the envelope of the README with decimal strings and no chain id or timestamp', () => {
        const envelope = buildEnvelope({
            deploymentId: 'whisky-v2-final',
            tokenId: 97000000000006n,
            revision: 2,
            previousCid: VECTOR_CID,
        })
        expect(envelope).to.include({
            schema: 'idpp-passport/1',
            deploymentId: 'whisky-v2-final',
            tokenId: '97000000000006',
            revision: '2',
            previousCid: VECTOR_CID,
            kind: 'cask',
            granularity: 'item',
        })
        expect(Object.keys(envelope).sort()).to.deep.equal(
            ['data', 'deploymentId', 'granularity', 'kind', 'previousCid', 'revision', 'schema', 'tokenId'].sort()
        )
        for (const value of Object.values(envelope.data)) expect(value).to.be.a('string')
    })

    it('keeps token ids above 2^53 exact', () => {
        const envelope = buildEnvelope({
            deploymentId: 'd',
            tokenId: 11155111000000000001n,
            revision: 0,
            previousCid: null,
        })
        expect(envelope.tokenId).to.equal('11155111000000000001')
    })

    it('requires previousCid to be null exactly at revision 0', () => {
        expect(() =>
            buildEnvelope({ deploymentId: 'd', tokenId: '1', revision: 0, previousCid: VECTOR_CID })
        ).to.throw()
        expect(() => buildEnvelope({ deploymentId: 'd', tokenId: '1', revision: 1, previousCid: null })).to.throw()
    })

    it('rejects non-decimal ids and revisions', () => {
        expect(() => buildEnvelope({ deploymentId: 'd', tokenId: '1e3', revision: 0, previousCid: null })).to.throw()
        expect(() =>
            buildEnvelope({ deploymentId: 'd', tokenId: '1', revision: '01', previousCid: VECTOR_CID })
        ).to.throw()
    })
})

describe('parseEnvelope', () => {
    const bytesOf = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

    it('rejects a numeric tokenId, a wrong schema and a missing deploymentId', () => {
        expect(() => parseEnvelope(bytesOf({ ...VECTOR_ENVELOPE, tokenId: 97000000000000 }))).to.throw(/tokenId/)
        expect(() => parseEnvelope(bytesOf({ ...VECTOR_ENVELOPE, schema: 'idpp-passport/2' }))).to.throw(/schema/)
        const { deploymentId: _omitted, ...rest } = VECTOR_ENVELOPE
        expect(() => parseEnvelope(bytesOf(rest))).to.throw(/deploymentId/)
    })

    it('rejects non-JSON and non-UTF-8 bytes', () => {
        expect(() => parseEnvelope(new TextEncoder().encode('{'))).to.throw(/not UTF-8 JSON/)
        expect(() => parseEnvelope(new Uint8Array([0xff, 0xfe]))).to.throw(/not UTF-8 JSON/)
    })
})
