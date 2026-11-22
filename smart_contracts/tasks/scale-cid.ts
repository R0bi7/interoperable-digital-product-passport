import { BigNumber } from 'ethers'

import type { Ctx } from './flows'
import { buildEnvelope, canonicalizeEnvelope, caskData, computeCidV1, VerifyContext } from './payload'

export type ScaleItem = { readonly tokenId: BigNumber; readonly cid: string; readonly bytes: Uint8Array }

/** A DS4 payload has the same envelope and CID profile as a pinned mint, but remains in the run's local cache. */
export function localCid(ctx: Ctx, tokenId: BigNumber): ScaleItem {
    const envelope = buildEnvelope({
        deploymentId: ctx.deploymentId,
        tokenId: tokenId.toString(),
        revision: 0,
        previousCid: null,
        kind: 'cask',
        granularity: 'item',
        data: caskData(tokenId.toString(), `DS4 mint (run ${ctx.runId})`),
    })
    const bytes = canonicalizeEnvelope(envelope)
    const cid = computeCidV1(bytes)
    if (cid.length !== 59) throw new Error(`DS4 expected a 59-byte CID, got ${cid.length}`)
    ctx.verify.cache.set(cid, bytes)
    return { tokenId, cid, bytes }
}

export function localVerifyContext(ctx: Ctx): VerifyContext {
    return {
        ...ctx.verify,
        fetchBytes: async (cid) => {
            const bytes = ctx.verify.cache.get(cid)
            if (bytes == null) throw new Error(`local CID ${cid} is not cached`)
            return bytes
        },
    }
}
