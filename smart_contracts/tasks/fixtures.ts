import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { PassportEnvelope, buildEnvelope, canonicalizeEnvelope, computeCidV1, MAX_PAYLOAD_BYTES } from './payload'

// Fixture set of docs/evaluation/PROTOCOL.md, section 4: the payloads the datasets write, the hostile set
// of the tamper cases, a 96-byte CID string, and the ledger of token ids that live runs create. Built from code, written
// to smart_contracts/fixtures/, and checked for drift by `hardhat e2e:fixtures --check` and a unit test. The files hold
// the canonical bytes exactly as they are hashed, with no trailing newline, so Foundry reads them with
// `vm.readFileBinary` and the app tests can copy them with a drift check (no subproject imports another).

/** Deployment id written into the committed fixtures. Live runs use the id of the manifest instead. */
export const FIXTURE_DEPLOYMENT_ID = 'whisky-v2-eval3'
/** First token id of the fixtures: an Arbitrum Sepolia id, kept as bigint (above the safe integer range). */
export const FIXTURE_TOKEN_ID = 421_614_000_000_000_000n

export const MAX_CID_BYTES = 96

export type Fixture = { readonly name: string; readonly envelope: PassportEnvelope }

const caskNumber = (tokenId: bigint) => `C-${tokenId % 1_000_000_000_000n}`

const minimalCask = (): Record<string, unknown> => ({
    distillery: 'Demo Distillery',
    caskType: 'Bourbon barrel',
    caskNumber: 'C-0',
    volumeLiters: '200',
    alcoholByVolume: '63.5',
    fillDate: '2026-10-01',
})

const fullCask = (tokenId: bigint): Record<string, unknown> => ({
    ...minimalCask(),
    caskNumber: caskNumber(tokenId),
    origin: { country: 'Scotland', region: 'Speyside' },
    description:
        'Single cask of new-make spirit filled into a first-fill bourbon barrel after a three-year ex-sherry finish. ' +
        'Stored in a dunnage warehouse; samples are drawn every six months and logged against this passport.',
})

const sourceCask = (tokenId: bigint, index: number) => ({
    tokenId: String(tokenId + BigInt(index)),
    revision: '0',
    volumeMl: String(1_000 + 250 * index),
})

const bottle = (casks: number, tokenId: bigint): Record<string, unknown> => ({
    brand: 'Demo Distillery',
    bottleType: 'Single malt',
    bottledDate: '2026-10-12',
    volumeMl: '700',
    alcoholByVolume: '46',
    sourceCasks: Array.from({ length: casks }, (_, i) => sourceCask(tokenId, i)),
})

const envelope = (
    tokenId: bigint,
    kind: 'cask' | 'bottle',
    granularity: 'item' | 'batch',
    data: Record<string, unknown>,
    revision = 0,
    previousCid: string | null = null
) => buildEnvelope({ deploymentId: FIXTURE_DEPLOYMENT_ID, tokenId, revision, previousCid, kind, granularity, data })

export const canonicalLength = (e: PassportEnvelope) => canonicalizeEnvelope(e).byteLength

/** Grows `description` with ASCII filler until the canonical envelope is exactly `target` bytes long. */
export function padToBytes(base: PassportEnvelope, target: number): PassportEnvelope {
    const data = base.data as Record<string, unknown>
    const without = { ...base, data: { ...data, description: '' } } as PassportEnvelope
    const room = target - canonicalLength(without)
    if (room < 0) throw new Error(`the envelope is already longer than ${target} bytes`)
    return { ...base, data: { ...data, description: 'x'.repeat(room) } } as PassportEnvelope
}

