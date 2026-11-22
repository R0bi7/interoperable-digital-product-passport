// DS10 tamper fixtures on whisky-v2-eval3 (docs/evaluation/PROTOCOL.md DS10). Ordinary `mint` / `revise`
// calls with the issuer key of the harness; no configuration, wiring or ownership call. Every token minted here is a
// TAMPER FIXTURE and must never be used as a real passport. One repetition per chain (Arbitrum Sepolia, Base Sepolia,
// Sepolia), so each case has n = 3 on three tokens and three chains.
//
//   a1  binding failed (token):      the envelope pinned under the on-chain CID claims tokenId X+999
//   a2  binding failed (deployment): the envelope pinned under the on-chain CID carries another deploymentId
//   c   revision 1 whose previousCid names a decoy revision 0 (pinned, never put on chain) instead of revision 0
//       The decoy case reuses these tokens: the indexer stand-in lists the decoy as revision 0 (INJECTED).
//   b   no fixture: existing DS1 tokens are read through a gateway that serves altered bytes (INJECTED)
//   future  pins a valid revision M+1 envelope for an existing token; the stand-in lists it above the live tip
//
// Run from smart_contracts/ (reuses tasks/payload.ts):
//   npx ts-node --transpile-only --project tsconfig.json ../docs/acceptance/automation/eval3/ds10-chain.cts a1 a2 c future
// Env (smart_contracts/.env, git-ignored; values are never printed): PRIVATE_KEY or MNEMONIC, PINATA_JWT, PINATA_GATEWAY.
// Output: $ACCEPTANCE_OUT/ds10-fixtures.json (default ./out next to this file).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createPublicClient, createWalletClient, http, type Hex } from 'viem'
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts'
import { arbitrumSepolia, baseSepolia, sepolia } from 'viem/chains'
import {
    buildEnvelope,
    caskData,
    canonicalizeEnvelope,
    computeCidV1,
    pinEnvelope,
    pinataConfigFromEnv,
    verifyOnChainRecord,
    type PassportEnvelope,
} from '../../../../smart_contracts/tasks/payload'

const ROOT = resolve(__dirname, '../../../..')
for (const line of readFileSync(`${ROOT}/smart_contracts/.env`, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '')
}
const OUT = resolve(process.env.ACCEPTANCE_OUT ?? `${__dirname}/out`)
mkdirSync(OUT, { recursive: true })
const FILE = `${OUT}/ds10-fixtures.json`

const manifest = JSON.parse(readFileSync(`${ROOT}/smart_contracts/deployments/manifest.json`, 'utf8')) as {
    deploymentId: string
    chains: { network: string; chainId: number; address: Hex }[]
}
if (manifest.deploymentId !== 'whisky-v2-eval3') throw new Error(`manifest names ${manifest.deploymentId}, not eval3`)
const abi = JSON.parse(readFileSync(`${ROOT}/app/packages/passport-config/src/generated/abi.json`, 'utf8'))
const account = process.env.MNEMONIC
    ? mnemonicToAccount(process.env.MNEMONIC)
    : privateKeyToAccount((process.env.PRIVATE_KEY!.startsWith('0x') ? process.env.PRIVATE_KEY : `0x${process.env.PRIVATE_KEY}`) as Hex)
const VIEM = { 421614: arbitrumSepolia, 84532: baseSepolia, 11155111: sepolia } as const
const RPC: Record<number, string> = {
    421614: process.env.RPC_URL_ARBITRUM_SEPOLIA || 'https://sepolia-rollup.arbitrum.io/rpc',
    84532: process.env.RPC_URL_BASE_SEPOLIA || 'https://sepolia.base.org',
    11155111: process.env.RPC_URL_SEPOLIA || 'https://ethereum-sepolia-rpc.publicnode.com',
}
const pinata = pinataConfigFromEnv(process.env)

