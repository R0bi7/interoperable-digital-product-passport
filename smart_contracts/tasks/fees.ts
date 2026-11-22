import { BigNumber, ethers } from 'ethers'

// The fee policy of the harness. ethers v5 sends EIP-1559 transactions with a priority fee of 1.5 gwei, which is about a
// thousand times the base fee on the testnets, and testnet coins are
// scarce. The harness asks for a small tip instead. It is a parameter of every run (the run header records it), because the
// tip can change how fast a transaction is included and so the same-chain times.

/** Names the formula of `feesFor`; recorded in every run header so a changed formula cannot hide behind an unchanged floor. */
export const FEE_POLICY_ID = 'low-tip-v1: tip = max(floor, gasPrice - base); ceiling = max(2 * base + tip, gasPrice)'

/** Floor of the priority fee asked for, in wei: 0.001 gwei. `feesFor` raises it where base fee plus tip would stay under `eth_gasPrice`. */
export const PRIORITY_FEE_WEI = BigNumber.from(1_000_000)

/**
 * Sources for the maximum-length CID delivery: every chain is the destination once, and the source is the cheapest other
 * chain to send from, by LayerZero fee.
 */
// Order confirmed by actual app quotes on 2026-10-19 (eval3-deployment-readback-1792440181462.json):
// Arbitrum is cheaper into Base and tied with Base into Sepolia; Base is cheaper than Sepolia into Arbitrum.
const SEND_COST_RANK: Readonly<Record<string, number>> = {
    'arbitrum-sepolia': 0,
    'base-sepolia': 0.5,
    sepolia: 1,
}

/**
 * The fixed source preference for the three-chain evaluation (a dated order, not a live quote). A network without a rank is
 * an error: extend `SEND_COST_RANK` from a fresh `quoteSend` before adding one.
 */
export function maxCidPairs<T extends { readonly network: string }>(
    chains: readonly T[]
): { source: T; destination: T }[] {
    const unranked = chains.filter((c) => SEND_COST_RANK[c.network] === undefined)
    if (unranked.length > 0) throw new Error(`no send-cost rank for ${unranked.map((c) => c.network).join(', ')}`)
    const rank = (c: T) => SEND_COST_RANK[c.network]
    return chains.map((destination) => {
        const others = chains.filter((c) => c !== destination).sort((a, b) => rank(a) - rank(b))
        return { source: others[0], destination }
    })
}

export type FeeInputs = { readonly baseFee: BigNumber | null; readonly gasPrice: BigNumber }
export type Fees = {
    readonly maxFeePerGas: BigNumber | null
    readonly maxPriorityFeePerGas: BigNumber | null
}

/**
 * Fees for one transaction. Without a base fee (a chain without EIP-1559) there are none and ethers sends a legacy
 * transaction at `gasPrice`. Otherwise the tip is `PRIORITY_FEE_WEI`, raised so that base fee plus tip reaches
 * `eth_gasPrice` (a chain with a minimum gas price refuses anything under it), and the ceiling is twice the base fee plus the
 * tip, never below `eth_gasPrice`. What is paid is the base fee plus the tip, not the ceiling.
 */
export function feesFor({ baseFee, gasPrice }: FeeInputs): Fees {
    if (baseFee == null) return { maxFeePerGas: null, maxPriorityFeePerGas: null }
    const wanted = gasPrice.sub(baseFee)
    const tip = wanted.gt(PRIORITY_FEE_WEI) ? wanted : PRIORITY_FEE_WEI
    let max = baseFee.mul(2).add(tip)
    if (max.lt(gasPrice)) max = gasPrice
    return { maxFeePerGas: max, maxPriorityFeePerGas: tip.gt(max) ? max : tip }
}

/** A provider whose fee data follows `feesFor`; everything else is the stock provider. */
export class LowFeeProvider extends ethers.providers.StaticJsonRpcProvider {
    async getFeeData() {
        const [block, gasPrice] = await Promise.all([this.getBlock('latest'), this.getGasPrice()])
        // A missing block is an RPC failure, not a chain without a base fee (that one has a block and no baseFeePerGas).
        if (block == null) throw new Error('fee data: the node returned no latest block')
        const fees = feesFor({ baseFee: block.baseFeePerGas ?? null, gasPrice })
        return {
            lastBaseFeePerGas: block.baseFeePerGas ?? null,
            maxFeePerGas: fees.maxFeePerGas,
            maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
            gasPrice,
        }
    }
}
