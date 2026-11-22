import {
  type ChallengeRecord,
  decodeOwnershipChallenge,
  decodeOwnershipProof,
  getChain,
  MANIFEST,
  type OwnershipVerification,
  originOf,
  verifyOwnershipProof,
  whiskyDistilleryAbi,
} from "@idpp/passport-config";
import { type Address, bytesToHex } from "viem";
import { publicClientFor } from "@/features/read/live";
import { type Location, locatePassport, type PassportRecord } from "@/features/write/lib/locate";

export type OwnershipLocation =
  | { kind: "held"; record: PassportRecord }
  | { kind: "unknown"; reason: string }
  | { kind: "in_transit" }
  | { kind: "error"; reason: string };
export type OwnershipLocationDeps = {
  locate(tokenId: bigint): Promise<Location>;
  nextTokenId(chainId: number): Promise<bigint>;
};
const locationDeps: OwnershipLocationDeps = {
  locate: (tokenId) => locatePassport(publicClientFor, tokenId),
  nextTokenId: (chainId) =>
    publicClientFor(chainId).readContract({
      address: getChain(chainId)?.address as Address,
      abi: whiskyDistilleryAbi,
      functionName: "nextTokenId",
    }),
};

/** Only an issued id absent on every successfully read chain can be described as in transit. */
export async function locateOwnership(
  tokenId: bigint,
  deps: OwnershipLocationDeps = locationDeps,
): Promise<OwnershipLocation> {
  const origin = MANIFEST.chains.find((chain) => BigInt(chain.chainId) === originOf(tokenId));
  if (!origin)
    return { kind: "unknown", reason: "Unknown id: its issuing chain is outside this deployment." };
  try {
    const location = await deps.locate(tokenId);
    if (location.kind === "held") return { kind: "held", record: location.record };
    if (location.kind === "unknown") return { kind: "error", reason: location.reason };
    if (location.probes.some((probe) => probe.status === "error")) {
      return { kind: "error", reason: "Could not read every chain; ownership is unknown." };
    }
    const next = await deps.nextTokenId(origin.chainId);
    return tokenId >= next
      ? { kind: "unknown", reason: "Unknown id: this token was never minted." }
      : { kind: "in_transit" };
  } catch {
    return { kind: "error", reason: "The chain RPC request failed; reload to retry." };
  }
}

export function createOwnershipChallenge(
  tokenId: string,
  held: PassportRecord,
  now = Math.floor(Date.now() / 1000),
  nonce = bytesToHex(crypto.getRandomValues(new Uint8Array(32))),
): ChallengeRecord {
  const chain = getChain(held.chainId);
  if (!chain) throw new Error("The holding chain is outside this deployment.");
  return {
    tokenId,
    chainId: held.chainId,
    contract: chain.address,
    nonce,
    expiresAt: String(now + 120),
  };
}

/** The holder accepts only an unexpired challenge for the currently configured deployment. */
export function readSigningChallenge(
  text: string,
  now = Math.floor(Date.now() / 1000),
): ChallengeRecord {
  const record = decodeOwnershipChallenge(text);
  if (!record) throw new Error("Not an IDPP ownership challenge.");
  const chain = getChain(record.chainId);
  if (!chain || chain.address.toLowerCase() !== record.contract.toLowerCase()) {
    throw new Error("The challenge chain or contract is outside this deployment.");
  }
  if (
    !MANIFEST.chains.some(
      (candidate) => BigInt(candidate.chainId) === originOf(BigInt(record.tokenId)),
    )
  ) {
    throw new Error("The token's issuing chain is outside this deployment.");
  }
  const remaining = BigInt(record.expiresAt) - BigInt(now);
  if (remaining <= 0n) throw new Error("The ownership challenge has expired. Ask for a new one.");
  return record;
}

export type OwnershipCheck =
  | OwnershipVerification
  | { ok: false; code: "invalid_proof" | "already_used" | "chain_unavailable" };
export type OwnershipCheckDeps = {
  readOwner(record: ChallengeRecord): Promise<Address>;
  now(): number;
};
const checkDeps: OwnershipCheckDeps = {
  readOwner: (record) =>
    publicClientFor(record.chainId).readContract({
      address: record.contract,
      abi: whiskyDistilleryAbi,
      functionName: "ownerOf",
      args: [BigInt(record.tokenId)],
      blockTag: "latest",
    }),
  now: () => Math.floor(Date.now() / 1000),
};

/** The scanned proof never selects a chain or contract; both come from our own challenge record. */
export async function checkOwnershipResponse(
  text: string,
  record: ChallengeRecord,
  consumed: Set<string>,
  deps: OwnershipCheckDeps = checkDeps,
): Promise<OwnershipCheck> {
  const nonce = record.nonce.toLowerCase();
  if (consumed.has(nonce)) return { ok: false, code: "already_used" };
  const proof = decodeOwnershipProof(text);
  if (!proof) return { ok: false, code: "invalid_proof" };
  let owner: Address;
  try {
    owner = await deps.readOwner(record);
  } catch {
    return { ok: false, code: "chain_unavailable" };
  }
  const result = await verifyOwnershipProof(proof, record, owner, deps.now());
  if (!result.ok) return result;
  // Two scans may race across the live read: consume once, including in that case.
  if (consumed.has(nonce)) return { ok: false, code: "already_used" };
  consumed.add(nonce);
  return result;
}
