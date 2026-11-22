import { BigNumber, Wallet, ethers } from 'ethers'

import type { Chain } from './flows'

// A second account for the cases that need someone who is not the contract owner: an approved operator, a stranger who
// tries to mint (docs/evaluation/PROTOCOL.md, DS1 and DS3). It is derived from the owner key, so the same address
// exists on every chain and nothing new has to be stored; it only ever holds the gas it needs.

const LABEL = 'idpp-evaluation-operator'

/** Gas the top-up assumes per transaction of the second account, and the factor on the gas price. */
export const TOP_UP_GAS_PER_TX = 200_000
export const TOP_UP_PRICE_FACTOR = 2

/** Transactions of the second account e2e:edge funds for: per repeat a non-issuer mint and a holder revise (both reverted) and an approved transferFrom, plus one spare. */
export const edgeTopUpTransactions = (repeats: number) => repeats * 3 + 1

export function deriveOperator(owner: Wallet, provider: ethers.providers.Provider = owner.provider): Wallet {
    const key = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(`${owner.privateKey}|${LABEL}`))
    return new Wallet(key, provider)
}

/** The same account on `chain`: connected to the chain's provider. */
export const operatorOn = (chain: Chain, operator: Wallet): Chain => ({
    ...chain,
    wallet: operator.connect(chain.wallet.provider),
    distillery: chain.distillery.connect(operator.connect(chain.wallet.provider)),
})

/**
 * The price per unit of gas a transaction from this harness is bounded by: the larger of `eth_gasPrice` and the fee
 * ceiling of the provider's fee data (the harness's providers follow `tasks/fees.ts`; stock ethers would ask for a 1.5 gwei
 * tip, whatever `eth_gasPrice` says, which on a chain with a tiny base fee answers far less) (a second account funded
 * from `eth_gasPrice` alone could not pay for its first transaction). The larger of the two, so that neither funding nor a budget is too small.
 */
export async function spendPrice(provider: ethers.providers.Provider): Promise<BigNumber> {
    const [gasPrice, fee] = await Promise.all([provider.getGasPrice(), provider.getFeeData()])
    return fee.maxFeePerGas != null && fee.maxFeePerGas.gt(gasPrice) ? fee.maxFeePerGas : gasPrice
}

/**
 * Waits until `address` shows at least `need` on `provider`, or throws, naming the funding transaction, the balance that
 * was required and the last one seen. One successful read reaches one backend of a load-balanced endpoint, so this lowers
 * the chance that the next transaction meets a stale node and does not remove it.
 */
export async function waitForBalance(
    provider: ethers.providers.Provider,
    address: string,
    need: BigNumber,
    fundingTx: string,
    timeoutMs = 60_000,
    pollMs = 1_000
): Promise<void> {
    const deadline = Date.now() + timeoutMs
    let seen = await provider.getBalance(address)
    while (seen.lt(need)) {
        if (Date.now() >= deadline) {
            throw new Error(
                `funding transaction ${fundingTx} confirmed, but ${address} still shows ${seen} wei after ${timeoutMs} ms; ${need} wei are required`
            )
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs))
        seen = await provider.getBalance(address)
    }
}

/**
 * Tops the operator up from the owner so that it can pay for `transactions` transactions of `gasPerTransaction` gas at
 * `TOP_UP_PRICE_FACTOR` times `spendPrice`. Returns the amount sent, zero if the balance already covered it.
 */
export async function fundOperator(
    chain: Chain,
    operator: Wallet,
    transactions: number,
    gasPerTransaction = TOP_UP_GAS_PER_TX
): Promise<BigNumber> {
    const provider = chain.wallet.provider
    const need = (await spendPrice(provider)).mul(TOP_UP_PRICE_FACTOR).mul(gasPerTransaction).mul(transactions)
    const have = await provider.getBalance(operator.address)
    if (have.gte(need)) return BigNumber.from(0)
    const top = need.sub(have)
    const { assertChainRunning, waitReceipt } = await import('./flows')
    assertChainRunning(chain)
    const tx = await chain.wallet.sendTransaction({ to: operator.address, value: top })
    await waitReceipt(chain, tx)
    // Public RPC endpoints are load balanced: the next call can reach a node that has not seen the transfer yet and
    // refuse the second account's first transaction for lack of funds (seen on Sepolia). Wait until the balance is visible.
    await waitForBalance(provider, operator.address, need, tx.hash)
    return top
}
