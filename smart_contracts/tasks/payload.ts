import canonicalize from 'canonicalize'
import { CID } from 'multiformats/cid'
import { sha256 } from 'multiformats/hashes/sha2'

// Passport payloads of the live-flow harness: envelope, canonical bytes, CID, Pinata upload and gateway read-back,
// and the three verification results (docs/TECHNICAL-REFERENCE.md, "Payload envelope", "Canonical bytes and CID
// profile", "Verification results").
//
// The CID profile is implemented here on purpose: the harness must not import from app/. It is tested against the
// shared test vector in tasks/__tests__/cid.test.ts.
//
// Library versions are pinned without ranges in package.json because the CID depends on them. This package is
// CommonJS under Hardhat 2 on Node 18, so it uses multiformats 9.9.0 (dual CJS/ESM; 10 and later are ESM only) and
// canonicalize 2.1.0 (CJS; 3 and later are ESM only, 5 needs Node 22). For the envelope's string-only values their
// output equals multiformats 14 and canonicalize 5.1.0, which app pins.

/** Upper bound for canonical payload bytes (64 KiB). */
export const MAX_PAYLOAD_BYTES = 65_536
/** Multicodec `raw`. */
export const RAW_CODEC = 0x55
/** Multihash `sha2-256`. */
export const SHA2_256_CODE = 0x12

export const ENVELOPE_SCHEMA = 'idpp-passport/1'

export type PassportEnvelope = {
    schema: typeof ENVELOPE_SCHEMA
    deploymentId: string
    tokenId: string
    revision: string
    previousCid: string | null
    kind: 'cask' | 'bottle'
    granularity: 'item' | 'batch'
    data: Record<string, unknown>
}

/** The on-chain record a CID was read from: `passportOf(tokenId)` on a chain of `deploymentId`. */
export type OnChainRecord = { deploymentId: string; tokenId: bigint | string; revision: bigint | string | number }

export type Verdict = { status: 'verified' | 'failed' | 'skipped'; reason?: string }

export type Verification = { content: Verdict; binding: Verdict; history: Verdict }

export const verified = (): Verdict => ({ status: 'verified' })
export const failed = (reason: string): Verdict => ({ status: 'failed', reason })
export const skipped = (reason: string): Verdict => ({ status: 'skipped', reason })

export const allVerified = (v: Verification): boolean =>
    v.content.status === 'verified' && v.binding.status === 'verified' && v.history.status === 'verified'

// ---------------------------------------------------------------------------------------------------------------
// Canonical bytes and CID

/** RFC 8785 (JCS) serialization of a JSON value as UTF-8, without the size limit. */
export function canonicalBytes(value: unknown): Uint8Array {
    const text = canonicalize(value)
    if (text === undefined) throw new TypeError('value cannot be canonicalized as JSON')
    return new TextEncoder().encode(text)
}

/** Canonical bytes of an envelope: exactly what is uploaded and hashed into the CID. At most 64 KiB. */
export function canonicalizeEnvelope(envelope: PassportEnvelope): Uint8Array {
    const bytes = canonicalBytes(envelope)
    if (bytes.byteLength > MAX_PAYLOAD_BYTES) {
        throw new Error(`canonical payload is ${bytes.byteLength} bytes, limit is ${MAX_PAYLOAD_BYTES}`)
    }
    return bytes
}

/** CIDv1, codec raw, sha2-256, base32 lower (`bafkrei...`), computed over `bytes` exactly as given. */
export function computeCidV1(bytes: Uint8Array): string {
    const digest = sha256.digest(bytes)
    if (digest instanceof Promise) throw new Error('sha256 digest must be synchronous')
    return CID.create(1, RAW_CODEC, digest).toString()
}

