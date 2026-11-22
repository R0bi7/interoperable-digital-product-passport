import { privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it } from "vitest";
import {
  CHALLENGE_TTL_MS,
  challengeMessage,
  clearChallenges,
  consumeChallenge,
  consumePinChallenge,
  issueChallenge,
  issuePinChallenge,
  pinChallengeMessage,
} from "@/lib/operator/challenge";

const alice = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const mallory = privateKeyToAccount(
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
);

beforeEach(() => clearChallenges());

describe("mint challenge", () => {
  it("has the message format IDPP mint challenge: <nonce>", () => {
    const { nonce, message } = issueChallenge(alice.address);
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(message).toBe(`IDPP mint challenge: ${nonce}`);
    expect(message).toBe(challengeMessage(nonce));
  });

  it("accepts the EIP-191 signature of the address that asked, exactly once", async () => {
    const { message } = issueChallenge(alice.address);
    const signature = await alice.signMessage({ message });
    expect(await consumeChallenge(alice.address, signature)).toEqual({ ok: true });
    expect(await consumeChallenge(alice.address, signature)).toEqual({
      ok: false,
      code: "no_challenge",
    });
  });

  it("matches the address case-insensitively", async () => {
    const { message } = issueChallenge(alice.address.toLowerCase());
    const signature = await alice.signMessage({ message });
    expect(await consumeChallenge(alice.address, signature)).toEqual({ ok: true });
  });

  it("rejects a signature by another key and keeps the challenge pending", async () => {
    const { message } = issueChallenge(alice.address);
    const forged = await mallory.signMessage({ message });
    expect(await consumeChallenge(alice.address, forged)).toEqual({
      ok: false,
      code: "bad_signature",
    });
    const genuine = await alice.signMessage({ message });
    expect(await consumeChallenge(alice.address, genuine)).toEqual({ ok: true });
  });

  it("rejects a signature over another message", async () => {
    issueChallenge(alice.address);
    const signature = await alice.signMessage({ message: "IDPP mint challenge: 00" });
    expect(await consumeChallenge(alice.address, signature)).toEqual({
      ok: false,
      code: "bad_signature",
    });
  });

  it("rejects a challenge issued to a different address", async () => {
    const { message } = issueChallenge(alice.address);
    const signature = await mallory.signMessage({ message });
    expect(await consumeChallenge(mallory.address, signature)).toEqual({
      ok: false,
      code: "no_challenge",
    });
  });

  it("rejects malformed signatures without throwing", async () => {
    issueChallenge(alice.address);
    expect(await consumeChallenge(alice.address, "0x1234")).toEqual({
      ok: false,
      code: "bad_signature",
    });
  });

  it("expires after the TTL", async () => {
    const now = 1_000_000;
    const { message } = issueChallenge(alice.address, now);
    const signature = await alice.signMessage({ message });
    expect(await consumeChallenge(alice.address, signature, now + CHALLENGE_TTL_MS)).toEqual({
      ok: false,
      code: "no_challenge",
    });
  });

  it("a newer challenge replaces the older one", async () => {
    const first = issueChallenge(alice.address);
    const second = issueChallenge(alice.address);
    const stale = await alice.signMessage({ message: first.message });
    expect((await consumeChallenge(alice.address, stale)).ok).toBe(false);
    const fresh = await alice.signMessage({ message: second.message });
    expect(await consumeChallenge(alice.address, fresh)).toEqual({ ok: true });
  });

  it("lets only one of two concurrent requests with the same signature win", async () => {
    const { message } = issueChallenge(alice.address);
    const signature = await alice.signMessage({ message });
    const results = await Promise.all([
      consumeChallenge(alice.address, signature),
      consumeChallenge(alice.address, signature),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("refuses to issue for a non-address", () => {
    expect(() => issueChallenge("not-an-address")).toThrow();
  });
});

describe("pin challenge", () => {
  it("has the message format IDPP pin challenge: <nonce>", () => {
    const { nonce, message } = issuePinChallenge(alice.address);
    expect(message).toBe(`IDPP pin challenge: ${nonce}`);
    expect(message).toBe(pinChallengeMessage(nonce));
  });

  it("accepts the signature exactly once", async () => {
    const { message } = issuePinChallenge(alice.address);
    const signature = await alice.signMessage({ message });
    expect(await consumePinChallenge(alice.address, signature)).toEqual({ ok: true });
    expect(await consumePinChallenge(alice.address, signature)).toEqual({
      ok: false,
      code: "no_challenge",
    });
  });

  it("keeps mint and pin challenges apart", async () => {
    const mint = issueChallenge(alice.address);
    const pin = issuePinChallenge(alice.address);
    expect(mint.nonce).not.toBe(pin.nonce);
    const mintSignature = await alice.signMessage({ message: mint.message });
    const pinSignature = await alice.signMessage({ message: pin.message });
    // neither signature opens the other namespace, and the failed tries consume nothing
    expect(await consumePinChallenge(alice.address, mintSignature)).toEqual({
      ok: false,
      code: "bad_signature",
    });
    expect(await consumeChallenge(alice.address, pinSignature)).toEqual({
      ok: false,
      code: "bad_signature",
    });
    expect(await consumePinChallenge(alice.address, pinSignature)).toEqual({ ok: true });
    expect(await consumeChallenge(alice.address, mintSignature)).toEqual({ ok: true });
  });

  it("is not affected by the mint challenge's nonce even if the prefix is spoofed", async () => {
    const mint = issueChallenge(alice.address);
    issuePinChallenge(alice.address);
    const spoofed = await alice.signMessage({ message: `IDPP pin challenge: ${mint.nonce}` });
    expect((await consumePinChallenge(alice.address, spoofed)).ok).toBe(false);
  });

  it("keeps several challenges of one address usable, each exactly once (two tabs of one holder)", async () => {
    const first = issuePinChallenge(alice.address);
    const second = issuePinChallenge(alice.address);
    const signatureOfFirst = await alice.signMessage({ message: first.message });
    const signatureOfSecond = await alice.signMessage({ message: second.message });
    expect(await consumePinChallenge(alice.address, signatureOfFirst)).toEqual({ ok: true });
    expect(await consumePinChallenge(alice.address, signatureOfFirst)).toEqual({
      ok: false,
      code: "bad_signature",
    });
    expect(await consumePinChallenge(alice.address, signatureOfSecond)).toEqual({ ok: true });
    expect(await consumePinChallenge(alice.address, signatureOfSecond)).toEqual({
      ok: false,
      code: "no_challenge",
    });
  });

  it("holds at most four unused challenges per address and drops the oldest", async () => {
    const issued = Array.from({ length: 5 }, () => issuePinChallenge(alice.address));
    const [oldest, ...newer] = issued;
    const oldestSignature = await alice.signMessage({
      message: (oldest as { message: string }).message,
    });
    expect(await consumePinChallenge(alice.address, oldestSignature)).toEqual({
      ok: false,
      code: "bad_signature",
    });
    for (const { message } of newer) {
      const signature = await alice.signMessage({ message });
      expect(await consumePinChallenge(alice.address, signature)).toEqual({ ok: true });
    }
  });

  it("drops only the expired challenges of an address", async () => {
    const now = 1_000_000;
    const old = issuePinChallenge(alice.address, now);
    const recent = issuePinChallenge(alice.address, now + CHALLENGE_TTL_MS - 1);
    const later = now + CHALLENGE_TTL_MS;
    const oldSignature = await alice.signMessage({ message: old.message });
    const recentSignature = await alice.signMessage({ message: recent.message });
    expect(await consumePinChallenge(alice.address, oldSignature, later)).toEqual({
      ok: false,
      code: "bad_signature",
    });
    expect(await consumePinChallenge(alice.address, recentSignature, later)).toEqual({ ok: true });
  });

  it("lets only one of two concurrent requests with the same signature win", async () => {
    issuePinChallenge(alice.address);
    const { message } = issuePinChallenge(alice.address);
    const signature = await alice.signMessage({ message });
    const results = await Promise.all([
      consumePinChallenge(alice.address, signature),
      consumePinChallenge(alice.address, signature),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });
});
