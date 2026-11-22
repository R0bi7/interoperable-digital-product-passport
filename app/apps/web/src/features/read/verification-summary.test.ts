import { MANIFEST } from "@idpp/passport-config";
import { expect, it } from "vitest";
import { mockSources } from "./sources";
import { verifyPassport } from "./verification";
import { verificationSummary } from "./verification-summary";

const sources = mockSources();
async function result(id: string) {
  const summary = await sources.getPassport(BigInt(id));
  if (!summary) throw new Error("fixture missing");
  const live =
    summary.currentChainId == null
      ? null
      : await sources.readLive(summary.currentChainId, BigInt(id)).catch(() => null);
  const outcome = await verifyPassport({
    deploymentId: MANIFEST.deploymentId,
    tokenId: id,
    revisions: summary.revisions,
    live:
      live?.revision && live.cid
        ? { revision: live.revision, cid: live.cid, historyHash: live.historyHash }
        : null,
    readReceipt: sources.readReceipt,
    fetchPayload: sources.fetchPayload,
  });
  return { outcome, summary: verificationSummary(outcome) };
}
it("explains a fully checked record while qualifying discovery disagreements", async () => {
  const { outcome, summary } = await result("421614000000000001");
  expect(summary.tone).toBe("ok");
  expect(verificationSummary(outcome, true).tone).toBe("warn");
});
it("prioritizes tampering over checks that could not run", async () => {
  for (const id of ["84532000000000001", "11155111000000000000", "421614000000000004"]) {
    const { summary } = await result(id);
    expect(summary.tone).toBe("error");
    expect(summary.details.some((d) => d.startsWith("Failed check:"))).toBe(true);
  }
});
it("never reports unavailable or in-flight evidence as fully verified", async () => {
  for (const id of [
    "421614000000000002",
    "84532000000000000",
    "421614000000000005",
    "421614000000000006",
  ])
    expect((await result(id)).summary.tone).toBe("warn");
});
it("does not turn an empty result into success", () => {
  expect(
    verificationSummary({
      assurance: "live",
      entries: [],
      historyHash: { status: "verified" },
      notes: [],
    }).tone,
  ).toBe("warn");
});