/** The single-revision payloads: cask and bottle shapes, a batch, and the size cases of DS5. */
export function payloadFixtures(): Fixture[] {
    const id = FIXTURE_TOKEN_ID
    const bottleId = id + 100n
    const sized = (target: number) => padToBytes(envelope(id, 'cask', 'item', minimalCask()), target)
    return [
        { name: 'cask-minimal', envelope: envelope(id, 'cask', 'item', minimalCask()) },
        { name: 'cask-full', envelope: envelope(id, 'cask', 'item', fullCask(id)) },
        {
            name: 'cask-batch',
            envelope: envelope(id, 'cask', 'batch', { ...fullCask(id), quantity: '12', unit: 'casks' }),
        },
        { name: 'bottle-1-cask', envelope: envelope(bottleId, 'bottle', 'item', bottle(1, id)) },
        { name: 'bottle-3-casks', envelope: envelope(bottleId, 'bottle', 'item', bottle(3, id)) },
        { name: 'bottle-10-casks', envelope: envelope(bottleId, 'bottle', 'item', bottle(10, id)) },
        {
            name: 'bottle-batch',
            envelope: envelope(bottleId, 'bottle', 'batch', { ...bottle(3, id), quantity: '240', unit: 'bottles' }),
        },
        { name: 'size-2-kib', envelope: sized(2_048) },
        { name: 'size-64-kib', envelope: sized(MAX_PAYLOAD_BYTES) },
    ]
}

/** A chain of `depth` linked revisions (revision 0 to depth - 1) of one cask; each payload names the CID before it. */
export function revisionChain(depth: number, tokenId: bigint = FIXTURE_TOKEN_ID + 200n): PassportEnvelope[] {
    const chain: PassportEnvelope[] = []
    let previousCid: string | null = null
    for (let revision = 0; revision < depth; revision++) {
        const e = envelope(
            tokenId,
            'cask',
            'item',
            { ...minimalCask(), caskNumber: caskNumber(tokenId), description: `revision ${revision}` },
            revision,
            previousCid
        )
        chain.push(e)
        previousCid = computeCidV1(canonicalizeEnvelope(e))
    }
    return chain
}

export const CHAIN_DEPTHS = [1, 5, 10, 20] as const

/**
 * A string that is not a CID but is as long as the contract accepts (96 bytes, `MAX_CID_BYTES`): the DS3 case that
 * shows the receive gas against the longest legal value. It starts like a CIDv1 so that it looks like one in a log.
 */
export const maxLengthCid = (): string => `bafkrei${'a'.repeat(MAX_CID_BYTES - 'bafkrei'.length)}`

export type HostileCase = {
    readonly name: string
    /** What the reader must report. */
    readonly expected: string
    /** The revisions as recorded on chain, in order: the CID of each is what `mint` and `revise` write. */
    readonly envelopes: PassportEnvelope[]
    /** Envelopes that are pinned too and that a reader reaches only by following a `previousCid` (the decoy). */
    readonly served?: PassportEnvelope[]
}

/**
 * The hostile set of the tamper cases (docs/evaluation/PROTOCOL.md, section 4 and DS10). `tokenId` is the
 * token the case is written for.
 */
