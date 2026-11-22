import { sha256 } from "@noble/hashes/sha2.js";
import { CID } from "multiformats/cid";
import { create as createDigest } from "multiformats/hashes/digest";

/** Multicodec `raw`. */
export const RAW_CODEC = 0x55;
/** Multihash `sha2-256`. */
export const SHA2_256_CODE = 0x12;

/**
 * CIDv1, codec raw, sha2-256, base32 lower (`bafkrei…`), computed over `bytes` exactly as given.
 *
 * Hashing is synchronous on Node and in browsers. Do not use `sha256` from
 * `multiformats/hashes/sha2` here: its package export map resolves to an async WebCrypto hasher
 * under the `browser` condition, so it is only synchronous on Node. `@noble/hashes` is a pinned,
 * audited, synchronous pure-JS implementation with one code path everywhere.
 */
export function computeCidV1(bytes: Uint8Array): string {
  const digest = createDigest(SHA2_256_CODE, sha256(bytes));
  return CID.create(1, RAW_CODEC, digest).toString();
}

/** Parses a CID string. Throws on malformed input. */
export function parseCid(cid: string): CID {
  return CID.parse(cid);
}

/** True when `cid` parses and matches the IDPP profile (v1, raw, sha2-256, 32-byte digest). */
export function isProfileCid(cid: string): boolean {
  try {
    const parsed = CID.parse(cid);
    return (
      parsed.version === 1 &&
      parsed.code === RAW_CODEC &&
      parsed.multihash.code === SHA2_256_CODE &&
      parsed.multihash.size === 32 &&
      parsed.toString() === cid
    );
  } catch {
    return false;
  }
}
