import { MANIFEST } from "@idpp/passport-config";
import { describe, expect, it } from "vitest";
import { loadMockPassports, mockGatewayBytes } from "@/lib/indexer/mock";
import { payloadRows } from "./payload-rows";
import { verifyPassport } from "./verification";

const MOCK_PASSPORTS = await loadMockPassports();

async function envelopeOf(tokenId: string) {
  const fixture = MOCK_PASSPORTS.find((p) => p.summary.tokenId === tokenId);
  const { entries } = await verifyPassport({
    deploymentId: MANIFEST.deploymentId,
    tokenId,
    revisions: fixture?.summary.revisions ?? [],
    fetchPayload: async (cid) => {
      const bytes = await mockGatewayBytes(cid);
      return bytes ? { ok: true, bytes } : { ok: false, reason: "not found" };
    },
  });
  return entries[0]?.envelope;
}

describe("payloadRows", () => {
  it("lists cask fields and marks the fill date as a domain assertion", async () => {
    const envelope = await envelopeOf("421614000000000001");
    const rows = payloadRows(envelope as NonNullable<typeof envelope>);
    expect(rows.find((r) => r.label === "Distillery")?.value).toBe("Demo Distillery");
    expect(rows.find((r) => r.label === "Fill date")).toMatchObject({
      value: "2026-10-01",
      domainDate: true,
    });
    expect(rows.find((r) => r.label === "Origin region")?.value).toBe("Speyside");
  });

  it("lists bottle fields with source casks linking to their passports", async () => {
    const envelope = await envelopeOf("421614000000000002");
    const rows = payloadRows(envelope as NonNullable<typeof envelope>);
    expect(rows.find((r) => r.label === "Bottled date")?.domainDate).toBe(true);
    expect(rows.find((r) => r.label === "Source cask")?.tokenId).toBe("421614000000000001");
  });
});
