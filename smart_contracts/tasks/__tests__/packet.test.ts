import { expect } from 'chai'
import { ethers } from 'ethers'

import { ENDPOINT_IFACE, decodePacket } from '../packet'

// PacketV1Codec.encode: version (1) | nonce (8) | srcEid (4) | sender (32) | dstEid (4) | receiver (32) | guid (32) | message
const encode = (
    nonce: number,
    srcEid: number,
    sender: string,
    dstEid: number,
    receiver: string,
    guid: string,
    message: string
) =>
    ethers.utils.hexConcat([
        '0x01',
        ethers.utils.hexZeroPad(ethers.utils.hexlify(nonce), 8),
        ethers.utils.hexZeroPad(ethers.utils.hexlify(srcEid), 4),
        ethers.utils.hexZeroPad(sender, 32),
        ethers.utils.hexZeroPad(ethers.utils.hexlify(dstEid), 4),
        ethers.utils.hexZeroPad(receiver, 32),
        guid,
        message,
    ])

describe('packet', () => {
    const sender = '0x00000000000000000000000000000000000000aa'
    const receiver = '0x00000000000000000000000000000000000000bb'
    const guid = ethers.utils.keccak256('0x01')
    const message = ethers.utils.defaultAbiCoder.encode(
        ['bytes32', 'uint256', 'bytes'],
        [ethers.utils.hexZeroPad('0x07', 32), '421614000000000000', '0x1234']
    )

    it('decodes the header, the guid and the message of an encoded packet', () => {
        const packet = decodePacket(encode(5, 40231, sender, 40245, receiver, guid, message))
        expect(packet.nonce.toNumber()).to.equal(5)
        expect([packet.srcEid, packet.dstEid]).to.deep.equal([40231, 40245])
        expect(packet.sender).to.equal(ethers.utils.hexZeroPad(sender, 32))
        expect(packet.receiver).to.equal(ethers.utils.hexZeroPad(receiver, 32))
        expect(packet.guid).to.equal(guid)
        expect(packet.message).to.equal(message)
    })

    it('rejects a payload that is shorter than header and guid, and finds PacketSent by its topic', () => {
        expect(() => decodePacket('0x01')).to.throw('shorter than its header')
        expect(ENDPOINT_IFACE.getEventTopic('PacketSent')).to.match(/^0x[0-9a-f]{64}$/)
    })

    it('knows the endpoint error the replay case expects', () => {
        const data = ENDPOINT_IFACE.encodeErrorResult('LZ_PayloadHashNotFound', [ethers.constants.HashZero, guid])
        const parsed = ENDPOINT_IFACE.parseError(data)
        expect([parsed.name, String(parsed.args[0]), String(parsed.args[1])]).to.deep.equal([
            'LZ_PayloadHashNotFound',
            ethers.constants.HashZero,
            guid,
        ])
    })
})
