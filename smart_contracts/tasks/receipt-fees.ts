import { BigNumber, providers } from 'ethers'
import { isSealedBlockHash } from './receipt-block'

/** Supplementary Base L1 data charge; feeWei keeps the protocol's gasUsed * effectiveGasPrice metric. */
export async function readL1FeeWei(
    provider: providers.Provider,
    chainId: number,
    txHash: string,
    blockHash: string,
    timeoutMs = 5_000
): Promise<string | undefined> {
    if (chainId !== 84532 || !isSealedBlockHash(blockHash)) return undefined
    const send = (provider as providers.JsonRpcProvider).send?.bind(provider)
    if (send == null) return undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
        const raw = (await Promise.race([
            send('eth_getTransactionReceipt', [txHash]),
            new Promise<undefined>((resolve) => {
                timer = setTimeout(() => resolve(undefined), timeoutMs)
            }),
        ])) as { transactionHash?: unknown; blockHash?: unknown; l1Fee?: unknown } | null | undefined
        if (typeof raw?.transactionHash !== 'string' || raw.transactionHash.toLowerCase() !== txHash.toLowerCase())
            return undefined
        if (typeof raw.blockHash !== 'string' || raw.blockHash.toLowerCase() !== blockHash.toLowerCase())
            return undefined
        if (typeof raw.l1Fee !== 'string' || !/^0x[0-9a-f]+$/i.test(raw.l1Fee)) return undefined
        return BigNumber.from(raw.l1Fee).toString()
    } catch {
        // Supplementary evidence cannot fail a confirmed transaction or alter its clocks.
        return undefined
    } finally {
        if (timer != null) clearTimeout(timer)
    }
}
