import { expect } from 'chai'

import {
    FetchOptions,
    PassportEnvelope,
    PinataConfig,
    VerifyContext,
    allVerified,
    buildEnvelope,
    canonicalizeEnvelope,
    computeCidV1,
    fetchFromGateway,
    normalizeGateway,
    pinEnvelope,
    pinataConfigFromEnv,
    uploadToPinata,
    verifyBinding,
    verifyContent,
    verifyHistory,
    verifyOnChainRecord,
} from '../payload'

const DEPLOYMENT = 'whisky-v2-final'
const TOKEN = '97000000000007'

type Chain = { envelope: PassportEnvelope; bytes: Uint8Array; cid: string }

// A well-formed revision chain 0..n-1 of one token.
function makeChain(length: number, tokenId = TOKEN): Chain[] {
    const chain: Chain[] = []
    for (let revision = 0; revision < length; revision++) {
        const envelope = buildEnvelope({
            deploymentId: DEPLOYMENT,
            tokenId,
            revision,
            previousCid: revision === 0 ? null : chain[revision - 1].cid,
        })
        const bytes = canonicalizeEnvelope(envelope)
        chain.push({ envelope, bytes, cid: computeCidV1(bytes) })
    }
    return chain
}

// fetch double that serves a gateway from a map and counts requests.
function gatewayOf(store: Map<string, Uint8Array>): { fetchImpl: typeof fetch; requests: string[] } {
    const requests: string[] = []
    const fetchImpl = (async (input: unknown) => {
        const url = String(input)
        requests.push(url)
        const cid = url.split('/ipfs/')[1]
        const bytes = store.get(cid)
        return bytes == null
            ? new Response('not found', { status: 404 })
            : new Response(bytes as Uint8Array<ArrayBuffer>)
    }) as typeof fetch
    return { fetchImpl, requests }
}

const noSleep = async () => undefined
const optionsFor = (fetchImpl: typeof fetch, attempts = 2): FetchOptions => ({ fetchImpl, attempts, sleep: noSleep })

const contextFor = (store: Map<string, Uint8Array>, cache = new Map<string, Uint8Array>()) => {
    const { fetchImpl, requests } = gatewayOf(store)
    const ctx: VerifyContext = {
        gateway: 'gateway.example',
        deploymentId: DEPLOYMENT,
        cache,
        fetchOptions: optionsFor(fetchImpl),
    }
    return { ctx, requests }
}