function chainCtx(chainId: number) {
    const c = manifest.chains.find((x) => x.chainId === chainId)!
    const chain = VIEM[chainId as keyof typeof VIEM]
    return {
        ...c,
        pub: createPublicClient({ chain, transport: http(RPC[chainId]) }),
        wallet: createWalletClient({ account, chain, transport: http(RPC[chainId]) }),
    }
}
type Ctx = ReturnType<typeof chainCtx>
// Set by main for the running case: records the fixture as soon as its transactions are mined, before any read.
let onMined: (partial: Record<string, unknown>) => void = () => {}

const state: Record<string, any> = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {}
const save = () => writeFileSync(FILE, JSON.stringify(state, null, 2))
const label = (tag: string, text: string) => `TAMPER FIXTURE ${tag}: ${text}. Not a real passport.`

async function nextTokenId(ctx: Ctx): Promise<bigint> {
    return (await ctx.pub.readContract({ address: ctx.address, abi, functionName: 'nextTokenId' })) as bigint
}

async function write(ctx: Ctx, functionName: 'mint' | 'revise', args: unknown[]) {
    const hash = await ctx.wallet.writeContract({ address: ctx.address, abi, functionName, args } as never)
    const receipt = await ctx.pub.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error(`${functionName} ${hash} reverted`)
    return { hash, block: receipt.blockNumber.toString() }
}

// Public RPCs are load-balanced; a node can lag the receipt for a few seconds, so reads retry.
async function readRetry<T>(ctx: Ctx, functionName: string, args: unknown[], until?: (v: T) => boolean): Promise<T> {
    let last: unknown
    for (let attempt = 0; attempt < 10; attempt++) {
        try {
            const v = (await ctx.pub.readContract({ address: ctx.address, abi, functionName, args } as never)) as T
            if (!until || until(v)) return v
            last = new Error(`${functionName} not yet at the expected state`)
        } catch (error) {
            last = error
        }
        await new Promise((r) => setTimeout(r, 3_000))
    }
    throw last
}

async function harnessVerify(ctx: Ctx, tokenId: bigint, recordedCids: string[]) {
    const record = await readRetry<{ revision: bigint; cid: string }>(ctx, 'passportOf', [tokenId], (v) =>
        recordedCids.includes(v.cid) && v.cid === recordedCids.at(-1)
    )
    const v = await verifyOnChainRecord(
        { gateway: pinata.gateway, deploymentId: manifest.deploymentId, cache: new Map(), fetchOptions: { attempts: 3, delayMs: 2_000 } },
        { tokenId, revision: record.revision, cid: record.cid },
        recordedCids
    )
    return { onChainRevision: record.revision.toString(), onChainCid: record.cid, content: v.content, binding: v.binding, history: v.history }
}

async function caseA1(ctx: Ctx) {
    const x = await nextTokenId(ctx)
    const foreign = x + 999n
    const envelope = buildEnvelope({
        deploymentId: manifest.deploymentId,
        tokenId: foreign,
        revision: 0,
        previousCid: null,
        data: caskData(foreign.toString(), label('a1', `envelope claims tokenId ${foreign}, minted as ${x}`)),
    })
    const { cid } = await pinEnvelope(pinata, envelope)
    const tx = await write(ctx, 'mint', [account.address, x, cid])
    const out: any = { chainId: ctx.chainId, tokenId: x.toString(), claimedTokenId: foreign.toString(), cid, mintTx: tx.hash, block: tx.block }
    onMined(out)
    out.harness = await harnessVerify(ctx, x, [cid])
    return out
}

