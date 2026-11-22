import { describe, expect, it } from "vitest";
import { historyHashOf, nextHistoryHash, verifyHistoryHash, ZERO_HISTORY_HASH } from "../src/index";

// Read-only nextHistoryHash calls on whisky-v2-eval3, 2026-10-19 UTC:
// Arbitrum Sepolia 0xFE84e01B03Cae9B4AaD5678A5681B70bA77435C2, block 320859357;
// Sepolia 0xAD3B1CA4eD7e212cA7a231829a542128feA8A5Ba, block 11951022.
// No token was minted for these pure calls.
const TOKEN = 421614000000000000n;
const CIDS = [
  "bafkreibnugdjrt4xfyb4untqebjbktbq7lhbbxbiwtlgcefchoioao6dhm",
  "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku",
  "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG",
] as const;
const H = [
  "0x016273f64fc235f41480e9f697124bb6d8a2ff8436b460258a23a61c20f9a6d3",
  "0xeed274d46b0e88aa290a02989841485e49b0d6e5c7f28c8d4bcb02e4208bddb8",
  "0x55af6d76b08efa6e3f27cef18b3918ea410eec17d070c64159b75edd6dd52390",
] as const;
// A Sepolia-sized id above 2^53, revision 0 with CIDS[0].
const SEPOLIA_TOKEN = 11155111000000000007n;
const SEPOLIA_H0 = "0xe790e16fcd68db99a8d1df7e3999bd137392cac215d1c220b33c4e5c32101cbe";

describe("nextHistoryHash", () => {
  it("matches the contract step by step", () => {
    expect(nextHistoryHash(ZERO_HISTORY_HASH, TOKEN, 0n, CIDS[0])).toBe(H[0]);
    expect(nextHistoryHash(H[0], TOKEN, 1n, CIDS[1])).toBe(H[1]);
    expect(nextHistoryHash(H[1], TOKEN, 2n, CIDS[2])).toBe(H[2]);
  });

  it("takes decimal strings and ids above 2^53", () => {
    expect(nextHistoryHash(ZERO_HISTORY_HASH, TOKEN.toString(), "0", CIDS[0])).toBe(H[0]);
    expect(nextHistoryHash(ZERO_HISTORY_HASH, SEPOLIA_TOKEN, 0n, CIDS[0])).toBe(SEPOLIA_H0);
  });

  it("rejects values the contract could not take", () => {
    expect(() => nextHistoryHash("0x12", TOKEN, 0n, CIDS[0])).toThrow(/bytes32/);
    expect(() => nextHistoryHash(ZERO_HISTORY_HASH, -1n, 0n, CIDS[0])).toThrow(/tokenId/);
    expect(() => nextHistoryHash(ZERO_HISTORY_HASH, TOKEN, 2n ** 64n, CIDS[0])).toThrow(/revision/);
    expect(() => nextHistoryHash(ZERO_HISTORY_HASH, "01", 0n, CIDS[0])).toThrow(/tokenId/);
  });
});

describe("historyHashOf", () => {
  it("folds the recurrence over revisions 0..r", () => {
    expect(historyHashOf(TOKEN, CIDS.slice(0, 1))).toBe(H[0]);
    expect(historyHashOf(TOKEN, CIDS)).toBe(H[2]);
  });

  it("needs revision 0", () => {
    expect(() => historyHashOf(TOKEN, [])).toThrow();
  });
});

describe("verifyHistoryHash", () => {
  it("accepts the recorded history, in any hex case", () => {
    expect(verifyHistoryHash(TOKEN, CIDS, H[2])).toEqual({ ok: true });
    expect(verifyHistoryHash(TOKEN, CIDS, H[2].toUpperCase().replace("0X", "0x"))).toEqual({
      ok: true,
    });
  });

  it("detects an omitted, reordered, replaced or foreign history", () => {
    const cases: [bigint, string[]][] = [
      [TOKEN, [CIDS[0], CIDS[2]]],
      [TOKEN, [CIDS[0], CIDS[2], CIDS[1]]],
      [TOKEN, [CIDS[0], CIDS[0], CIDS[2]]],
      [TOKEN + 1n, [...CIDS]],
    ];
    for (const [token, cids] of cases) {
      const result = verifyHistoryHash(token, cids, H[2]);
      expect(result.ok).toBe(false);
    }
  });

  it("never throws", () => {
    expect(verifyHistoryHash(TOKEN, [], H[2])).toMatchObject({ ok: false });
    expect(verifyHistoryHash(TOKEN, CIDS, "garbage").ok).toBe(false);
  });
});
