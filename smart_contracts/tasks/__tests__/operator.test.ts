import { expect } from 'chai'
import { BigNumber } from 'ethers'

import { spendPrice, waitForBalance } from '../operator'

const provider = (gasPrice: number, maxFeePerGas: number | null) =>
    ({
        getGasPrice: async () => BigNumber.from(gasPrice),
        getFeeData: async () => ({ maxFeePerGas: maxFeePerGas == null ? null : BigNumber.from(maxFeePerGas) }),
    }) as never

describe('spendPrice', () => {
    it('is the fee ceiling when eth_gasPrice is far below it (160 wei against a 1.5 gwei ceiling)', async () => {
        expect((await spendPrice(provider(160, 1_500_000_020))).toNumber()).to.equal(1_500_000_020)
    })

    it('is eth_gasPrice when that is higher, or when the chain gives no fee data', async () => {
        expect((await spendPrice(provider(5_000_000_000, 1_500_000_000))).toNumber()).to.equal(5_000_000_000)
        expect((await spendPrice(provider(7, null))).toNumber()).to.equal(7)
    })
})

describe('waitForBalance', () => {
    // balances answered in turn, the last one repeated
    const balances = (...values: number[]) => {
        let i = 0
        return { getBalance: async () => BigNumber.from(values[Math.min(i++, values.length - 1)]) } as never
    }

    it('returns once a read shows enough, after stale reads', async () => {
        await waitForBalance(balances(0, 0, 100), '0xabc', BigNumber.from(100), '0xtx', 1_000, 1)
    })

    it('throws, naming the transaction, the need and the last balance seen, if it never shows', async () => {
        let error: Error | undefined
        try {
            await waitForBalance(balances(0, 40), '0xabc', BigNumber.from(100), '0xtx', 20, 5)
        } catch (e) {
            error = e as Error
        }
        expect(error?.message)
            .to.contain('0xtx')
            .and.to.contain('0xabc')
            .and.to.contain('40 wei')
            .and.to.contain('100 wei')
    })
})
