import { keccak_256 } from "@noble/hashes/sha3.js";
import type { VerificationResult } from "./verify";

/** A 32-byte value as `0x` + 64 lowercase hex digits. */
export type Bytes32 = `0x${string}`;

export const ZERO_HISTORY_HASH: Bytes32 = `0x${"0".repeat(64)}`;

const UINT64_MAX = 2n ** 64n - 1n;
const UINT256_MAX = 2n ** 256n - 1n;

function word(value: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let rest = value;
  for (let i = 31; i >= 0 && rest > 0n; i--) {
    out[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

function bytes32(value: string): Uint8Array {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`not a bytes32 value: ${value}`);
  return word(BigInt(value));
}

function unsigned(value: bigint | string, max: bigint, name: string): bigint {
  const parsed =
    typeof value === "bigint" ? value : /^(0|[1-9][0-9]*)$/.test(value) ? BigInt(value) : -1n;
  if (parsed < 0n || parsed > max) throw new Error(`${name} is out of range: ${String(value)}`);
  return parsed;
}

function toHex(bytes: Uint8Array): Bytes32 {
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Mirror of `PassportRegistry.nextHistoryHash`:
 * `keccak256(abi.encode(previous, tokenId, revision, cid))`, with `previous` the zero hash for
 * revision 0. Throws on a value the contract could not take.
 */
export function nextHistoryHash(
  previous: string,
  tokenId: bigint | string,
  revision: bigint | string,
  cid: string,
): Bytes32 {
  const text = new TextEncoder().encode(cid);
  const padded = new Uint8Array(Math.ceil(text.length / 32) * 32);
  padded.set(text);
  const encoded = new Uint8Array(32 * 5 + padded.length);
  encoded.set(bytes32(previous), 0);
  encoded.set(word(unsigned(tokenId, UINT256_MAX, "tokenId")), 32);
  encoded.set(word(unsigned(revision, UINT64_MAX, "revision")), 64);
  encoded.set(word(128n), 96); // offset of the string's tail: four head words
  encoded.set(word(BigInt(text.length)), 128);
  encoded.set(padded, 160);
  return toHex(keccak_256(encoded));
}

/** History hash of revision `cids.length - 1`, where `cids[i]` is the CID of revision i. */
export function historyHashOf(tokenId: bigint | string, cids: readonly string[]): Bytes32 {
  if (cids.length === 0) throw new Error("a history has at least revision 0");
  return cids.reduce<Bytes32>(
    (previous, cid, revision) => nextHistoryHash(previous, tokenId, BigInt(revision), cid),
    ZERO_HISTORY_HASH,
  );
}

/**
 * `historyHash`: the CIDs of revisions 0..r, in order, recompute the `historyHash` that
 * `passportOf(tokenId)` returns on the chain holding the token at revision r. This confirms the CID
 * and position of every earlier revision with one live read; it says nothing about who wrote a
 * revision or on which chain (the events and receipts do).
 */
export function verifyHistoryHash(
  tokenId: bigint | string,
  cids: readonly string[],
  onChainHistoryHash: string,
): VerificationResult {
  try {
    const actual = historyHashOf(tokenId, cids);
    return actual === onChainHistoryHash.toLowerCase()
      ? { ok: true }
      : {
          ok: false,
          reason: `revisions 0 to ${cids.length - 1} hash to ${actual}, the chain holds ${onChainHistoryHash}`,
        };
  } catch (error) {
    return { ok: false, reason: `history hash check failed: ${(error as Error).message}` };
  }
}
