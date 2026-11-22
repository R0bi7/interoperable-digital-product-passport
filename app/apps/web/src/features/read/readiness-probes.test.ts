import { canonicalBytes, computeCidV1, historyHashOf, MANIFEST } from "@idpp/passport-config";
import { expect, test } from "vitest";
import { mockRevisionReceipt } from "@/lib/indexer/mock";
import { verifyPassport } from "./verification";

const tokenId = "97000000000009";
const base = {
  schema: "idpp-passport/1",
  deploymentId: MANIFEST.deploymentId,
  tokenId,
  revision: "0",
  previousCid: null,
  kind: "cask",
  granularity: "item",
  data: {
    distillery: "Audit",
    caskType: "oak",
    caskNumber: "audit",
    volumeLiters: "1",
    alcoholByVolume: "40",
    fillDate: "2026-10-13",
  },
};
const encoded = (value: unknown) => {
  const bytes = canonicalBytes(value);
  return { bytes, cid: computeCidV1(bytes) };
};

test("an indexer-supplied future revision remains unconfirmed above an older live tip", async () => {
  const original = encoded(base);
  const invented = encoded({ ...base, revision: "1", previousCid: original.cid });
  const bytes = new Map([
    [original.cid, original.bytes],
    [invented.cid, invented.bytes],
  ]);
  const result = await verifyPassport({
    deploymentId: MANIFEST.deploymentId,
    tokenId,
    revisions: [
      { revision: "0", cid: original.cid },
      { revision: "1", cid: invented.cid },
    ],
    live: { revision: "0", cid: original.cid },
    fetchPayload: async (cid) => {
      const payload = bytes.get(cid);
      return payload ? { ok: true, bytes: payload } : { ok: false, reason: "not found" };
    },
  });
  expect(result.entries[1]?.source).toBe("indexed");
  expect(result.entries[1]?.content.status).toBe("verified");
  expect(result.entries[1]?.binding.status).toBe("unconfirmed");
  expect(result.assurance).toBe("live-tip-older");
  expect(result.reason).toBe("above the live tip (revision 0)");
  expect(result.entries[1]?.history.status).toBe("verified");
});

test("a decoy predecessor is rejected by the history hash and original receipt", async () => {
  const recorded = encoded(base);
  const decoy = encoded({ ...base, data: { ...base.data, caskNumber: "never recorded" } });
  const tip = encoded({ ...base, revision: "1", previousCid: decoy.cid });
  expect(recorded.cid).not.toBe(decoy.cid);
  const bytes = new Map([
    [decoy.cid, decoy.bytes],
    [tip.cid, tip.bytes],
  ]);
  const result = await verifyPassport({
    deploymentId: MANIFEST.deploymentId,
    tokenId,
    revisions: [
      {
        revision: "0",
        cid: decoy.cid,
        chainId: 421614,
        author: "0x00000000000000000000000000000000000a11ce",
        txHash: "0x01",
      },
      { revision: "1", cid: tip.cid },
    ],
    live: {
      revision: "1",
      cid: tip.cid,
      historyHash: historyHashOf(tokenId, [recorded.cid, tip.cid]),
    },
    readReceipt: async () =>
      mockRevisionReceipt(tokenId, {
        revision: "0",
        cid: recorded.cid,
        chainId: 421614,
        author: "0x00000000000000000000000000000000000a11ce",
      }),
    fetchPayload: async (cid) => {
      const payload = bytes.get(cid);
      return payload ? { ok: true, bytes: payload } : { ok: false, reason: "not found" };
    },
  });
  expect(result.notes).toEqual([]);
  expect(result.historyHash.status).toBe("failed");
  expect(result.entries[0]?.recorded?.status).toBe("failed");
  expect(
    result.entries.every((e) =>
      [e.content, e.binding, e.history].every((c) => c.status === "verified"),
    ),
  ).toBe(true);
});