export function hostileSet(tokenId: bigint = FIXTURE_TOKEN_ID + 300n): HostileCase[] {
    const honest = revisionChain(2, tokenId)
    const cid0 = computeCidV1(canonicalizeEnvelope(honest[0]))
    const base = { ...minimalCask(), caskNumber: caskNumber(tokenId) }
    const make = (
        id: bigint,
        deploymentId: string,
        revision: number,
        previousCid: string | null,
        description: string
    ) =>
        buildEnvelope({
            deploymentId,
            tokenId: id,
            revision,
            previousCid,
            kind: 'cask',
            granularity: 'item',
            data: { ...base, description },
        })
    const decoy = make(tokenId, FIXTURE_DEPLOYMENT_ID, 0, null, 'decoy predecessor that was never recorded on chain')
    const decoyCid = computeCidV1(canonicalizeEnvelope(decoy))
    return [
        {
            name: 'a1-other-token',
            expected: 'binding failed: the envelope names another token id',
            envelopes: [make(tokenId + 999n, FIXTURE_DEPLOYMENT_ID, 0, null, 'claims another token')],
        },
        {
            name: 'a2-other-deployment',
            expected: 'binding failed: the envelope names another deployment id',
            envelopes: [make(tokenId, 'another-deployment', 0, null, 'claims another deployment')],
        },
        {
            name: 'b-altered-bytes',
            expected: 'content failed: a gateway serves bytes that do not hash to the CID',
            envelopes: [honest[0]],
        },
        {
            name: 'c-broken-chain',
            expected: 'history failed: revision 1 names a previousCid that is not the CID of revision 0',
            envelopes: [
                honest[0],
                make(
                    tokenId,
                    FIXTURE_DEPLOYMENT_ID,
                    1,
                    'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy',
                    'wrong link'
                ),
            ],
        },
        {
            name: 'decoy-predecessor',
            expected:
                'history consistent but the predecessor was never recorded on chain: the reader must compare with the recorded CIDs',
            envelopes: [honest[0], make(tokenId, FIXTURE_DEPLOYMENT_ID, 1, decoyCid, 'links to the decoy')],
            served: [decoy],
        },
        {
            name: 'future-revision',
            expected: 'binding failed or unconfirmed: the envelope is above the revision on chain',
            envelopes: [honest[0], make(tokenId, FIXTURE_DEPLOYMENT_ID, 5, cid0, 'a revision that does not exist yet')],
        },
    ]
}

// Files -----------------------------------------------------------------------------------------------------------

