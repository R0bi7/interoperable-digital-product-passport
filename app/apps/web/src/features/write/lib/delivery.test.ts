import { describe, expect, it, vi } from "vitest";
import {
  DELIVERY_HTTP_TIMEOUT_MS,
  deriveProgress,
  fetchIndexerObservation,
  fetchScanStatus,
  type ProgressInput,
} from "@/features/write/lib/delivery";

const RECEIVER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const CID = "bafkreibnugdjrt4xfyb4untqebjbktbq7lhbbxbiwtlgcefchoioao6dhm";
const GUID = `0x${"ab".repeat(32)}`;

const json = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("fetchScanStatus", () => {
  it("reads the first message status", async () => {
    const fetchImpl = json({ data: [{ status: { name: "INFLIGHT", message: "waiting" } }] });
    expect(await fetchScanStatus("0xabc", fetchImpl)).toEqual({
      state: "found",
      name: "INFLIGHT",
      message: "waiting",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://scan-testnet.layerzero-api.com/v1/messages/tx/0xabc",
      { signal: expect.any(AbortSignal) },
    );
  });

  it("distinguishes not indexed, HTTP errors and network errors", async () => {
    expect(await fetchScanStatus("0x", json({ data: [] }))).toEqual({ state: "not_indexed" });
    expect(await fetchScanStatus("0x", json({}, 404))).toEqual({ state: "not_indexed" });
    expect(await fetchScanStatus("0x", json({}, 500))).toMatchObject({ state: "unreachable" });
    const failing = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await fetchScanStatus("0x", failing)).toEqual({
      state: "unreachable",
      reason: "offline",
    });
  });
});