// Rebuilds the a1 record of a token minted by an earlier invocation from the chain, the gateway and the receipt.
async function adoptA1(ctx: Ctx, tokenId: bigint) {
    const record = await readRetry<{ revision: bigint; cid: string }>(ctx, 'passportOf', [tokenId])
    const bytes = new Uint8Array(await (await fetch(`https://${pinata.gateway.replace(/^https?:\/\//, '')}/ipfs/${record.cid}`)).arrayBuffer())
    const envelope = JSON.parse(new TextDecoder().decode(bytes))
    // The mint transaction is named by the caller (ADOPT_TX_a1_<chainId>, e.g. from the indexer) and checked here.
    const hash = process.env[`ADOPT_TX_a1_${ctx.chainId}`] as Hex
    const receipt = await ctx.pub.getTransactionReceipt({ hash })
    const issued = receipt.logs.some(
        (l) => l.address.toLowerCase() === ctx.address.toLowerCase() && l.topics.some((t) => t && BigInt(t) === tokenId)
    )
    if (receipt.status !== 'success' || !issued) throw new Error(`${hash} is not the successful mint of ${tokenId}`)
    const log = { transactionHash: hash, blockNumber: receipt.blockNumber }
    if (BigInt(envelope.tokenId) === tokenId) throw new Error(`token ${tokenId} is not an a1 fixture`)
    const out: any = { chainId: ctx.chainId, tokenId: tokenId.toString(), claimedTokenId: envelope.tokenId, cid: record.cid, mintTx: log.transactionHash, block: log.blockNumber.toString(), adopted: true }
    out.harness = await harnessVerify(ctx, tokenId, [record.cid])
    return out
}

async function caseA2(ctx: Ctx) {
    const y = await nextTokenId(ctx)
    const otherDeployment = 'whisky-v2-tamper-fixture-other'
    const envelope = buildEnvelope({
        deploymentId: otherDeployment,
        tokenId: y,
        revision: 0,
        previousCid: null,
        data: caskData(y.toString(), label('a2', `envelope carries deploymentId ${otherDeployment}`)),
    })
    const { cid } = await pinEnvelope(pinata, envelope)
    const tx = await write(ctx, 'mint', [account.address, y, cid])
    const out: any = { chainId: ctx.chainId, tokenId: y.toString(), claimedDeploymentId: otherDeployment, cid, mintTx: tx.hash, block: tx.block }
    onMined(out)
    out.harness = await harnessVerify(ctx, y, [cid])
    return out
}

async function caseC(ctx: Ctx) {
    // RESUME_c_<chainId>=<tokenId> continues a token whose mint succeeded in an earlier invocation: the envelopes are
    // deterministic, so their CIDs are recomputed, checked against the gateway and the chain, and nothing is re-pinned.
    const resume = process.env[`RESUME_c_${ctx.chainId}`]
    const w = resume ? BigInt(resume) : await nextTokenId(ctx)
    const rev0: PassportEnvelope = buildEnvelope({
        deploymentId: manifest.deploymentId,
        tokenId: w,
        revision: 0,
        previousCid: null,
        data: caskData(w.toString(), label('c', 'revision 0, valid')),
    })
    const decoy: PassportEnvelope = buildEnvelope({
        deploymentId: manifest.deploymentId,
        tokenId: w,
        revision: 0,
        previousCid: null,
        data: caskData(w.toString(), label('c', 'decoy revision 0, never put on chain')),
    })
    const pinOrCheck = async (envelope: PassportEnvelope) => {
        if (!resume) return pinEnvelope(pinata, envelope)
        const bytes = canonicalizeEnvelope(envelope)
        const cid = computeCidV1(bytes)
        const served = await fetch(`https://${pinata.gateway.replace(/^https?:\/\//, '')}/ipfs/${cid}`)
        if (!served.ok) throw new Error(`resume: ${cid} is not served by the gateway`)
        return { cid, bytes }
    }
    const pinned0 = await pinOrCheck(rev0)
    const pinnedDecoy = await pinOrCheck(decoy)
    if (pinned0.cid === pinnedDecoy.cid) throw new Error('decoy CID equals revision 0 CID')
    const rev1 = buildEnvelope({
        deploymentId: manifest.deploymentId,
        tokenId: w,
        revision: 1,
        previousCid: pinnedDecoy.cid,
        data: caskData(w.toString(), label('c', 'revision 1, previousCid points at the decoy instead of revision 0')),
    })
    const pinned1 = await pinOrCheck(rev1)
    let t0: { hash: Hex | null; block: string | null }
    if (resume) {
        const record = await readRetry<{ revision: bigint; cid: string }>(ctx, 'passportOf', [w])
        if (record.revision !== 0n || record.cid !== pinned0.cid) throw new Error(`resume: token ${w} is not at the expected revision 0`)
        t0 = { hash: (process.env[`RESUME_TX_c_${ctx.chainId}`] as Hex) ?? null, block: null }
    } else {
        t0 = await write(ctx, 'mint', [account.address, w, pinned0.cid])
    }
    // The revise is simulated first; wait until the node the RPC routes to sees the mint.
    await readRetry<{ revision: bigint; cid: string }>(ctx, 'passportOf', [w], (v) => v.cid === pinned0.cid)
    const t1 = await write(ctx, 'revise', [w, 0n, pinned1.cid])
    const check = JSON.parse(new TextDecoder().decode(canonicalizeEnvelope(rev1)))
    const out: any = {
        chainId: ctx.chainId,
        tokenId: w.toString(),
        rev0Cid: pinned0.cid,
        decoyCid: pinnedDecoy.cid,
        rev1Cid: pinned1.cid,
        rev1PreviousCid: check.previousCid,
        mintTx: t0.hash,
        mintBlock: t0.block,
        reviseTx: t1.hash,
        reviseBlock: t1.block,
        ...(resume ? { resumed: true } : {}),
    }
    onMined(out)
    out.harness = await harnessVerify(ctx, w, [pinned0.cid, pinned1.cid])
    return out
}

