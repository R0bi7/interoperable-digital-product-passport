import { type Address, type Hex, isAddress, recoverTypedDataAddress } from "viem";
import { z } from "zod";

const uint = (bits: number) =>
  z
    .string()
    .regex(/^(0|[1-9][0-9]*)$/)
    .refine((value) => BigInt(value) < 2n ** BigInt(bits));
const address = z.string().refine((value): value is Address => isAddress(value));
const common = {
  tokenId: uint(256),
  chainId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  contract: address,
  nonce: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  expiresAt: uint(64),
};
const challengeSchema = z.strictObject({
  kind: z.literal("idpp-ownership-challenge"),
  v: z.literal(1),
  ...common,
});
const proofSchema = z.strictObject({
  kind: z.literal("idpp-ownership-proof"),
  v: z.literal(1),
  ...common,
  holder: address,
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
});

/** The verifier's own record is authoritative; never construct it from a scanned proof. */
export type ChallengeRecord = {
  tokenId: string;
  chainId: number;
  contract: Address;
  nonce: Hex;
  expiresAt: string;
};
export type OwnershipProof = ChallengeRecord & {
  kind: "idpp-ownership-proof";
  v: 1;
  holder: Address;
  signature: Hex;
};
export const OWNERSHIP_TYPES = {
  Ownership: [
    { name: "tokenId", type: "uint256" },
    { name: "holder", type: "address" },
    { name: "challenge", type: "bytes32" },
    { name: "expiresAt", type: "uint64" },
  ],
} as const;

export function ownershipTypedData(record: ChallengeRecord, holder: Address) {
  return {
    domain: {
      name: "IDPP ownership",
      version: "1",
      chainId: record.chainId,
      verifyingContract: record.contract,
    },
    types: OWNERSHIP_TYPES,
    primaryType: "Ownership" as const,
    message: {
      tokenId: BigInt(record.tokenId),
      holder,
      challenge: record.nonce,
      expiresAt: BigInt(record.expiresAt),
    },
  };
}

export function encodeOwnershipChallenge(record: ChallengeRecord): string {
  return JSON.stringify({ kind: "idpp-ownership-challenge", v: 1, ...record });
}

export function decodeOwnershipChallenge(text: string): ChallengeRecord | null {
  try {
    const parsed = challengeSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return null;
    const { kind: _kind, v: _v, ...record } = parsed.data;
    return record as ChallengeRecord;
  } catch {
    return null;
  }
}

export function decodeOwnershipProof(text: string): OwnershipProof | null {
  try {
    const parsed = proofSchema.safeParse(JSON.parse(text));
    return parsed.success ? (parsed.data as OwnershipProof) : null;
  } catch {
    return null;
  }
}

export type OwnershipFailureCode =
  | "wrong_signer"
  | "holder_not_signer"
  | "expired"
  | "foreign_nonce"
  | "wrong_token"
  | "wrong_chain"
  | "wrong_contract"
  | "wrong_expiry"
  | "owner_mismatch";
export type OwnershipVerification =
  | { ok: true; signer: Address }
  | { ok: false; code: OwnershipFailureCode };

/**
 * Verifies a signature against the verifier's record and a fresh owner read. `now` is Unix seconds,
 * sampled after that read. Replay protection belongs to the caller, keyed by the record's nonce.
 * A remote owner can sign a relayed challenge: a valid result cannot detect that relay.
 */
export async function verifyOwnershipProof(
  proof: OwnershipProof,
  record: ChallengeRecord,
  liveOwner: Address,
  now: number,
): Promise<OwnershipVerification> {
  const fail = (code: OwnershipFailureCode): OwnershipVerification => ({ ok: false, code });
  if (proof.tokenId !== record.tokenId) return fail("wrong_token");
  if (proof.chainId !== record.chainId) return fail("wrong_chain");
  if (proof.contract.toLowerCase() !== record.contract.toLowerCase()) return fail("wrong_contract");
  if (proof.nonce.toLowerCase() !== record.nonce.toLowerCase()) return fail("foreign_nonce");
  if (proof.expiresAt !== record.expiresAt) return fail("wrong_expiry");
  if (!Number.isSafeInteger(now) || now < 0 || BigInt(now) >= BigInt(record.expiresAt))
    return fail("expired");
  let signer: Address;
  try {
    signer = await recoverTypedDataAddress({
      ...ownershipTypedData(record, proof.holder),
      signature: proof.signature,
    });
  } catch {
    return fail("wrong_signer");
  }
  if (signer.toLowerCase() !== proof.holder.toLowerCase()) return fail("holder_not_signer");
  if (signer.toLowerCase() !== liveOwner.toLowerCase()) return fail("owner_mismatch");
  return { ok: true, signer };
}
