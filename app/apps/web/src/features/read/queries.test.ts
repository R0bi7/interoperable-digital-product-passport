import { MANIFEST } from "@idpp/passport-config";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  assuranceMessage,
  currentLiveRecord,
  liveQuery,
  passportQuery,
  revisionQueryKey,
} from "./queries";
import { mockSources } from "./sources";
import { verifyPassport } from "./verification";

describe("production reader query boundary", () => {
  it("counts fixture A logical calls: one summary, one live read (2 RPC requests), and one payload/receipt per revision", async () => {
    const mock = mockSources();
    const sources = {
      ...mock,
      getPassport: vi.fn(mock.getPassport),
      readLive: vi.fn(mock.readLive),
      fetchPayload: vi.fn(mock.fetchPayload),
      readReceipt: vi.fn(mock.readReceipt),
    };
    const tokenId = 421614000000000001n;
    const summary = await passportQuery(sources, tokenId)();
    if (!summary || summary.currentChainId === null) throw new Error("fixture has no held chain");
    const live = await liveQuery(sources, summary.currentChainId, tokenId)();
    if (live.revision === null || live.cid === null) throw new Error("fixture has no live record");
    await verifyPassport({
      deploymentId: MANIFEST.deploymentId,
      tokenId: String(tokenId),
      revisions: summary.revisions,
      live: { revision: live.revision, cid: live.cid, historyHash: live.historyHash },
      fetchPayload: sources.fetchPayload,
      readReceipt: sources.readReceipt,
    });
    expect(sources.getPassport).toHaveBeenCalledExactlyOnceWith(tokenId);
    expect(sources.readLive).toHaveBeenCalledExactlyOnceWith(421614, tokenId);
    expect(sources.fetchPayload).toHaveBeenCalledTimes(2);
    expect(sources.readReceipt).toHaveBeenCalledTimes(2);
    // Logical calls only: mock mode makes no HTTP requests. readLive's 2-RPC mapping is checked in live.test.ts.
  });

  it("invalidates verification when receipt metadata changes without a CID change", async () => {
    const summary = await mockSources().getPassport(421614000000000001n);
    if (!summary) throw new Error("fixture missing");
    const rows = summary.revisions;
    const original = revisionQueryKey(rows);
    for (const update of [
      { txHash: "0x123" },
      { author: "0x456" },
      { chainId: 11155111 },
      { conflict: true },
    ]) {
      expect(
        revisionQueryKey(rows.map((row, i) => (i === 0 ? { ...row, ...update } : row))),
      ).not.toBe(original);
    }
  });

  it("uses predeclared assurance banners for failed, in-flight, incomplete and older-tip reads", async () => {
    const sources = mockSources();
    for (const [id, expected] of [
      [
        "421614000000000005",
        "Indexer only: the live read failed. No binding below is confirmed on chain.",
      ],
      [
        "421614000000000002",
        "Indexer only: the token is in flight; no chain holds it to read. No binding below is confirmed on chain.",
      ],
      [
        "84532000000000000",
        "Indexer only: the indexer is incomplete and names no chain to read. No binding below is confirmed on chain.",
      ],
      [
        "421614000000000006",
        "The chain holds revision 0; the indexer lists revision 1. Revisions above 0 are not confirmed on chain.",
      ],
    ] as const) {
      const summary = await sources.getPassport(BigInt(id));
      if (!summary) throw new Error("fixture missing");
      const live =
        summary.currentChainId === null
          ? null
          : await sources.readLive(summary.currentChainId, BigInt(id)).catch(() => null);
      const outcome = await verifyPassport({
        deploymentId: MANIFEST.deploymentId,
        tokenId: id,
        revisions: summary.revisions,
        live:
          live && live.revision !== null && live.cid !== null
            ? { revision: live.revision, cid: live.cid }
            : null,
        fetchPayload: sources.fetchPayload,
        readReceipt: sources.readReceipt,
      });
      expect(assuranceMessage(summary, outcome)).toBe(expected);
    }
  });
});

it("downgrades a successful live sample after a failed refetch retains cached data", async () => {
  const sources = mockSources();
  const id = 421614000000000001n;
  const summary = await sources.getPassport(id);
  if (!summary || summary.currentChainId === null) throw new Error("fixture missing");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const queryKey = ["live-refetch-regression"];
  const cached = await client.fetchQuery({
    queryKey,
    queryFn: liveQuery(sources, summary.currentChainId, id),
  });
  expect(currentLiveRecord({ status: "success", data: cached })).toBe(cached);
  await expect(
    client.fetchQuery({
      queryKey,
      queryFn: async () => {
        throw new Error("RPC unavailable");
      },
    }),
  ).rejects.toThrow("RPC unavailable");
  const state = client.getQueryState<typeof cached>(queryKey);
  if (!state) throw new Error("query state missing");
  expect(state.data).toBe(cached);
  expect(state.status).toBe("error");
  const live = currentLiveRecord(state);
  expect(live).toBeUndefined();
  const outcome = await verifyPassport({
    deploymentId: MANIFEST.deploymentId,
    tokenId: String(id),
    revisions: summary.revisions,
    live:
      live && live.revision !== null && live.cid !== null
        ? { revision: live.revision, cid: live.cid, historyHash: live.historyHash }
        : null,
    liveError: "RPC unavailable",
    fetchPayload: sources.fetchPayload,
    readReceipt: sources.readReceipt,
  });
  expect(outcome.assurance).toBe("indexer-only");
  expect(outcome.entries.every((entry) => entry.binding.status === "unconfirmed")).toBe(true);
  expect(outcome.historyHash.status).toBe("unavailable");
  client.clear();
});
