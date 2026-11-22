import { expect } from 'chai'
import { providers } from 'ethers'
import { readReceiptBlock, readSealedReceipt } from '../receipt-block'

describe('receipt block metadata', () => {
    const hash = '0xaBcD'
    const block = { hash: hash.toLowerCase(), timestamp: 123 } as providers.Block
    it('accepts the matching hash without a height lookup', async () => {
        const tags: unknown[] = []
        const provider = {
            getBlock: async (tag: unknown) => {
                tags.push(tag)
                return block
            },
        } as unknown as providers.Provider
        expect(await readReceiptBlock(provider, hash, 42)).to.equal(block)
        expect(tags).to.deep.equal([hash])
    })
    it('falls back to the receipt height when its hash lookup is unavailable', async () => {
        const tags: unknown[] = []
        const provider = {
            getBlock: async (tag: unknown) => {
                tags.push(tag)
                return typeof tag === 'string' ? null : block
            },
        } as unknown as providers.Provider
        expect(await readReceiptBlock(provider, hash, 42)).to.equal(block)
        expect(tags).to.deep.equal([hash, 42])
    })
    it('rejects a different block at the receipt height and exhausts bounded retries', async () => {
        let calls = 0
        const provider = {
            getBlock: async () => {
                calls++
                return { ...block, hash: '0xffff' }
            },
        } as unknown as providers.Provider
        expect(await readReceiptBlock(provider, hash, 42, 100, 0)).to.equal(undefined)
        expect(calls).to.equal(8)
    })
    it('bounds stalled reads and tolerates RPC errors without inventing metadata', async () => {
        const stalled = { getBlock: () => new Promise(() => {}) } as unknown as providers.Provider
        const started = Date.now()
        expect(await readReceiptBlock(stalled, hash, 42, 10, 0)).to.equal(undefined)
        expect(Date.now() - started).to.be.lessThan(500)
        const failed = {
            getBlock: async () => {
                throw new Error('RPC unavailable')
            },
        } as unknown as providers.Provider
        expect(await readReceiptBlock(failed, hash, 42, 100, 0)).to.equal(undefined)
    })
})

describe('sealed receipt identity', () => {
    const txHash = '0x' + '12'.repeat(32)
    const hash = '0x' + '34'.repeat(32)
    const initial = {
        transactionHash: txHash,
        blockHash: '0x' + '00'.repeat(32),
        blockNumber: 41,
        gasUsed: 1,
        effectiveGasPrice: 2,
        logs: [],
    } as unknown as providers.TransactionReceipt
    const sealed = {
        ...initial,
        blockHash: hash,
        blockNumber: 42,
        gasUsed: 3,
        effectiveGasPrice: 4,
        logs: [{ data: 'sealed' }],
    } as unknown as providers.TransactionReceipt
    it('replaces the complete optimistic receipt with the matching sealed receipt', async () => {
        let calls = 0
        const provider = {
            getTransactionReceipt: async (tx: string) => {
                expect(tx).to.equal(txHash)
                return ++calls === 1 ? initial : sealed
            },
        } as unknown as providers.Provider
        expect(await readSealedReceipt(provider, initial, 100, 0)).to.equal(sealed)
        expect(calls).to.equal(2)
        expect(initial.blockNumber).to.equal(41)
    })
    it('uses an already sealed receipt without an additional query', async () => {
        const provider = {
            getTransactionReceipt: async () => {
                throw new Error('must not query')
            },
        } as unknown as providers.Provider
        expect(await readSealedReceipt(provider, sealed)).to.equal(sealed)
    })
    it('never accepts a foreign transaction, persistent zero hash or stalled RPC', async () => {
        for (const receipt of [initial, { ...sealed, transactionHash: '0xother' }, null]) {
            const provider = { getTransactionReceipt: async () => receipt } as unknown as providers.Provider
            expect(await readSealedReceipt(provider, initial, 10, 1)).to.equal(undefined)
        }
        const provider = { getTransactionReceipt: () => new Promise(() => {}) } as unknown as providers.Provider
        expect(await readSealedReceipt(provider, initial, 10, 0)).to.equal(undefined)
    })
})