/** True when `cid` parses and matches the IDPP profile (v1, raw, sha2-256, 32-byte digest, base32 lower). */
export function isProfileCid(cid: string): boolean {
    try {
        const parsed = CID.parse(cid)
        return (
            parsed.version === 1 &&
            parsed.code === RAW_CODEC &&
            parsed.multihash.code === SHA2_256_CODE &&
            parsed.multihash.size === 32 &&
            parsed.toString() === cid
        )
    } catch {
        return false
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Envelope

export type EnvelopeInput = {
    deploymentId: string
    tokenId: bigint | string
    revision: bigint | number | string
    previousCid: string | null
    kind?: 'cask' | 'bottle'
    granularity?: 'item' | 'batch'
    data?: Record<string, unknown>
}

/** Small cask data for the live flows; `description` tells payloads of one flow apart. All values are strings. */
export function caskData(caskNumber: string, description: string): Record<string, unknown> {
    return {
        distillery: 'Demo Distillery',
        caskType: 'Bourbon barrel',
        caskNumber,
        volumeLiters: '200',
        alcoholByVolume: '63.5',
        fillDate: '2026-10-01',
        description,
    }
}

/** Envelope `idpp-passport/1`. Token id and revision are decimal strings; there is no chain id or timestamp. */
export function buildEnvelope(input: EnvelopeInput): PassportEnvelope {
    const tokenId = String(input.tokenId)
    const revision = String(input.revision)
    if (!/^(0|[1-9][0-9]*)$/.test(tokenId)) throw new Error(`tokenId ${tokenId} is not a decimal integer`)
    if (!/^(0|[1-9][0-9]*)$/.test(revision)) throw new Error(`revision ${revision} is not a decimal integer`)
    if ((input.previousCid === null) !== (revision === '0')) {
        throw new Error('previousCid must be null at revision 0 and set for every later revision')
    }
    return {
        schema: ENVELOPE_SCHEMA,
        deploymentId: input.deploymentId,
        tokenId,
        revision,
        previousCid: input.previousCid,
        kind: input.kind ?? 'cask',
        granularity: input.granularity ?? 'item',
        data: input.data ?? caskData(tokenId, `revision ${revision}`),
    }
}

const isString = (value: unknown): value is string => typeof value === 'string'

/** Parses bytes (already content-checked) as an envelope; throws a readable error for anything else. */
export function parseEnvelope(bytes: Uint8Array): PassportEnvelope {
    let value: unknown
    try {
        value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch (error) {
        throw new Error(`payload is not UTF-8 JSON: ${(error as Error).message}`)
    }
    const o = value as Record<string, unknown> | null
    if (o == null || typeof o !== 'object' || Array.isArray(o)) throw new Error('payload is not a JSON object')
    if (o.schema !== ENVELOPE_SCHEMA) throw new Error(`schema is ${JSON.stringify(o.schema)}`)
    for (const key of ['deploymentId', 'tokenId', 'revision'] as const) {
        if (!isString(o[key])) throw new Error(`${key} must be a string`)
    }
    if (!/^(0|[1-9][0-9]*)$/.test(o.tokenId as string)) throw new Error('tokenId must be a decimal string')
    if (!/^(0|[1-9][0-9]*)$/.test(o.revision as string)) throw new Error('revision must be a decimal string')
    if (o.previousCid !== null && !isString(o.previousCid)) throw new Error('previousCid must be a string or null')
    if (o.kind !== 'cask' && o.kind !== 'bottle') throw new Error(`kind is ${JSON.stringify(o.kind)}`)
    if (o.granularity !== 'item' && o.granularity !== 'batch') {
        throw new Error(`granularity is ${JSON.stringify(o.granularity)}`)
    }
    if (o.data == null || typeof o.data !== 'object' || Array.isArray(o.data)) throw new Error('data must be an object')
    return o as unknown as PassportEnvelope
}

// ---------------------------------------------------------------------------------------------------------------
// The three verification results

/** `content`: the downloaded raw bytes hash to the requested CID. Run before parsing the bytes. */
export function verifyContent(bytes: Uint8Array, cid: string): Verdict {
    try {
        if (!isProfileCid(cid)) return failed(`requested CID ${cid} is not a CIDv1 raw sha2-256 base32 CID`)
        const actual = computeCidV1(bytes)
        return actual === cid ? verified() : failed(`content hashes to ${actual}, expected ${cid}`)
    } catch (error) {
        return failed(`content check failed: ${(error as Error).message}`)
    }
}

/** `binding`: the envelope's `deploymentId`, `tokenId` and `revision` equal the on-chain record the CID came from. */
export function verifyBinding(envelope: PassportEnvelope, record: OnChainRecord): Verdict {
    const tokenId = String(record.tokenId)
    const revision = String(record.revision)
    if (envelope.deploymentId !== record.deploymentId) {
        return failed(`deploymentId ${envelope.deploymentId} differs from ${record.deploymentId}`)
    }
    if (envelope.tokenId !== tokenId) return failed(`tokenId ${envelope.tokenId} differs from ${tokenId}`)
    if (envelope.revision !== revision) return failed(`revision ${envelope.revision} differs from ${revision}`)
    return verified()
}

export type HistoryEntry = { cid: string; envelope: PassportEnvelope }

/**
 * `history`: `entries` run from revision 0 up to the current one. Each envelope declares its position, all belong to
 * one token and deployment, and each `previousCid` equals the CID of the preceding entry (null at revision 0). When
 * `recordedCids` is given (the CIDs this flow wrote on chain, by revision), the entries must match it exactly.
 */
export function verifyHistory(entries: readonly HistoryEntry[], recordedCids?: readonly string[]): Verdict {
    if (entries.length === 0) return failed('no revisions')
    if (recordedCids != null && recordedCids.length !== entries.length) {
        return failed(`${entries.length} revisions fetched, ${recordedCids.length} written on chain`)
    }
    const first = entries[0].envelope
    for (let i = 0; i < entries.length; i++) {
        const { cid, envelope } = entries[i]
        if (envelope.revision !== String(i)) return failed(`entry ${i} declares revision ${envelope.revision}`)
        if (envelope.tokenId !== first.tokenId || envelope.deploymentId !== first.deploymentId) {
            return failed(`revision ${i} belongs to another token or deployment`)
        }
        const expectedPrevious = i === 0 ? null : entries[i - 1].cid
        if (envelope.previousCid !== expectedPrevious) {
            return failed(`revision ${i} previousCid ${envelope.previousCid}, expected ${expectedPrevious}`)
        }
        if (recordedCids != null && recordedCids[i] !== cid) {
            return failed(`revision ${i} is ${cid}, the flow wrote ${recordedCids[i]}`)
        }
    }
    return verified()
}

// ---------------------------------------------------------------------------------------------------------------
// Pinata upload and gateway read-back

export type UploadPath = 'v3' | 'legacy'

export type PinataConfig = {
    jwt: string
    /** Gateway host, for example `gateway.pinata.cloud` or `<name>.mypinata.cloud`. */
    gateway: string
    /**
     * `v3`: `POST https://uploads.pinata.cloud/v3/files` with `network=public`, `cid_version=v1`, the request the
     * `pinata` 2.5.6 SDK sends for `upload.public.file(file).cidVersion("v1")`.
     * `legacy`: `POST https://api.pinata.cloud/pinning/pinFileToIPFS` with `pinataOptions: { cidVersion: 1 }`.
     */
    uploadPath: UploadPath
}

type FetchLike = typeof fetch

export function pinataConfigFromEnv(env: NodeJS.ProcessEnv): PinataConfig {
    const jwt = env.PINATA_JWT?.trim()
    const gateway = env.PINATA_GATEWAY?.trim()
    if (!jwt || !gateway) {
        throw new Error('PINATA_JWT and PINATA_GATEWAY must be set in smart_contracts/.env (see .env.example)')
    }
    const uploadPath = (env.PINATA_UPLOAD_PATH?.trim() || 'v3') as UploadPath
    if (uploadPath !== 'v3' && uploadPath !== 'legacy') {
        throw new Error(`PINATA_UPLOAD_PATH must be v3 or legacy, got ${JSON.stringify(uploadPath)}`)
    }
    return { jwt, gateway: normalizeGateway(gateway), uploadPath }
}

/** Host only: strips a scheme, a trailing slash and a trailing `/ipfs`. */
export function normalizeGateway(gateway: string): string {
    return gateway
        .replace(/^https?:\/\//, '')
        .replace(/\/+$/, '')
        .replace(/\/ipfs$/, '')
}

function toBlob(bytes: Uint8Array): Blob {
    return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/json' })
}

async function boundedRequest<T>(timeoutMs: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        return await work(controller.signal)
    } finally {
        clearTimeout(timer)
    }
}

/** Uploads `bytes` and returns the CID Pinata reports. The caller compares it with the prediction. */
export async function uploadToPinata(
    config: PinataConfig,
    bytes: Uint8Array,
    name: string,
    fetchImpl: FetchLike = fetch,
    options: { timeoutMs?: number; retries?: number; sleep?: (ms: number) => Promise<void> } = {}
): Promise<string> {
    const form = new FormData()
    let url: string
    if (config.uploadPath === 'v3') {
        url = 'https://uploads.pinata.cloud/v3/files'
        form.append('file', toBlob(bytes), name)
        form.append('network', 'public')
        form.append('name', name)
        form.append('cid_version', 'v1')
    } else {
        url = 'https://api.pinata.cloud/pinning/pinFileToIPFS'
        form.append('file', toBlob(bytes), name)
        form.append('pinataOptions', JSON.stringify({ cidVersion: 1 }))
        form.append('pinataMetadata', JSON.stringify({ name }))
    }
    let last: unknown
    const retries = options.retries ?? 3
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await boundedRequest(options.timeoutMs ?? 60_000, async (signal) => {
                const response = await fetchImpl(url, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${config.jwt}` },
                    body: form,
                    signal,
                })
                if (!response.ok) {
                    const error = new Error(
                        `Pinata upload (${config.uploadPath}) HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`
                    ) as Error & {
                        retryable: boolean
                    }
                    error.retryable = response.status === 429 || response.status >= 500
                    throw error
                }
                const body = (await response.json()) as { data?: { cid?: string }; IpfsHash?: string }
                const cid = config.uploadPath === 'v3' ? body.data?.cid : body.IpfsHash
                if (!cid) {
                    const error = new Error('Pinata returned no CID') as Error & { retryable: boolean }
                    error.retryable = false
                    throw error
                }
                return cid
            })
        } catch (error) {
            last = error
            if ((error as { retryable?: boolean }).retryable === false || attempt === retries) throw error
            console.log(`Pinata upload retry ${attempt + 1}/${retries} after a failed or timed-out request`)
            await (options.sleep ?? defaultSleep)(1_000)
        }
    }
    throw last
}

export type FetchOptions = {
    gatewayTimeoutMs?: number
    uploadTimeoutMs?: number
    uploadRetries?: number
    attempts?: number
    delayMs?: number
    fetchImpl?: FetchLike
    sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Raw bytes behind `cid` from the gateway. Retries on any failure (a fresh pin can take a moment to appear) and
 * returns the bytes without interpreting them; the caller runs `verifyContent`.
 */
export async function fetchFromGateway(gateway: string, cid: string, options: FetchOptions = {}): Promise<Uint8Array> {
    const { attempts = 10, delayMs = 3_000, fetchImpl = fetch, sleep = defaultSleep } = options
    let lastError = 'no attempt made'
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const result = await boundedRequest(options.gatewayTimeoutMs ?? 10_000, async (signal) => {
                const response = await fetchImpl(`https://${normalizeGateway(gateway)}/ipfs/${cid}`, { signal })
                if (!response.ok)
                    throw new Error(
                        `gateway returned HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`
                    )
                return new Uint8Array(await response.arrayBuffer())
            })
            return result
        } catch (error) {
            lastError = `gateway request failed: ${(error as Error).message}`
        }
        if (attempt < attempts) await sleep(delayMs)
    }
    throw new Error(`${lastError} for ${cid} after ${attempts} attempts`)
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
    a.byteLength === b.byteLength && a.every((byte, i) => byte === b[i])

/**
 * Canonicalizes, predicts the CID, uploads, asserts the returned CID equals the prediction, fetches the bytes back
 * through the gateway and compares them byte for byte. A different CID or different bytes is a hard failure; a
 * returned CID is never adopted.
 */
export async function pinEnvelope(
    config: PinataConfig,
    envelope: PassportEnvelope,
    options: FetchOptions = {}
): Promise<{ cid: string; bytes: Uint8Array }> {
    const bytes = canonicalizeEnvelope(envelope)
    const predicted = computeCidV1(bytes)
    const name = `idpp-${envelope.tokenId}-r${envelope.revision}.json`
    const returned = await uploadToPinata(config, bytes, name, options.fetchImpl, {
        timeoutMs: options.uploadTimeoutMs,
        retries: options.uploadRetries,
        sleep: options.sleep,
    })
    if (returned !== predicted) {
        throw new Error(`Pinata (${config.uploadPath}) returned ${returned}, predicted ${predicted}`)
    }
    const fetched = await fetchFromGateway(config.gateway, predicted, options)
    if (!sameBytes(fetched, bytes)) throw new Error(`gateway bytes for ${predicted} differ from the uploaded bytes`)
    return { cid: predicted, bytes }
}

// ---------------------------------------------------------------------------------------------------------------
// Verification of an on-chain record

export type VerifyContext = {
    gateway: string
    deploymentId: string
    /** Verified bytes by CID; ancestors are served from here instead of the gateway. */
    cache: Map<string, Uint8Array>
    fetchOptions?: FetchOptions
    /** Local-only evidence such as DS4 can supply bytes without contacting a gateway. */
    fetchBytes?: (cid: string) => Promise<Uint8Array>
}

/**
 * Fetches the payload behind a record read from `passportOf` and computes the three results. The current CID is
 * always downloaded; ancestors come from the cache when an earlier verification already fetched and checked them.
 * `recordedCids` are the CIDs the flow wrote on chain for this token, by revision.
 */
export async function verifyOnChainRecord(
    ctx: VerifyContext,
    record: { tokenId: bigint | string; revision: bigint | number | string; cid: string },
    recordedCids?: readonly string[]
): Promise<Verification> {
    const revision = Number(record.revision)
    let bytes: Uint8Array
    try {
        bytes = ctx.fetchBytes
            ? await ctx.fetchBytes(record.cid)
            : await fetchFromGateway(ctx.gateway, record.cid, ctx.fetchOptions)
    } catch (error) {
        const reason = (error as Error).message
        return ctx.fetchBytes
            ? { content: failed(reason), binding: failed(reason), history: failed(reason) }
            : {
                  content: failed(reason),
                  binding: skipped('payload not fetched'),
                  history: skipped('payload not fetched'),
              }
    }
    const content = verifyContent(bytes, record.cid)
    if (content.status !== 'verified') {
        return { content, binding: skipped('content not verified'), history: skipped('content not verified') }
    }
    ctx.cache.set(record.cid, bytes)

    let current: PassportEnvelope
    try {
        current = parseEnvelope(bytes)
    } catch (error) {
        const reason = `invalid envelope: ${(error as Error).message}`
        return { content, binding: failed(reason), history: skipped('envelope not parsed') }
    }
    const binding = verifyBinding(current, { deploymentId: ctx.deploymentId, tokenId: record.tokenId, revision })
    const history = await walkHistory(ctx, { cid: record.cid, envelope: current }, revision, recordedCids)
    return { content, binding, history }
}

async function walkHistory(
    ctx: VerifyContext,
    current: HistoryEntry,
    revision: number,
    recordedCids?: readonly string[]
): Promise<Verdict> {
    const newestFirst: HistoryEntry[] = [current]
    let entry = current
    // Bounded by the on-chain revision, so a payload whose previousCid loops cannot hang the harness.
    while (entry.envelope.previousCid != null) {
        if (newestFirst.length > revision) return failed(`previousCid chain is longer than revision ${revision}`)
        const cid = entry.envelope.previousCid
        let bytes = ctx.cache.get(cid)
        if (bytes == null) {
            try {
                bytes = ctx.fetchBytes
                    ? await ctx.fetchBytes(cid)
                    : await fetchFromGateway(ctx.gateway, cid, ctx.fetchOptions)
            } catch (error) {
                return failed(`revision ${entry.envelope.revision} previousCid: ${(error as Error).message}`)
            }
            const content = verifyContent(bytes, cid)
            if (content.status !== 'verified') return failed(`previous payload ${cid}: ${content.reason}`)
            ctx.cache.set(cid, bytes)
        }
        try {
            entry = { cid, envelope: parseEnvelope(bytes) }
        } catch (error) {
            return failed(`previous payload ${cid}: ${(error as Error).message}`)
        }
        newestFirst.push(entry)
    }
    return verifyHistory(newestFirst.reverse(), recordedCids)
}
