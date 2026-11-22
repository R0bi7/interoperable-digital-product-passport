import { MANIFEST } from "@idpp/passport-config";
import { describe, expect, it } from "vitest";
import { loadMockPassports, mockGatewayBytes, mockReceipt } from "@/lib/indexer/mock";
import { verifyPassport } from "./verification";

const MOCK_PASSPORTS = await loadMockPassports();

async function run(tokenId: string) {
  const fixture = MOCK_PASSPORTS.find((p) => p.summary.tokenId === tokenId);
  if (!fixture) throw new Error(`no fixture ${tokenId}`);
  const live =
    !fixture.liveError && fixture.live
      ? {
          revision: fixture.live.revision,
          cid: fixture.live.cid,
          historyHash: fixture.live.historyHash,
        }
      : null;
  return verifyPassport({
    deploymentId: MANIFEST.deploymentId,
    tokenId,
    revisions: fixture.summary.revisions,
    live,
    readReceipt: mockReceipt,
    fetchPayload: async (cid) => {
      const bytes = await mockGatewayBytes(cid);
      return bytes ? { ok: true, bytes } : { ok: false, reason: "not found" };
    },
  });
}

const statuses = (e: Awaited<ReturnType<typeof run>>["entries"][number]) =>
  [e.content.status, e.binding.status, e.history.status] as const;

describe("mock fixtures through the browser verification", () => {
  it("round-trip token: every revision verified on all three checks", async () => {
    const { entries, historyHash, notes } = await run("421614000000000001");
    expect(notes).toEqual([]);
    expect(historyHash.status).toBe("verified");
    expect(entries.map(statuses)).toEqual([
      ["verified", "verified", "verified"],
      ["verified", "verified", "verified"],
    ]);
    expect(entries[1]?.source).toBe("live");
  });

  it("in-flight token: indexed binding is unconfirmed, historical receipt is verified", async () => {
    const { entries, historyHash } = await run("421614000000000002");
    expect(entries.map(statuses)).toEqual([["verified", "unconfirmed", "verified"]]);
    expect(entries[0]?.recorded.status).toBe("verified");
    expect(historyHash).toMatchObject({
      status: "unavailable",
      reason: "no live read of passportOf",
    });
    expect(entries[0]?.source).toBe("indexed");
    expect(entries[0]?.envelope?.kind).toBe("bottle");
  });

  it("incomplete token with a payload missing on the gateway: all unavailable", async () => {
    const { entries } = await run("84532000000000000");
    expect(entries.map(statuses)).toEqual([["unavailable", "unavailable", "unavailable"]]);
  });

  it("tampered bytes: content failed on revision 1, revision 0 intact", async () => {
    const { entries, historyHash } = await run("84532000000000001");
    expect(statuses(entries[0] as never)).toEqual(["verified", "verified", "verified"]);
    expect(statuses(entries[1] as never)).toEqual(["failed", "unavailable", "unavailable"]);
    // the CIDs are the recorded ones; only the bytes the gateway serves are wrong
    expect(historyHash.status).toBe("verified");
  });

  it("envelope naming another token: binding failed, content verified", async () => {
    const { entries } = await run("11155111000000000000");
    expect(statuses(entries[0] as never)).toEqual(["verified", "failed", "verified"]);
  });

  it("wrong previousCid: history failed on revision 1", async () => {
    const { entries } = await run("11155111000000000001");
    expect(statuses(entries[0] as never)).toEqual(["verified", "verified", "verified"]);
    expect(statuses(entries[1] as never)).toEqual(["verified", "verified", "failed"]);
  });

  it("indexer behind: the unindexed live revision is verified and noted", async () => {
    const { entries, notes } = await run("421614000000000003");
    expect(entries).toHaveLength(2);
    expect(entries[1]?.source).toBe("live-only");
    expect(entries.map(statuses)).toEqual([
      ["verified", "verified", "verified"],
      ["verified", "verified", "verified"],
    ]);
    expect(notes[0]).toContain("not indexed yet");
    expect((await run("421614000000000003")).historyHash.status).toBe("verified");
  });

  it("decoy revision 0: content, binding and history pass, the history hash fails", async () => {
    const { entries, historyHash } = await run("421614000000000004");
    expect(entries.map(statuses)).toEqual([
      ["verified", "verified", "verified"],
      ["verified", "verified", "verified"],
    ]);
    expect(entries[0]?.recorded.status).toBe("failed");
    expect(historyHash.status).toBe("failed");
    expect(historyHash.reason).toContain("the chain holds");
  });
  it("live failure leaves every binding unconfirmed and receipts verified", async () => {
    const result = await run("421614000000000005");
    expect(result.assurance).toBe("indexer-only");
    expect(result.entries.map((entry) => entry.binding.status)).toEqual([
      "unconfirmed",
      "unconfirmed",
    ]);
    expect(result.entries.map((entry) => entry.recorded.status)).toEqual(["verified", "verified"]);
  });

  it("older live tip confirms its prefix, and keeps the later receipt independent", async () => {
    const result = await run("421614000000000006");
    expect(result.assurance).toBe("live-tip-older");
    expect(result.historyHash.status).toBe("verified");
    expect(result.entries.map((entry) => entry.binding.status)).toEqual([
      "verified",
      "unconfirmed",
    ]);
    expect(result.entries.map((entry) => entry.recorded.status)).toEqual(["verified", "verified"]);
  });
});
