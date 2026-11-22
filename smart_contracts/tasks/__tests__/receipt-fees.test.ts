import { expect } from 'chai'
import { providers } from 'ethers'
import { readL1FeeWei } from '../receipt-fees'

const BLOCK = '0x' + '34'.repeat(32)
const TX = '0x' + '12'.repeat(32)
const provider = (send: (method: string, args: unknown[]) => Promise<unknown>) =>
    ({ send }) as unknown as providers.Provider

describe('supplementary Base L1 fee', () => {
    it('preserves the sealed receipt charge as decimal, including a reported zero', async () => {
        const p = (l1Fee: string) =>
            provider(async (method, args) => {
                expect(method).to.equal('eth_getTransactionReceipt')
                expect(args).to.deep.equal([TX])
                return { transactionHash: TX, blockHash: BLOCK, l1Fee }
            })
        expect(await readL1FeeWei(p('0x23d1'), 84532, TX, BLOCK)).to.equal('9169')
        expect(await readL1FeeWei(p('0x0'), 84532, TX, BLOCK)).to.equal('0')
    })
    it('does not query other chains or an unsealed block identity', async () => {
        let calls = 0
        const p = provider(async () => {
            calls++
            return {}
        })
        for (const chainId of [421614, 11155111]) expect(await readL1FeeWei(p, chainId, TX, BLOCK)).to.equal(undefined)
        expect(await readL1FeeWei(p, 84532, TX, '0x' + '00'.repeat(32))).to.equal(undefined)
        expect(calls).to.equal(0)
    })
    it('omits missing, malformed, foreign, preconfirmed or reorganized receipt evidence', async () => {
        for (const raw of [
            null,
            {},
            { transactionHash: TX },
            { transactionHash: TX, blockHash: BLOCK, l1Fee: '-1' },
            { transactionHash: TX, blockHash: BLOCK, l1Fee: 1 },
            { transactionHash: '0xother', blockHash: BLOCK, l1Fee: '0x1' },
            { transactionHash: TX, blockHash: '0x' + '00'.repeat(32), l1Fee: '0x1' },
            { transactionHash: TX, blockHash: '0x' + '56'.repeat(32), l1Fee: '0x1' },
        ]) {
            expect(
                await readL1FeeWei(
                    provider(async () => raw),
                    84532,
                    TX,
                    BLOCK
                )
            ).to.equal(undefined)
        }
        expect(
            await readL1FeeWei(
                provider(async () => {
                    throw new Error('RPC unavailable')
                }),
                84532,
                TX,
                BLOCK
            )
        ).to.equal(undefined)
    })
    it('bounds a stalled supplementary read', async () => {
        expect(
            await readL1FeeWei(
                provider(() => new Promise(() => {})),
                84532,
                TX,
                BLOCK,
                10
            )
        ).to.equal(undefined)
    })
})
