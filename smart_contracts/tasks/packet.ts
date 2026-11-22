import { BigNumber, ethers } from 'ethers'

// The part of the LayerZero V2 EndpointV2 that the replay case of e2e:edge uses, and the packet encoding.

export const ENDPOINT_ABI = [
    'event PacketSent(bytes encodedPayload, bytes options, address sendLibrary)',
    'function lzReceive((uint32 srcEid, bytes32 sender, uint64 nonce) origin, address receiver, bytes32 guid, bytes message, bytes extraData) payable',
    'function inboundPayloadHash(address receiver, uint32 srcEid, bytes32 sender, uint64 nonce) view returns (bytes32)',
    'error LZ_PayloadHashNotFound(bytes32 expected, bytes32 actual)',
]
export const ENDPOINT_IFACE = new ethers.utils.Interface(ENDPOINT_ABI)

/** The fields of a LayerZero V2 packet (PacketV1Codec): 81 header bytes, the 32-byte guid, then the message. */
export function decodePacket(encodedPayload: string) {
    const bytes = ethers.utils.arrayify(encodedPayload)
    if (bytes.length < 113) throw new Error(`packet of ${bytes.length} bytes is shorter than its header and guid`)
    return {
        nonce: BigNumber.from(bytes.slice(1, 9)),
        srcEid: BigNumber.from(bytes.slice(9, 13)).toNumber(),
        sender: ethers.utils.hexlify(bytes.slice(13, 45)),
        dstEid: BigNumber.from(bytes.slice(45, 49)).toNumber(),
        receiver: ethers.utils.hexlify(bytes.slice(49, 81)),
        guid: ethers.utils.hexlify(bytes.slice(81, 113)),
        message: ethers.utils.hexlify(bytes.slice(113)),
    }
}
