import {
  type ChallengeRecord,
  encodeOwnershipChallenge,
  MANIFEST,
  type OwnershipProof,
  ownershipTypedData,
} from "@idpp/passport-config";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import type { Location, PassportRecord } from "@/features/write/lib/locate";
import {
  checkOwnershipResponse,
  createOwnershipChallenge,
  locateOwnership,
  type OwnershipCheckDeps,
  readSigningChallenge,
} from "./ownership-service";

const owner = privateKeyToAccount(`0x${"11".repeat(32)}`);
const nextOwner = privateKeyToAccount(`0x${"22".repeat(32)}`);
const chain = MANIFEST.chains[0];
if (!chain) throw new Error("manifest has no chains");
const tokenId = BigInt(chain.chainId) * 10n ** 12n + 5n;
const held: PassportRecord = {
  chainId: chain.chainId,
  blockNumber: 123n,
  owner: owner.address,
  revision: 0n,
  cid: "",
  historyHash: `0x${"00".repeat(32)}`,
};
const record: ChallengeRecord = createOwnershipChallenge(
  tokenId.toString(),
  held,
  10000,
  `0x${"ab".repeat(32)}`,
);
const deps = (location: Location = { kind: "not_held", probes: [] }) => ({
  locate: vi.fn(async () => location),
  nextTokenId: vi.fn(async () => tokenId + 1n),
});
async function proof() {
  const response: OwnershipProof = {
    kind: "idpp-ownership-proof",
    v: 1,
    ...record,
    holder: owner.address,
    signature: await owner.signTypedData(ownershipTypedData(record, owner.address)),
  };
  return JSON.stringify(response);
}
const checking = (): OwnershipCheckDeps => ({
  readOwner: vi.fn(async () => owner.address),
  now: vi.fn(() => 10001),
});

describe("locateOwnership", () => {
  it("locates a held token directly from chains, including after a cross-chain send", async () => {
    const other = MANIFEST.chains[1];
    if (!other) throw new Error("manifest needs two chains");
    const located = { ...held, chainId: other.chainId };
    expect(
      await locateOwnership(
        tokenId,
        deps({
          kind: "held",
          record: located,
          probes: [{ chainId: chain.chainId, status: "error", message: "RPC failed" }],
        }),
      ),
    ).toEqual({ kind: "held", record: located });
  });

  it("describes an issued id absent on all chains as in transit", async () => {
    const d = deps({
      kind: "not_held",
      probes: MANIFEST.chains.map((c) => ({ chainId: c.chainId, status: "absent" as const })),
    });
    expect(await locateOwnership(tokenId, d)).toEqual({ kind: "in_transit" });
    expect(d.nextTokenId).toHaveBeenCalledWith(chain.chainId);
  });

  it("describes an unissued id as unknown, never in transit", async () => {
    const d = deps();
    d.nextTokenId.mockResolvedValue(tokenId);
    expect(await locateOwnership(tokenId, d)).toMatchObject({
      kind: "unknown",
      reason: expect.stringContaining("never minted"),
    });
  });

  it("rejects an unknown namespace without RPC calls", async () => {
    const d = deps();
    expect(await locateOwnership(999000000000001n, d)).toMatchObject({ kind: "unknown" });
    expect(d.locate).not.toHaveBeenCalled();
    expect(d.nextTokenId).not.toHaveBeenCalled();
  });

  it("never describes a failed read as in transit", async () => {
    const d = deps({ kind: "unknown", probes: [], reason: "chain unavailable" });
    expect(await locateOwnership(tokenId, d)).toMatchObject({ kind: "error" });
    d.locate.mockResolvedValue({
      kind: "not_held",
      probes: [{ chainId: chain.chainId, status: "error", message: "RPC failed" }],
    });
    expect(await locateOwnership(tokenId, d)).toMatchObject({ kind: "error" });
    d.locate.mockRejectedValue(new Error("RPC failed"));
    expect(await locateOwnership(tokenId, d)).toMatchObject({ kind: "error" });
  });

  it("reports an issuing-chain counter read failure as an error", async () => {
    const d = deps();
    d.nextTokenId.mockRejectedValue(new Error("RPC failed"));
    expect(await locateOwnership(tokenId, d)).toMatchObject({ kind: "error" });
  });
});

