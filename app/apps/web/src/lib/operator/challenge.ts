import "server-only";
import { randomBytes } from "node:crypto";
import { type Hex, isAddress, verifyMessage } from "viem";

/** Challenges live five minutes and are single use. */
export const CHALLENGE_TTL_MS = 5 * 60_000;
const MAX_PENDING = 1_000;

type Pending = { nonce: string; expiresAt: number };

/** A challenge namespace: its own message prefix and its own store, so signatures do not cross over. */
export type ChallengeKind = {
  /** `message = "<prefix><nonce>"`, for example `IDPP mint challenge: <nonce>`. */
  prefix: string;
  /** Key of the process-wide store. */
  storeKey: symbol;
  /**
   * How many unused challenges one address may hold at once; asking for another beyond this drops
   * the oldest. 1 means a newer challenge replaces the older one.
   */
  maxPerAddress: number;
};

export const MINT_CHALLENGE: ChallengeKind = {
  prefix: "IDPP mint challenge: ",
  storeKey: Symbol.for("idpp.mint-challenges"),
  maxPerAddress: 1,
};

/**
 * `POST /api/pin`: a different prefix and a different store than the mint challenge. An issuer may
 * have the revise page open in a few tabs or devices; each asks for its own challenge, and with a
 * single slot the later request would invalidate the signature the earlier one is waiting for.
 */
export const PIN_CHALLENGE: ChallengeKind = {
  prefix: "IDPP pin challenge: ",
  storeKey: Symbol.for("idpp.pin-challenges"),
  maxPerAddress: 4,
};

// The challenge route and the consuming route can be bundled as separate modules (and `next dev`
// reloads them), so each map hangs off globalThis to stay shared within one server process.
type GlobalWithStores = typeof globalThis & { [key: symbol]: Map<string, Pending[]> | undefined };

function store(kind: ChallengeKind): Map<string, Pending[]> {
  const holder = globalThis as GlobalWithStores;
  const existing = holder[kind.storeKey];
  if (existing) return existing;
  const created = new Map<string, Pending[]>();
  holder[kind.storeKey] = created;
  return created;
}

/** The text a wallet signs for `kind`. */
export function messageFor(kind: ChallengeKind, nonce: string): string {
  return `${kind.prefix}${nonce}`;
}

/** The text a wallet signs for a mint: `message = "IDPP mint challenge: <nonce>"`. */
export function challengeMessage(nonce: string): string {
  return messageFor(MINT_CHALLENGE, nonce);
}

/** The text a wallet signs for a pin: `message = "IDPP pin challenge: <nonce>"`. */
export function pinChallengeMessage(nonce: string): string {
  return messageFor(PIN_CHALLENGE, nonce);
}

function prune(kind: ChallengeKind, now: number) {
  const pending = store(kind);
  for (const [address, entries] of pending) {
    const live = entries.filter((entry) => entry.expiresAt > now);
    if (live.length === 0) pending.delete(address);
    else if (live.length !== entries.length) pending.set(address, live);
  }
  // Bound memory: drop the oldest addresses first (Map keeps insertion order).
  for (const address of pending.keys()) {
    if (pending.size <= MAX_PENDING) break;
    pending.delete(address);
  }
}

/** Issues a fresh nonce bound to `address`; beyond `kind.maxPerAddress` it drops the address's oldest one. */
export function issueChallengeOf(
  kind: ChallengeKind,
  address: string,
  now = Date.now(),
): { nonce: string; message: string } {
  if (!isAddress(address)) throw new TypeError("address is not a valid address");
  prune(kind, now);
  const nonce = randomBytes(16).toString("hex");
  const key = address.toLowerCase();
  const entries = [...(store(kind).get(key) ?? []), { nonce, expiresAt: now + CHALLENGE_TTL_MS }];
  // Re-insert so the address moves to the newest position of the bounded store.
  store(kind).delete(key);
  store(kind).set(key, entries.slice(-kind.maxPerAddress));
  return { nonce, message: messageFor(kind, nonce) };
}

export type ChallengeCheck = { ok: true } | { ok: false; code: "no_challenge" | "bad_signature" };

/**
 * Verifies the EIP-191 `signature` of `address` over one of the challenges of `kind` issued to that
 * address and consumes that nonce. A wrong signature does not consume anything, so a third party
 * cannot burn a signer's pending challenge by posting garbage for their address.
 */
export async function consumeChallengeOf(
  kind: ChallengeKind,
  address: string,
  signature: string,
  now = Date.now(),
): Promise<ChallengeCheck> {
  const key = address.toLowerCase();
  const candidates = (store(kind).get(key) ?? []).filter((entry) => entry.expiresAt > now);
  if (candidates.length === 0) return { ok: false, code: "no_challenge" };

  let matched: Pending | undefined;
  for (const entry of candidates) {
    let valid = false;
    try {
      valid = await verifyMessage({
        address: address as `0x${string}`,
        message: messageFor(kind, entry.nonce),
        signature: signature as Hex,
      });
    } catch {
      valid = false;
    }
    if (valid) {
      matched = entry;
      break;
    }
  }
  if (!matched) return { ok: false, code: "bad_signature" };

  // Re-check after the await: two concurrent requests with the same signature must not both win.
  const remaining = store(kind).get(key) ?? [];
  if (!remaining.includes(matched)) return { ok: false, code: "no_challenge" };
  const rest = remaining.filter((entry) => entry !== matched);
  if (rest.length === 0) store(kind).delete(key);
  else store(kind).set(key, rest);
  return { ok: true };
}

export const issueChallenge = (address: string, now?: number) =>
  issueChallengeOf(MINT_CHALLENGE, address, now);
export const consumeChallenge = (address: string, signature: string, now?: number) =>
  consumeChallengeOf(MINT_CHALLENGE, address, signature, now);
export const issuePinChallenge = (address: string, now?: number) =>
  issueChallengeOf(PIN_CHALLENGE, address, now);
export const consumePinChallenge = (address: string, signature: string, now?: number) =>
  consumeChallengeOf(PIN_CHALLENGE, address, signature, now);

/** Test helper: forget all pending challenges of every namespace. */
export function clearChallenges() {
  store(MINT_CHALLENGE).clear();
  store(PIN_CHALLENGE).clear();
}
