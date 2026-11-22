import { providers } from 'ethers'

export const isSealedBlockHash = (hash: unknown): hash is string =>
    typeof hash === 'string' && /^0x[0-9a-f]{64}$/i.test(hash) && !/^0x0{64}$/i.test(hash)

/** Return only the block named by the receipt, even when a lagging RPC needs a lookup by height. */
export async function readReceiptBlock(
    provider: providers.Provider,
    hash: string,
    blockNumber: number,
    timeoutMs = 15_000,
    retryDelayMs = 1_000
): Promise<providers.Block | undefined> {
    const deadline = Date.now() + timeoutMs
    for (let attempt = 0; attempt < 4 && Date.now() < deadline; attempt++) {
        for (const tag of [hash, blockNumber]) {
            const remaining = deadline - Date.now()
            if (remaining <= 0) return undefined
            let timer: ReturnType<typeof setTimeout> | undefined
            try {
                const block = await Promise.race([
                    provider.getBlock(tag),
                    new Promise<undefined>((resolve) => {
                        timer = setTimeout(() => resolve(undefined), Math.min(5_000, remaining))
                    }),
                ])
                if (block?.hash?.toLowerCase() === hash.toLowerCase()) return block
            } catch {
                // A missing or failed read does not discard the confirmed receipt.
            } finally {
                if (timer != null) clearTimeout(timer)
            }
        }
        if (attempt < 3)
            await new Promise((resolve) =>
                setTimeout(resolve, Math.min(retryDelayMs, Math.max(0, deadline - Date.now())))
            )
    }
    return undefined
}

/** Flashblock receipts can carry a zero block hash. Keep their observation time, but refresh identity and costs. */
export async function readSealedReceipt(
    provider: providers.Provider,
    initial: providers.TransactionReceipt,
    timeoutMs = 15_000,
    retryDelayMs = 500
): Promise<providers.TransactionReceipt | undefined> {
    const sealed = (r: providers.TransactionReceipt | null | undefined) =>
        r?.transactionHash?.toLowerCase() === initial.transactionHash.toLowerCase() && isSealedBlockHash(r.blockHash)
    if (sealed(initial)) return initial
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
            const receipt = await Promise.race([
                provider.getTransactionReceipt(initial.transactionHash),
                new Promise<undefined>((resolve) => {
                    timer = setTimeout(() => resolve(undefined), Math.min(5_000, deadline - Date.now()))
                }),
            ])
            if (sealed(receipt)) return receipt!
        } catch {
            // An RPC gap leaves the initial pending receipt available to the interruption checkpoint.
        } finally {
            if (timer != null) clearTimeout(timer)
        }
        const remaining = deadline - Date.now()
        if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(retryDelayMs, remaining)))
    }
    return undefined
}
