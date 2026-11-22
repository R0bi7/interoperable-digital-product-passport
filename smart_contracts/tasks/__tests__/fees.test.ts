import { expect } from 'chai'
import { BigNumber } from 'ethers'

import { FEE_POLICY_ID, PRIORITY_FEE_WEI, feesFor } from '../fees'

const gwei = (n: number) => BigNumber.from(Math.round(n * 1e9))

describe('fee policy', () => {
    it('asks for the small tip on a chain whose base fee is tiny', () => {
        const f = feesFor({ baseFee: BigNumber.from(160), gasPrice: BigNumber.from(160) })
        expect(f.maxPriorityFeePerGas?.eq(PRIORITY_FEE_WEI)).to.equal(true)
        expect(f.maxFeePerGas?.eq(BigNumber.from(320).add(PRIORITY_FEE_WEI))).to.equal(true)
        // a thousand times under what ethers asks for by default
        expect(f.maxFeePerGas?.lt(gwei(0.01))).to.equal(true)
    })

    it('raises the tip so that base plus tip reaches eth_gasPrice where a minimum gas price applies', () => {
        const f = feesFor({ baseFee: BigNumber.from(0), gasPrice: gwei(0.1) })
        expect(f.maxPriorityFeePerGas?.eq(gwei(0.1))).to.equal(true)
        expect(f.maxFeePerGas?.gte(gwei(0.1))).to.equal(true)
    })

    it('never lets the ceiling fall under the tip or under eth_gasPrice', () => {
        const f = feesFor({ baseFee: gwei(5), gasPrice: gwei(40) })
        expect(f.maxFeePerGas?.gte(gwei(40))).to.equal(true)
        expect(f.maxPriorityFeePerGas?.lte(f.maxFeePerGas as BigNumber)).to.equal(true)
    })

    it('sends a legacy transaction on a chain without a base fee', () => {
        expect(feesFor({ baseFee: null, gasPrice: gwei(3) })).to.deep.equal({
            maxFeePerGas: null,
            maxPriorityFeePerGas: null,
        })
    })
})

import { maxCidPairs } from '../fees'

describe('maximum-length CID sources', () => {
    const chains = [{ network: 'arbitrum-sepolia' }, { network: 'base-sepolia' }, { network: 'sepolia' }]
    it('never sends from Sepolia while another chain can, and covers every destination once', () => {
        const pairs = maxCidPairs(chains).map((p) => `${p.source.network} -> ${p.destination.network}`)
        expect(pairs).to.deep.equal([
            'base-sepolia -> arbitrum-sepolia',
            'arbitrum-sepolia -> base-sepolia',
            'arbitrum-sepolia -> sepolia',
        ])
        expect(pairs.some((p) => p.startsWith('sepolia'))).to.equal(false)
    })
    it('falls back to Sepolia only when it is the only other chain', () => {
        const pairs = maxCidPairs([{ network: 'base-sepolia' }, { network: 'sepolia' }])
        expect(pairs.map((p) => `${p.source.network} -> ${p.destination.network}`)).to.deep.equal([
            'sepolia -> base-sepolia',
            'base-sepolia -> sepolia',
        ])
    })
})

describe('maxCidPairs with an unranked network', () => {
    it('refuses it instead of guessing a rank', () => {
        expect(() => maxCidPairs([{ network: 'sepolia' }, { network: 'new-chain' }])).to.throw(
            'no send-cost rank for new-chain'
        )
    })
})

import { LowFeeProvider } from '../fees'

describe('LowFeeProvider.getFeeData', () => {
    const provider = (block: unknown, gasPrice: number) => {
        const p = new LowFeeProvider('http://localhost:0', 1) as any
        p.getBlock = async () => block
        p.getGasPrice = async () => BigNumber.from(gasPrice)
        return p as LowFeeProvider
    }
    it('uses the base fee of the latest block', async () => {
        const f = await provider({ baseFeePerGas: BigNumber.from(100) }, 100).getFeeData()
        expect(f.maxPriorityFeePerGas?.eq(PRIORITY_FEE_WEI)).to.equal(true)
    })
    it('sends a legacy transaction for a block without a base fee', async () => {
        const f = await provider({}, 5).getFeeData()
        expect(f.maxFeePerGas).to.equal(null)
        expect(f.gasPrice.toNumber()).to.equal(5)
    })
    it('fails on a missing block instead of reading it as a chain without a base fee', async () => {
        let error: Error | undefined
        try {
            await provider(null, 5).getFeeData()
        } catch (e) {
            error = e as Error
        }
        expect(error?.message).to.contain('no latest block')
    })
})

describe('feesFor, further edges', () => {
    it('falls back to the floor tip when eth_gasPrice is below the base fee', () => {
        const f = feesFor({ baseFee: gwei(2), gasPrice: gwei(1) })
        expect(f.maxPriorityFeePerGas?.eq(PRIORITY_FEE_WEI)).to.equal(true)
        expect(f.maxFeePerGas?.eq(gwei(4).add(PRIORITY_FEE_WEI))).to.equal(true)
    })
    it('names its formula, so that a changed formula shows in the run header', () => {
        expect(FEE_POLICY_ID).to.contain('low-tip-v1')
    })
})