const entry = (e: PassportEnvelope) => {
    const bytes = canonicalizeEnvelope(e)
    return { cid: computeCidV1(bytes), canonical: Buffer.from(bytes).toString('utf8') }
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const text = (bytes: Uint8Array) => Buffer.from(bytes).toString('utf8')

export type FixtureSizes = {
    readonly deploymentId: string
    readonly maxCidBytes: number
    readonly maxLengthCid: string
    readonly payloads: readonly {
        name: string
        kind: string
        granularity: string
        bytes: number
        cid: string
        sha256: string
    }[]
    readonly chains: readonly { depth: number; bytesPerRevision: number[]; totalBytes: number; cids: string[] }[]
}

/** Every file of the fixture directory, relative to it, with its exact content. */
export function fixtureFiles(): Map<string, string> {
    const files = new Map<string, string>()
    const payloads: FixtureSizes['payloads'][number][] = []
    for (const { name, envelope: e } of payloadFixtures()) {
        const bytes = canonicalizeEnvelope(e)
        files.set(`payloads/${name}.json`, text(bytes))
        payloads.push({
            name,
            kind: e.kind,
            granularity: e.granularity,
            bytes: bytes.byteLength,
            cid: computeCidV1(bytes),
            sha256: sha256(bytes),
        })
    }

    // The depth-20 chain holds the shorter ones as prefixes, so only its revisions are written.
    const longest = revisionChain(Math.max(...CHAIN_DEPTHS))
    longest.forEach((e, revision) => {
        files.set(`chain/r${String(revision).padStart(2, '0')}.json`, text(canonicalizeEnvelope(e)))
    })
    const chains = CHAIN_DEPTHS.map((depth) => {
        const prefix = longest.slice(0, depth).map(canonicalizeEnvelope)
        const bytesPerRevision = prefix.map((b) => b.byteLength)
        return {
            depth,
            bytesPerRevision,
            totalBytes: bytesPerRevision.reduce((a, b) => a + b, 0),
            cids: prefix.map(computeCidV1),
        }
    })

    const sizes: FixtureSizes = {
        deploymentId: FIXTURE_DEPLOYMENT_ID,
        maxCidBytes: MAX_CID_BYTES,
        maxLengthCid: maxLengthCid(),
        payloads,
        chains,
    }
    files.set('sizes.json', JSON.stringify(sizes, null, 2) + '\n')

    const hostile = hostileSet().map((h) => ({
        name: h.name,
        expected: h.expected,
        revisions: h.envelopes.map(entry),
        served: (h.served ?? []).map(entry),
    }))
    files.set('hostile.json', JSON.stringify({ deploymentId: FIXTURE_DEPLOYMENT_ID, cases: hostile }, null, 2) + '\n')
    return files
}

export const fixtureDir = (root: string) => path.join(root, 'fixtures')

/** Paths whose content differs from the generated fixtures: missing, changed or unexpected files. */
export function fixtureDrift(dir: string): string[] {
    const expected = fixtureFiles()
    const drift: string[] = []
    for (const [file, content] of expected) {
        const full = path.join(dir, file)
        if (!fs.existsSync(full)) drift.push(`missing ${file}`)
        else if (fs.readFileSync(full, 'utf8') !== content) drift.push(`changed ${file}`)
    }
    const listed = (sub: string) =>
        fs.existsSync(path.join(dir, sub)) ? fs.readdirSync(path.join(dir, sub)).map((f) => `${sub}/${f}`) : []
    for (const file of [...listed('payloads'), ...listed('chain')]) {
        if (!expected.has(file)) drift.push(`unexpected ${file}`)
    }
    return drift
}

export function writeFixtures(dir: string): string[] {
    const written: string[] = []
    for (const sub of ['payloads', 'chain']) fs.rmSync(path.join(dir, sub), { recursive: true, force: true })
    for (const [file, content] of fixtureFiles()) {
        const full = path.join(dir, file)
        fs.mkdirSync(path.dirname(full), { recursive: true })
        fs.writeFileSync(full, content)
        written.push(file)
    }
    return written
}

// Ledger ----------------------------------------------------------------------------------------------------------

export type LedgerRow = {
    readonly tokenId: string
    readonly network: string
    /** Ids restart with every deployment, so the id of the deployment is part of what makes a row unique. */
    readonly deploymentId: string
    readonly purpose: string
    readonly runId: string
}

const LEDGER_COLUMNS = '| Token id | Network | Deployment | Purpose | Run id |'

const LEDGER_HEADER = [
    '# Fixture ledger',
    '',
    'Token ids that live runs created on the current deployment generation, with the purpose and the run. Every id here is test data and is never counted as a real passport. Rows are appended by the tasks (`appendLedger`); do not edit them by hand.',
    '',
    LEDGER_COLUMNS,
    '| --- | --- | --- | --- | --- |',
    '',
].join('\n')

export const ledgerPath = (root: string) => path.join(fixtureDir(root), 'ledger.md')

/** Appends rows to the ledger, creating it with its header on first use. A row with the same token id, network and deployment is not repeated. */
export function appendLedger(root: string, rows: readonly LedgerRow[]): void {
    const file = ledgerPath(root)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    if (!fs.existsSync(file)) fs.writeFileSync(file, LEDGER_HEADER)
    const existing = fs.readFileSync(file, 'utf8')
    // A ledger of another schema would get misaligned rows; the operator moves it aside on purpose.
    if (!existing.includes(LEDGER_COLUMNS))
        throw new Error(
            `${file} has another column layout than ${LEDGER_COLUMNS}; move it aside and start a new ledger`
        )
    const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/\n/g, ' ')
    const fresh = rows.filter((r) => !existing.includes(`| ${r.tokenId} | ${r.network} | ${r.deploymentId} |`))
    if (fresh.length === 0) return
    const body = existing.endsWith('\n') ? existing : `${existing}\n`
    fs.writeFileSync(
        file,
        body +
            fresh
                .map(
                    (r) => `| ${r.tokenId} | ${r.network} | ${cell(r.deploymentId)} | ${cell(r.purpose)} | ${r.runId} |`
                )
                .join('\n') +
            '\n'
    )
}