describe("ownership challenge preparation", () => {
  it("creates a two-minute nonce-bound challenge for the actual holding contract", () => {
    expect(record).toEqual({
      tokenId: tokenId.toString(),
      chainId: chain.chainId,
      contract: chain.address,
      nonce: `0x${"ab".repeat(32)}`,
      expiresAt: "10120",
    });
    expect(readSigningChallenge(encodeOwnershipChallenge(record), 10000)).toEqual(record);
  });

  it("refuses foreign contracts, chains and expired challenges before signing", () => {
    for (const change of [
      { chainId: 1 },
      { contract: owner.address },
      { expiresAt: "10000" },
      { tokenId: "999000000000001" },
    ]) {
      expect(() =>
        readSigningChallenge(encodeOwnershipChallenge({ ...record, ...change }), 10000),
      ).toThrow();
    }
    expect(() => readSigningChallenge("not a challenge", 10000)).toThrow();
  });
});

describe("checkOwnershipResponse", () => {
  it("reads owner after decoding the response and takes now after that read", async () => {
    let readFinished = false;
    const d = checking();
    d.readOwner = vi.fn(async () => {
      readFinished = true;
      return owner.address;
    });
    d.now = vi.fn(() => {
      expect(readFinished).toBe(true);
      return 10001;
    });
    const consumed = new Set<string>();
    expect(await checkOwnershipResponse(await proof(), record, consumed, d)).toEqual({
      ok: true,
      signer: owner.address,
    });
    expect(d.readOwner).toHaveBeenCalledWith(record);
    expect(consumed.has(record.nonce)).toBe(true);
  });

  it("refuses the same proof twice without another read", async () => {
    const d = checking();
    const consumed = new Set<string>();
    const text = await proof();
    expect((await checkOwnershipResponse(text, record, consumed, d)).ok).toBe(true);
    expect(await checkOwnershipResponse(text, record, consumed, d)).toEqual({
      ok: false,
      code: "already_used",
    });
    expect(d.readOwner).toHaveBeenCalledTimes(1);
  });

  it("consumes only once when scans race across the fresh owner read", async () => {
    const d = checking();
    const consumed = new Set<string>();
    const text = await proof();
    const results = await Promise.all([
      checkOwnershipResponse(text, record, consumed, d),
      checkOwnershipResponse(text, record, consumed, d),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.code === "already_used")).toHaveLength(1);
  });

  it("uses the fresh owner, refusing a transfer after signing", async () => {
    const d = checking();
    d.readOwner = async () => nextOwner.address;
    expect(await checkOwnershipResponse(await proof(), record, new Set(), d)).toEqual({
      ok: false,
      code: "owner_mismatch",
    });
  });

  it("checks expiry after a slow RPC response", async () => {
    const d = checking();
    d.now = () => 10120;
    expect(await checkOwnershipResponse(await proof(), record, new Set(), d)).toEqual({
      ok: false,
      code: "expired",
    });
  });

  it("reports RPC failure as an error and keeps the nonce usable", async () => {
    const consumed = new Set<string>();
    const d = checking();
    d.readOwner = async () => {
      throw new Error("RPC unavailable");
    };
    expect(await checkOwnershipResponse(await proof(), record, consumed, d)).toEqual({
      ok: false,
      code: "chain_unavailable",
    });
    expect(consumed.size).toBe(0);
  });

  it("never accepts a scanned chain or contract as the read target", async () => {
    const text = JSON.stringify({
      ...JSON.parse(await proof()),
      chainId: 1,
      contract: nextOwner.address,
    });
    const d = checking();
    expect(await checkOwnershipResponse(text, record, new Set(), d)).toEqual({
      ok: false,
      code: "wrong_chain",
    });
    expect(d.readOwner).toHaveBeenCalledWith(record);
  });

  it("rejects malformed responses without a read or nonce consumption", async () => {
    const d = checking();
    const consumed = new Set<string>();
    expect(await checkOwnershipResponse("not JSON", record, consumed, d)).toEqual({
      ok: false,
      code: "invalid_proof",
    });
    expect(d.readOwner).not.toHaveBeenCalled();
    expect(consumed.size).toBe(0);
  });
});
