import { ethers } from 'ethers'

// Decoding of custom-error reverts (StaleRevision, UnexpectedTokenId, ERC721 errors) against the contract ABI.

export type DecodedRevert = { name: string; args: string[] }

const HEX_DATA = /^0x[0-9a-fA-F]{8,}$/

// Revert data sits in different places depending on the provider and the call path (eth_call result, eth_estimateGas
// error body, nested `error` objects, JSON strings in `body`). Collect every candidate.
function revertDataCandidates(error: unknown, depth = 0, found: string[] = []): string[] {
    if (depth > 6 || error == null || typeof error !== 'object') return found
    const e = error as Record<string, unknown>
    if (typeof e.data === 'string' && HEX_DATA.test(e.data)) found.push(e.data)
    if (e.data != null && typeof e.data === 'object') revertDataCandidates(e.data, depth + 1, found)
    if (e.error != null) revertDataCandidates(e.error, depth + 1, found)
    if (typeof e.body === 'string') {
        try {
            revertDataCandidates(JSON.parse(e.body), depth + 1, found)
        } catch {
            // body is not JSON
        }
    }
    return found
}

/**
 * The custom error a failed call reverted with, decoded from the ABI. Undefined for anything else (RPC failure, empty
 * return data, panic, unknown selector), so a broken call can never pass as an expected revert.
 */
export function decodeRevert(iface: ethers.utils.Interface, error: unknown): DecodedRevert | undefined {
    const e = error as { errorName?: unknown; errorArgs?: unknown }
    // ethers v5 decodes custom errors of callStatic itself.
    if (typeof e?.errorName === 'string' && e.errorName.length > 0) {
        return { name: e.errorName, args: Array.from((e.errorArgs as unknown[] | undefined) ?? []).map(String) }
    }
    for (const data of revertDataCandidates(error)) {
        try {
            const parsed = iface.parseError(data)
            return { name: parsed.name, args: Array.from(parsed.args).map(String) }
        } catch {
            // data of another ABI or not an error
        }
    }
    return undefined
}

/** `StaleRevision(0, 1)` style rendering for reports. */
export const formatRevert = (revert: DecodedRevert): string => `${revert.name}(${revert.args.join(', ')})`