describe("fetchIndexerObservation", () => {
  const timeline = (entries: unknown[]) => json({ timeline: entries });

  it("is received only for a received entry with this guid", async () => {
    const fetchImpl = timeline([
      { kind: "sent", guid: GUID, chainId: 421614 },
      {
        kind: "received",
        guid: GUID.toUpperCase().replace("0X", "0x"),
        chainId: 84532,
        txHash: "0xd",
      },
    ]);
    expect(await fetchIndexerObservation("http://i/", "970", GUID, fetchImpl)).toEqual({
      state: "received",
      chainId: 84532,
      txHash: "0xd",
    });
    expect(fetchImpl).toHaveBeenCalledWith("http://i/api/passports/970", {
      signal: expect.any(AbortSignal),
    });
  });

  it("does not read the discriminator from a type field", async () => {
    const fetchImpl = timeline([{ type: "received", guid: GUID, chainId: 1 }]);
    expect((await fetchIndexerObservation("http://i", "1", GUID, fetchImpl)).state).toBe("not_yet");
  });

  it("ignores a send entry and a received entry of another transfer", async () => {
    const fetchImpl = timeline([
      { kind: "sent", guid: GUID },
      { kind: "received", guid: `0x${"cd".repeat(32)}` },
    ]);
    expect(await fetchIndexerObservation("http://i", "1", GUID, fetchImpl)).toEqual({
      state: "not_yet",
    });
  });

  it("the panel clock requires destination placement as well as this transfer's receive", async () => {
    const entries = [{ kind: "received", guid: GUID, chainId: 84532 }];
    for (const placement of [
      { status: "in_flight", currentChainId: null },
      { status: "held", currentChainId: 421614 },
    ]) {
      expect(
        await fetchIndexerObservation(
          "http://i",
          "1",
          GUID,
          json({ ...placement, timeline: entries }),
          84532,
        ),
      ).toEqual({ state: "not_yet" });
    }
    expect(
      await fetchIndexerObservation(
        "http://i",
        "1",
        GUID,
        json({ status: "held", currentChainId: 84532, timeline: entries }),
        84532,
      ),
    ).toMatchObject({ state: "received", chainId: 84532 });
  });

  it("makes no request without an indexer URL (mock mode)", async () => {
    const fetchImpl = timeline([{ kind: "received", guid: GUID, chainId: 1 }]);
    expect(await fetchIndexerObservation(undefined, "1", GUID, fetchImpl)).toEqual({
      state: "unavailable",
      reason: "no indexer configured",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports an unavailable indexer instead of failing", async () => {
    expect(await fetchIndexerObservation("http://i", "1", GUID, json({}, 502))).toMatchObject({
      state: "unavailable",
    });
    expect(await fetchIndexerObservation("http://i", "1", GUID, json({}, 404))).toEqual({
      state: "not_yet",
    });
  });
});

describe("deriveProgress", () => {
  const base: ProgressInput = {
    sourceReceipt: "waiting",
    receiver: RECEIVER,
    sent: { revision: 1n, cid: CID },
    timedOut: false,
  };

  it("keeps pending, observed and confirmed independent", () => {
    // Source confirmed; scan says delivered; destination not read as owned yet.
    const view = deriveProgress({
      ...base,
      sourceReceipt: "success",
      scan: { state: "found", name: "DELIVERED" },
      indexer: { state: "not_yet" },
      destination: { state: "absent", blockNumber: 10n },
    });
    expect(view.pending.state).toBe("done");
    expect(view.observed.state).toBe("done");
    expect(view.confirmed.state).toBe("waiting");
    expect(view.confirmed.detail).toContain("block 10");
  });

  it("confirms only from the live destination read, not from scan or indexer", () => {
    const view = deriveProgress({
      ...base,
      sourceReceipt: "success",
      scan: { state: "found", name: "INFLIGHT" },
      indexer: { state: "not_yet" },
      destination: { state: "present", blockNumber: 99n, owner: RECEIVER, revision: 1n, cid: CID },
    });
    expect(view.observed.state).toBe("waiting");
    expect(view.confirmed).toMatchObject({ state: "done", snapshotMatches: true });
    expect(view.confirmed.detail).toContain("block 99");
  });

  it("observes through the indexer alone", () => {
    const view = deriveProgress({
      ...base,
      sourceReceipt: "success",
      scan: { state: "unreachable", reason: "x" },
      indexer: { state: "received", chainId: 84532 },
    });
    expect(view.observed.state).toBe("done");
  });

  it("flags a destination snapshot that differs from the sent one", () => {
    const view = deriveProgress({
      ...base,
      sourceReceipt: "success",
      destination: { state: "present", blockNumber: 1n, owner: RECEIVER, revision: 2n, cid: CID },
    });
    expect(view.confirmed.snapshotMatches).toBe(false);
    expect(view.confirmed.detail).toContain("DIFFERS");
  });

  it("does not confirm when another account owns the token on the destination", () => {
    const view = deriveProgress({
      ...base,
      sourceReceipt: "success",
      destination: {
        state: "present",
        blockNumber: 1n,
        owner: "0x000000000000000000000000000000000000dEaD",
        revision: 1n,
        cid: CID,
      },
    });
    expect(view.confirmed.state).toBe("waiting");
  });

  it("on timeout reads 'not yet observed', never 'failed'", () => {
    const view = deriveProgress({
      ...base,
      sourceReceipt: "success",
      scan: { state: "found", name: "FAILED", message: "simulation reverted" },
      indexer: { state: "not_yet" },
      destination: { state: "absent", blockNumber: 5n },
      timedOut: true,
    });
    expect(view.headline).toBe("Delivery not yet observed.");
    expect(JSON.stringify(view).toLowerCase()).not.toMatch(/delivery failed|transfer failed/);
    expect(view.confirmed.state).toBe("waiting");
  });

  it("reports a reverted source transaction", () => {
    const view = deriveProgress({ ...base, sourceReceipt: "reverted" });
    expect(view.pending.state).toBe("unavailable");
    expect(view.headline).toContain("reverted");
  });
});

describe("bounded delivery HTTP", () => {
  it("bounds stalled response headers and aborts both independent auxiliary requests", async () => {
    vi.useFakeTimers();
    try {
      const stalled = vi.fn(() => new Promise<Response>(() => {}));
      const scan = fetchScanStatus("0x1", stalled as typeof fetch);
      const indexer = fetchIndexerObservation(
        "http://i",
        "1",
        GUID,
        stalled as typeof fetch,
        84532,
      );
      await vi.advanceTimersByTimeAsync(DELIVERY_HTTP_TIMEOUT_MS);
      expect(await scan).toMatchObject({
        state: "unreachable",
        reason: expect.stringContaining("timed out"),
      });
      expect(await indexer).toMatchObject({
        state: "unavailable",
        reason: expect.stringContaining("timed out"),
      });
      for (const call of vi.mocked(stalled as typeof fetch).mock.calls)
        expect(call[1]?.signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("applies the same deadline to a response body that never finishes", async () => {
    vi.useFakeTimers();
    try {
      const stalledBody = vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: () => new Promise<never>(() => {}),
          }) as unknown as Response,
      );
      const scan = fetchScanStatus("0x1", stalledBody as typeof fetch);
      const indexer = fetchIndexerObservation(
        "http://i",
        "1",
        GUID,
        stalledBody as typeof fetch,
        84532,
      );
      await vi.advanceTimersByTimeAsync(DELIVERY_HTTP_TIMEOUT_MS);
      expect((await scan).state).toBe("unreachable");
      expect((await indexer).state).toBe("unavailable");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