describe('verifyContent', () => {
    const [r0] = makeChain(1)

    it('verifies bytes that hash to the CID', () => {
        expect(verifyContent(r0.bytes, r0.cid)).to.deep.equal({ status: 'verified' })
    })

    it('fails altered bytes, naming the CID they hash to', () => {
        const altered = r0.bytes.slice()
        altered[5] ^= 1
        const verdict = verifyContent(altered, r0.cid)
        expect(verdict.status).to.equal('failed')
        expect(verdict.reason).to.include(computeCidV1(altered))
    })

    it('fails a CID outside the profile', () => {
        expect(verifyContent(r0.bytes, 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG').status).to.equal('failed')
    })
})

describe('verifyBinding', () => {
    const [r0] = makeChain(1)
    const record = { deploymentId: DEPLOYMENT, tokenId: TOKEN, revision: 0 }

    it('verifies deploymentId, tokenId and revision equal to the on-chain record', () => {
        expect(verifyBinding(r0.envelope, record).status).to.equal('verified')
        expect(verifyBinding(r0.envelope, { ...record, tokenId: BigInt(TOKEN), revision: 0n }).status).to.equal(
            'verified'
        )
    })

    it('fails a valid payload that carries another tokenId, revision or deployment', () => {
        expect(verifyBinding(r0.envelope, { ...record, tokenId: '97000000000008' }).reason).to.match(/tokenId/)
        expect(verifyBinding(r0.envelope, { ...record, revision: 1 }).reason).to.match(/revision/)
        expect(verifyBinding(r0.envelope, { ...record, deploymentId: 'whisky-v2-provisional' }).reason).to.match(
            /deploymentId/
        )
    })
})

describe('verifyHistory', () => {
    const chain = makeChain(3)
    const entries = chain.map(({ cid, envelope }) => ({ cid, envelope }))

    it('verifies an unbroken previousCid chain back to revision 0', () => {
        expect(
            verifyHistory(
                entries,
                chain.map((c) => c.cid)
            ).status
        ).to.equal('verified')
        expect(verifyHistory(entries).status).to.equal('verified')
    })

    it('fails a broken previousCid', () => {
        const broken = [
            entries[0],
            { ...entries[1], envelope: { ...entries[1].envelope, previousCid: entries[2].cid } },
            entries[2],
        ]
        const verdict = verifyHistory(broken)
        expect(verdict.status).to.equal('failed')
        expect(verdict.reason).to.match(/revision 1 previousCid/)
    })

    it('fails a revision 0 with a previousCid', () => {
        const bad = [{ ...entries[0], envelope: { ...entries[0].envelope, previousCid: entries[1].cid } }]
        expect(verifyHistory(bad).status).to.equal('failed')
    })

    it('fails when the chain differs from the CIDs written on chain', () => {
        const recorded = [chain[0].cid, chain[2].cid, chain[1].cid]
        expect(verifyHistory(entries, recorded).status).to.equal('failed')
        expect(verifyHistory(entries, [chain[0].cid]).reason).to.match(/written on chain/)
    })

    it('fails revisions of another token mixed into the chain', () => {
        const other = makeChain(3, '97000000000008')
        const mixed = [entries[0], { cid: other[1].cid, envelope: other[1].envelope }]
        expect(verifyHistory(mixed).status).to.equal('failed')
    })

    it('fails an empty history', () => {
        expect(verifyHistory([]).status).to.equal('failed')
    })
})

describe('verifyOnChainRecord (mocked gateway)', () => {
    const chain = makeChain(3)
    const store = () => new Map(chain.map((c) => [c.cid, c.bytes]))
    const record = (i: number) => ({ tokenId: TOKEN, revision: i, cid: chain[i].cid })

    it('returns verified for content, binding and history of the newest revision', async () => {
        const { ctx } = contextFor(store())
        const v = await verifyOnChainRecord(
            ctx,
            record(2),
            chain.map((c) => c.cid)
        )
        expect(v).to.deep.equal({
            content: { status: 'verified' },
            binding: { status: 'verified' },
            history: { status: 'verified' },
        })
        expect(allVerified(v)).to.equal(true)
    })

    it('always downloads the current CID but serves verified ancestors from the cache', async () => {
        const { ctx, requests } = contextFor(store())
        await verifyOnChainRecord(ctx, record(2))
        expect(requests).to.have.length(3)
        requests.length = 0
        await verifyOnChainRecord(ctx, record(2))
        expect(requests).to.deep.equal([`https://gateway.example/ipfs/${chain[2].cid}`])
    })

    it('fails content for corrupt gateway bytes and skips binding and history', async () => {
        const corrupt = store()
        const bad = chain[2].bytes.slice()
        bad[10] ^= 1
        corrupt.set(chain[2].cid, bad)
        const { ctx } = contextFor(corrupt)
        const v = await verifyOnChainRecord(ctx, record(2))
        expect(v.content.status).to.equal('failed')
        expect(v.binding.status).to.equal('skipped')
        expect(v.history.status).to.equal('skipped')
        expect(allVerified(v)).to.equal(false)
    })

    it('fails content when the gateway does not serve the CID', async () => {
        const missing = store()
        missing.delete(chain[2].cid)
        const { ctx } = contextFor(missing)
        const v = await verifyOnChainRecord(ctx, record(2))
        expect(v.content.status).to.equal('failed')
        expect(v.content.reason).to.match(/HTTP 404/)
    })

    it('fails binding, not content, when the CID is genuine but belongs to another token', async () => {
        const foreign = makeChain(1, '97000000000099')[0]
        const s = store()
        s.set(foreign.cid, foreign.bytes)
        const { ctx } = contextFor(s)
        const v = await verifyOnChainRecord(ctx, { tokenId: TOKEN, revision: 0, cid: foreign.cid })
        expect(v.content.status).to.equal('verified')
        expect(v.binding.status).to.equal('failed')
        expect(v.binding.reason).to.match(/tokenId/)
    })

    it('fails binding when the on-chain revision differs from the payload', async () => {
        const { ctx } = contextFor(store())
        const v = await verifyOnChainRecord(ctx, { tokenId: TOKEN, revision: 1, cid: chain[2].cid })
        expect(v.content.status).to.equal('verified')
        expect(v.binding.status).to.equal('failed')
    })

    it('fails history when an ancestor is missing, with content and binding verified', async () => {
        const s = store()
        s.delete(chain[0].cid)
        const { ctx } = contextFor(s)
        const v = await verifyOnChainRecord(ctx, record(2))
        expect(v.content.status).to.equal('verified')
        expect(v.binding.status).to.equal('verified')
        expect(v.history.status).to.equal('failed')
    })

    it('fails history when an ancestor is not what its CID says', async () => {
        const s = store()
        const bad = chain[1].bytes.slice()
        bad[3] ^= 1
        s.set(chain[1].cid, bad)
        const { ctx } = contextFor(s)
        const v = await verifyOnChainRecord(ctx, record(2))
        expect(v.history.status).to.equal('failed')
        expect(v.history.reason).to.include(chain[1].cid)
    })

    it('fails history when the flow wrote other CIDs on chain', async () => {
        const { ctx } = contextFor(store())
        const v = await verifyOnChainRecord(ctx, record(2), [chain[0].cid, chain[0].cid, chain[2].cid])
        expect(v.history.status).to.equal('failed')
    })

    it('bounds the previousCid walk by the on-chain revision', async () => {
        const [r0] = makeChain(1)
        const loopEnvelope = { ...r0.envelope, revision: '1', previousCid: r0.cid }
        const loopBytes = canonicalizeEnvelope(loopEnvelope)
        const loopCid = computeCidV1(loopBytes)
        const s = new Map([
            [loopCid, loopBytes],
            [r0.cid, r0.bytes],
        ])
        const { ctx } = contextFor(s)
        const v = await verifyOnChainRecord(ctx, { tokenId: TOKEN, revision: 1, cid: loopCid })
        expect(v.history.status).to.equal('verified')
        const tooShort = await verifyOnChainRecord(ctx, { tokenId: TOKEN, revision: 0, cid: loopCid })
        expect(tooShort.binding.status).to.equal('failed')
        expect(tooShort.history.status).to.equal('failed')
    })
})

describe('Pinata', () => {
    const [r0] = makeChain(1)
    const config = (uploadPath: PinataConfig['uploadPath']): PinataConfig => ({
        jwt: 'jwt',
        gateway: 'gateway.example',
        uploadPath,
    })

    it('reads PINATA_JWT, PINATA_GATEWAY and PINATA_UPLOAD_PATH from the environment', () => {
        expect(pinataConfigFromEnv({ PINATA_JWT: 'j', PINATA_GATEWAY: 'https://x.mypinata.cloud/' })).to.deep.equal({
            jwt: 'j',
            gateway: 'x.mypinata.cloud',
            uploadPath: 'v3',
        })
        expect(
            pinataConfigFromEnv({ PINATA_JWT: 'j', PINATA_GATEWAY: 'g', PINATA_UPLOAD_PATH: 'legacy' }).uploadPath
        ).to.equal('legacy')
        expect(() => pinataConfigFromEnv({ PINATA_GATEWAY: 'g' })).to.throw(/PINATA_JWT/)
        expect(() => pinataConfigFromEnv({ PINATA_JWT: 'j' })).to.throw(/PINATA_GATEWAY/)
        expect(() => pinataConfigFromEnv({ PINATA_JWT: 'j', PINATA_GATEWAY: 'g', PINATA_UPLOAD_PATH: 'sdk' })).to.throw(
            /v3 or legacy/
        )
    })

    it('normalizes gateway hosts', () => {
        expect(normalizeGateway('https://gw.example/ipfs/')).to.equal('gw.example')
        expect(normalizeGateway('gw.example')).to.equal('gw.example')
    })

    it('sends the v3 request of the SDK (public network, cid_version v1) and reads data.cid', async () => {
        let seen: { url: string; init: RequestInit } | undefined
        const fetchImpl = (async (url: string, init: RequestInit) => {
            seen = { url, init }
            return new Response(JSON.stringify({ data: { cid: r0.cid } }))
        }) as unknown as typeof fetch
        expect(await uploadToPinata(config('v3'), r0.bytes, 'n.json', fetchImpl)).to.equal(r0.cid)
        expect(seen?.url).to.equal('https://uploads.pinata.cloud/v3/files')
        expect((seen?.init.headers as Record<string, string>).Authorization).to.equal('Bearer jwt')
        const form = seen?.init.body as FormData
        expect(form.get('network')).to.equal('public')
        expect(form.get('cid_version')).to.equal('v1')
        const file = form.get('file') as Blob
        expect(new Uint8Array(await file.arrayBuffer())).to.deep.equal(r0.bytes)
    })

    it('sends the legacy pinFileToIPFS request with cidVersion 1 and reads IpfsHash', async () => {
        let seen: { url: string; init: RequestInit } | undefined
        const fetchImpl = (async (url: string, init: RequestInit) => {
            seen = { url, init }
            return new Response(JSON.stringify({ IpfsHash: r0.cid }))
        }) as unknown as typeof fetch
        expect(await uploadToPinata(config('legacy'), r0.bytes, 'n.json', fetchImpl)).to.equal(r0.cid)
        expect(seen?.url).to.equal('https://api.pinata.cloud/pinning/pinFileToIPFS')
        expect(JSON.parse((seen?.init.body as FormData).get('pinataOptions') as string)).to.deep.equal({
            cidVersion: 1,
        })
    })

    it('reports HTTP errors of the upload', async () => {
        const fetchImpl = (async () => new Response('denied', { status: 401 })) as unknown as typeof fetch
        let message = ''
        try {
            await uploadToPinata(config('v3'), r0.bytes, 'n.json', fetchImpl)
        } catch (error) {
            message = (error as Error).message
        }
        expect(message).to.match(/HTTP 401: denied/)
    })

    it('pins, asserts the returned CID and compares the gateway bytes', async () => {
        const store = new Map<string, Uint8Array>()
        const fetchImpl = (async (input: unknown, init?: RequestInit) => {
            const url = String(input)
            if (url.startsWith('https://uploads.pinata.cloud')) {
                const file = (init?.body as FormData).get('file') as Blob
                const bytes = new Uint8Array(await file.arrayBuffer())
                const cid = computeCidV1(bytes)
                store.set(cid, bytes)
                return new Response(JSON.stringify({ data: { cid } }))
            }
            const bytes = store.get(url.split('/ipfs/')[1])
            return bytes == null ? new Response('', { status: 404 }) : new Response(bytes as Uint8Array<ArrayBuffer>)
        }) as unknown as typeof fetch
        const pinned = await pinEnvelope(config('v3'), r0.envelope, optionsFor(fetchImpl))
        expect(pinned.cid).to.equal(r0.cid)
        expect(pinned.bytes).to.deep.equal(r0.bytes)
    })

    it('fails hard when Pinata returns another CID than predicted and never adopts it', async () => {
        const other = makeChain(2)[1].cid
        const fetchImpl = (async () =>
            new Response(JSON.stringify({ data: { cid: other } }))) as unknown as typeof fetch
        let message = ''
        try {
            await pinEnvelope(config('v3'), r0.envelope, optionsFor(fetchImpl))
        } catch (error) {
            message = (error as Error).message
        }
        expect(message).to.include(`returned ${other}, predicted ${r0.cid}`)
    })

    it('fails hard when the gateway serves different bytes than were uploaded', async () => {
        const fetchImpl = (async (input: unknown) => {
            if (String(input).startsWith('https://uploads.pinata.cloud')) {
                return new Response(JSON.stringify({ data: { cid: r0.cid } }))
            }
            return new Response(new TextEncoder().encode('{"tampered":true}'))
        }) as unknown as typeof fetch
        let message = ''
        try {
            await pinEnvelope(config('v3'), r0.envelope, optionsFor(fetchImpl))
        } catch (error) {
            message = (error as Error).message
        }
        expect(message).to.match(/differ from the uploaded bytes/)
    })

    it('retries the gateway and then gives up with the last error', async () => {
        let calls = 0
        const fetchImpl = (async () => {
            calls++
            return new Response('', { status: 404 })
        }) as unknown as typeof fetch
        let message = ''
        try {
            await fetchFromGateway('gw.example', r0.cid, optionsFor(fetchImpl, 3))
        } catch (error) {
            message = (error as Error).message
        }
        expect(calls).to.equal(3)
        expect(message).to.match(/HTTP 404.*after 3 attempts/)
    })
})

describe('bounded Pinata and gateway calls', () => {
    const config: PinataConfig = { jwt: 'test', gateway: 'gw.example', uploadPath: 'v3' }
    it('retries transient upload errors at most three times', async () => {
        let requests = 0
        const fake = (async () =>
            ++requests < 4
                ? new Response('', { status: 503 })
                : new Response(JSON.stringify({ data: { cid: 'cid' } }))) as typeof fetch
        expect(await uploadToPinata(config, new Uint8Array(), 'test.json', fake, { sleep: async () => {} })).to.equal(
            'cid'
        )
        expect(requests).to.equal(4)
    })
    it('aborts a stalled upload body and retries without extending the request deadline', async () => {
        let requests = 0
        const fake = (async (_input, init) => {
            requests++
            if (requests > 1) return new Response(JSON.stringify({ data: { cid: 'cid' } }))
            return {
                ok: true,
                json: () =>
                    new Promise((_resolve, reject) =>
                        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
                    ),
            } as Response
        }) as typeof fetch
        expect(
            await uploadToPinata(config, new Uint8Array(), 'test.json', fake, { timeoutMs: 5, sleep: async () => {} })
        ).to.equal('cid')
        expect(requests).to.equal(2)
    })
    it('bounds gateway response bodies as well as headers', async () => {
        let requests = 0
        const fake = (async (_input, init) => {
            requests++
            return {
                ok: true,
                arrayBuffer: () =>
                    new Promise((_resolve, reject) =>
                        init?.signal?.addEventListener('abort', () => reject(new Error('aborted body')))
                    ),
            } as Response
        }) as typeof fetch
        let message = ''
        try {
            await fetchFromGateway('gw.example', 'cid', {
                fetchImpl: fake,
                attempts: 2,
                gatewayTimeoutMs: 5,
                sleep: async () => {},
            })
        } catch (e) {
            message = (e as Error).message
        }
        expect(requests).to.equal(2)
        expect(message).to.contain('after 2 attempts')
    })
})
