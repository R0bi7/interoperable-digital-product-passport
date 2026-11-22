import { expect } from 'chai'
import { ethers } from 'ethers'

import { decodeRevert, formatRevert } from '../reverts'

// The two custom errors of PassportRegistry plus an OpenZeppelin error, as the ABI of WhiskyDistillery declares them.
const iface = new ethers.utils.Interface([
    'error StaleRevision(uint64 expected, uint64 actual)',
    'error UnexpectedTokenId(uint256 expected, uint256 actual)',
    'error ERC721InsufficientApproval(address operator, uint256 tokenId)',
])

const stale = iface.encodeErrorResult('StaleRevision', [0, 1])
const unexpected = iface.encodeErrorResult('UnexpectedTokenId', ['97000000000001', '97000000000000'])

describe('decodeRevert', () => {
    it('decodes StaleRevision from revert data in a nested provider error (eth_estimateGas shape)', () => {
        const error = Object.assign(new Error('cannot estimate gas'), {
            code: 'UNPREDICTABLE_GAS_LIMIT',
            error: { code: 3, message: 'execution reverted', data: stale },
        })
        const decoded = decodeRevert(iface, error)
        expect(decoded).to.deep.equal({ name: 'StaleRevision', args: ['0', '1'] })
        expect(formatRevert(decoded!)).to.equal('StaleRevision(0, 1)')
    })

    it('decodes UnexpectedTokenId with ids above 2^53 exactly', () => {
        const error = { error: { error: { data: unexpected } } }
        expect(decodeRevert(iface, error)).to.deep.equal({
            name: 'UnexpectedTokenId',
            args: ['97000000000001', '97000000000000'],
        })
    })

    it('decodes revert data inside a JSON response body', () => {
        const error = { body: JSON.stringify({ error: { code: -32000, message: 'execution reverted', data: stale } }) }
        expect(decodeRevert(iface, error)?.name).to.equal('StaleRevision')
    })

    it('uses the name and args ethers already decoded on a CALL_EXCEPTION (callStatic shape)', () => {
        const error = { code: 'CALL_EXCEPTION', errorName: 'StaleRevision', errorArgs: [0, 1] }
        expect(decodeRevert(iface, error)).to.deep.equal({ name: 'StaleRevision', args: ['0', '1'] })
    })

    it('returns undefined for a revert it cannot decode', () => {
        expect(decodeRevert(iface, new Error('network down'))).to.equal(undefined)
        expect(decodeRevert(iface, { data: '0x' })).to.equal(undefined)
        expect(decodeRevert(iface, { data: '0xdeadbeef' })).to.equal(undefined)
        expect(decodeRevert(iface, undefined)).to.equal(undefined)
    })

    it('distinguishes the two errors', () => {
        expect(decodeRevert(iface, { data: stale })?.name).to.equal('StaleRevision')
        expect(decodeRevert(iface, { data: unexpected })?.name).to.equal('UnexpectedTokenId')
    })
})