// Future revision: an existing eval3 token keeps its on-chain record; only a valid revision M+1 envelope is pinned,
// which the stand-in lists above the live tip. The subject is the newest held DS1 token on the chain, chosen by the
// UI script from the indexer; here the caller passes it as FUTURE_<chainId>=<tokenId>.
async function caseFuture(ctx: Ctx) {
    const id = process.env[`FUTURE_${ctx.chainId}`]
    if (!id) throw new Error(`FUTURE_${ctx.chainId} (subject token id) not set`)
    const tokenId = BigInt(id)
    const record = (await ctx.pub.readContract({ address: ctx.address, abi, functionName: 'passportOf', args: [tokenId] })) as {
        revision: bigint
        cid: string
    }
    const owner = (await ctx.pub.readContract({ address: ctx.address, abi, functionName: 'ownerOf', args: [tokenId] })) as string
    const next = record.revision + 1n
    const envelope = buildEnvelope({
        deploymentId: manifest.deploymentId,
        tokenId,
        revision: next,
        previousCid: record.cid,
        data: caskData(tokenId.toString(), label('future', `revision ${next} that was never put on chain`)),
    })
    const { cid } = await pinEnvelope(pinata, envelope)
    return { chainId: ctx.chainId, tokenId: tokenId.toString(), owner, liveRevision: record.revision.toString(), liveCid: record.cid, futureRevision: next.toString(), futureCid: cid }
}

async function main() {
    const wanted = process.argv.slice(2)
    const cases: Record<string, (ctx: Ctx) => Promise<any>> = { a1: caseA1, a2: caseA2, c: caseC, future: caseFuture }
    const chains = [421614, 84532, 11155111].map(chainCtx)
    state.header ??= { createdAt: new Date().toISOString(), deploymentId: manifest.deploymentId, account: account.address }
    for (const name of wanted) {
        if (!cases[name]) throw new Error(`unknown case ${name}`)
        state[name] ??= []
        for (const ctx of chains) {
            const adopt = process.env[`ADOPT_${name}_${ctx.chainId}`]
            if (adopt && name === 'a1' && !state[name].some((r: any) => r.chainId === ctx.chainId)) {
                state[name].push(await adoptA1(ctx, BigInt(adopt)))
                save()
                console.log(`case ${name} on ${ctx.network}: adopted ${adopt}`)
                continue
            }
            if (state[name].some((r: any) => r.chainId === ctx.chainId)) {
                console.log(`case ${name} on ${ctx.network}: already in ${FILE}, skipped`)
                continue
            }
            console.log(`case ${name} on ${ctx.network} ...`)
            onMined = (partial) => {
                state[name].push(partial)
                save()
            }
            const result = await cases[name](ctx)
            state[name] = state[name].filter((r: any) => r.chainId !== ctx.chainId).concat(result)
            save()
            console.log(`case ${name} on ${ctx.network}:`, JSON.stringify(result))
        }
    }
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
