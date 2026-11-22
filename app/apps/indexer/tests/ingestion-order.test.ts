import { describe, expect, it } from "vitest";
import * as schema from "../ponder.schema";
import { type ChainProgress, deriveSummary } from "../src/summary";
import type { FakeStore } from "./fake-store";
import { ARBITRUM, BASE, type Fixture, ingest, roundTrip, SEPOLIA, TOKEN } from "./fixtures";

/**
 * Mandatory: the summary must be identical whichever chain's events were handled first, and no
 * handler may write a row from two chains. The handlers run against an in-memory store; the chains'
 * streams keep their own (block, logIndex) order but are merged in every order we try.
 */

const CHAINS = [ARBITRUM, BASE, SEPOLIA];
const caughtUp: ChainProgress[] = CHAINS.map((chainId) => ({
  chainId,
  indexedBlock: 9_000n,
  latestBlock: 9_000n,
}));

function summarize(store: FakeStore) {
  return deriveSummary({
    deploymentId: "whisky-v2-eval3",
    tokenId: TOKEN,
    rows: store.tokenRows(TOKEN),
    progress: caughtUp,
    configuredChainIds: CHAINS,
  });
}

/** Every table's rows as a canonical, order-free value, to compare stores. */
function snapshot(store: FakeStore) {
  return Object.values(schema).map((table) =>
    store
      .rows(table)
      .map((row) => JSON.stringify(row, (_k, v) => (typeof v === "bigint" ? `${v}n` : v)))
      .sort(),
  );
}

/** Deterministic merge of two per-chain streams that keeps each stream's own order. */
function interleave(a: readonly Fixture[], b: readonly Fixture[], seed: number): Fixture[] {
  let state = seed;
  const next = () => {
    state = (state * 1_103_515_245 + 12_345) & 0x7fffffff;
    return state;
  };
  const out: Fixture[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const takeA = j >= b.length || (i < a.length && next() % 2 === 0);
    const item = takeA ? a[i++] : b[j++];
    if (item) out.push(item);
  }
  return out;
}

describe("ingestion order", () => {
  it("receive processed before send gives the same summary as send before receive", async () => {
    const { arbitrum, base } = roundTrip();
    const sendFirst = await ingest([...arbitrum, ...base]);
    const receiveFirst = await ingest([...base, ...arbitrum]);

    expect(summarize(receiveFirst)).toEqual(summarize(sendFirst));
    expect(snapshot(receiveFirst)).toEqual(snapshot(sendFirst));
    expect(summarize(sendFirst)).toMatchObject({ status: "held", currentChainId: ARBITRUM });
  });

  it("is the same for 200 interleavings of the two chains' streams", async () => {
    const { arbitrum, base } = roundTrip();
    const reference = summarize(await ingest([...arbitrum, ...base]));
    const referenceRows = snapshot(await ingest([...arbitrum, ...base]));

    for (let seed = 1; seed <= 200; seed++) {
      const store = await ingest(interleave(arbitrum, base, seed));
      expect(summarize(store)).toEqual(reference);
      expect(snapshot(store)).toEqual(referenceRows);
    }
  });

  it("reports incomplete, not a guessed location, while only the destination is indexed", async () => {
    const { base } = roundTrip();
    const destinationOnly = await ingest(base);
    const behindOrigin: ChainProgress[] = [
      { chainId: ARBITRUM, indexedBlock: 0n, latestBlock: 1_100n },
      { chainId: BASE, indexedBlock: 9_000n, latestBlock: 9_000n },
      { chainId: SEPOLIA, indexedBlock: 9_000n, latestBlock: 9_000n },
    ];
    const summary = deriveSummary({
      deploymentId: "whisky-v2-eval3",
      tokenId: TOKEN,
      rows: destinationOnly.tokenRows(TOKEN),
      progress: behindOrigin,
      configuredChainIds: CHAINS,
    });
    expect(summary.status).toBe("incomplete");
    expect(summary.currentChainId).toBeNull();
  });

  it("writes no row from two chains", async () => {
    const { arbitrum, base } = roundTrip();
    const store = await ingest(interleave(arbitrum, base, 7));

    expect(store.writers.size).toBeGreaterThan(0);
    for (const chains of store.writers.values()) expect(chains.size).toBe(1);
    // Every stored row carries the chain that wrote it.
    for (const table of Object.values(schema)) {
      for (const row of store.rows<{ chainId: number }>(table)) {
        expect([ARBITRUM, BASE]).toContain(row.chainId);
      }
    }
  });

  it("an import never creates a revision", async () => {
    const { base } = roundTrip();
    const store = await ingest(base.slice(0, 3));
    expect(store.rows(schema.passportRevision)).toHaveLength(0);
    expect(store.rows(schema.revisionObservation)).toHaveLength(1);
  });

  it("replaying the same logs changes nothing", async () => {
    const { arbitrum, base } = roundTrip();
    const once = await ingest([...arbitrum, ...base]);
    const twice = await ingest([
      ...arbitrum,
      ...base,
      ...arbitrum.filter((e) => e.name !== "Transfer"),
    ]);
    expect(summarize(twice)).toEqual(summarize(once));
  });
});
