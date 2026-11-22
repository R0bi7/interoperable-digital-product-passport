import { describe, expect, it } from "vitest";
import { type ChainProgress, deriveSummary, lagToleranceBlocks } from "../src/summary";
import {
  ALICE,
  ARBITRUM,
  BASE,
  BOB,
  CAROL,
  CID0,
  CID1,
  CID2,
  fx,
  guid,
  ingest,
  OPERATOR,
  roundTrip,
  SEPOLIA,
  TOKEN,
  ZERO,
} from "./fixtures";

const CHAINS = [ARBITRUM, BASE, SEPOLIA];

const caughtUp: ChainProgress[] = CHAINS.map((chainId) => ({
  chainId,
  indexedBlock: 9_000n,
  latestBlock: 9_000n,
}));

async function summaryOf(
  fixtures: Parameters<typeof ingest>[0],
  progress: readonly ChainProgress[] = caughtUp,
) {
  const store = await ingest(fixtures);
  return deriveSummary({
    deploymentId: "whisky-v2-eval3",
    tokenId: TOKEN,
    rows: store.tokenRows(TOKEN),
    progress,
    configuredChainIds: CHAINS,
  });
}

/** Mint on ARBITRUM (rev 0), send to Base Sepolia; the receive is the first three Base Sepolia logs. */
function oneWay() {
  const { arbitrum, base } = roundTrip();
  return { arbitrum: arbitrum.slice(0, 5), base: base.slice(0, 3) };
}

describe("deriveSummary", () => {
  it("one-way transfer: held on the destination, whichever side was indexed first", async () => {
    const { arbitrum, base } = oneWay();
    const sendFirst = await summaryOf([...arbitrum, ...base]);
    const receiveFirst = await summaryOf([...base, ...arbitrum]);

    expect(receiveFirst).toEqual(sendFirst);
    expect(sendFirst).toMatchObject({
      deploymentId: "whisky-v2-eval3",
      tokenId: "421614000000000006",
      originChainId: 421614,
      currentChainId: BASE,
      status: "held",
      owner: BOB,
      revision: "1",
      cid: CID1,
    });
    expect(sendFirst.timeline.map((e) => e.kind)).toEqual([
      "issued",
      "revised",
      "sent",
      "received",
    ]);
  });

  it("round trip without a revision on the way back: two sends, two receives joined by guid", async () => {
    const { arbitrum, base } = roundTrip();
    // Drop the revision on Base Sepolia; the token returns with revision 1 (Imported cid is the same).
    const withoutRevision = base.filter((e) => e.name !== "PassportRevised");
    const returning = arbitrum.map((e) =>
      e.name === "PassportImported" ? { ...e, args: { ...e.args, revision: 1n, cid: CID1 } } : e,
    );
    const summary = await summaryOf([...returning, ...withoutRevision]);

    expect(summary).toMatchObject({
      status: "held",
      currentChainId: ARBITRUM,
      owner: CAROL,
      revision: "1",
      cid: CID1,
    });
    const sent = summary.timeline.filter((e) => e.kind === "sent");
    const received = summary.timeline.filter((e) => e.kind === "received");
    expect(sent.map((e) => "guid" in e && e.guid)).toEqual([guid(1), guid(2)]);
    expect(received.map((e) => "guid" in e && e.guid)).toEqual([guid(1), guid(2)]);
    expect(summary.revisions.map((r) => r.revision)).toEqual(["0", "1"]);
    expect(summary.revisions.every((r) => !r.conflict)).toBe(true);
  });

  it("round trip with revisions: ordered revisions and timeline, held on the final chain", async () => {
    const { arbitrum, base } = roundTrip();
    const summary = await summaryOf([...base, ...arbitrum]);

    expect(summary).toMatchObject({ status: "held", currentChainId: ARBITRUM, owner: CAROL });
    expect(summary.revisions).toEqual([
      {
        revision: "0",
        cid: CID0,
        chainId: ARBITRUM,
        author: OPERATOR,
        txHash: expect.any(String),
        timestamp: "100",
        conflict: false,
      },
      expect.objectContaining({ revision: "1", cid: CID1, chainId: ARBITRUM, author: ALICE }),
      expect.objectContaining({ revision: "2", cid: CID2, chainId: BASE, author: BOB }),
    ]);
    expect(summary.timeline.map((e) => `${e.kind}@${e.chainId}`)).toEqual([
      "issued@421614",
      "revised@421614",
      "sent@421614",
      "received@84532",
      "revised@84532",
      "sent@84532",
      "received@421614",
    ]);
    expect(summary.revision).toBe("2");
    expect(summary.cid).toBe(CID2);
  });

  it("revisions made on three chains come out in order", async () => {
    const e = [
      fx(
        ARBITRUM,
        "PassportIssued",
        { tokenId: TOKEN, cid: CID0 },
        { block: 1, ts: 10, log: 0, tx: 1, from: OPERATOR },
      ),
      fx(
        ARBITRUM,
        "Transfer",
        { from: ZERO, to: ALICE, tokenId: TOKEN },
        { block: 1, ts: 10, log: 1, tx: 1 },
      ),
      fx(
        ARBITRUM,
        "Transfer",
        { from: ALICE, to: ZERO, tokenId: TOKEN },
        { block: 2, ts: 20, log: 0, tx: 2 },
      ),
      fx(
        ARBITRUM,
        "ONFTSent",
        { guid: guid(1), dstEid: 40245, fromAddress: ALICE, tokenId: TOKEN },
        { block: 2, ts: 20, log: 1, tx: 2 },
      ),
      fx(
        BASE,
        "Transfer",
        { from: ZERO, to: BOB, tokenId: TOKEN },
        { block: 7, ts: 30, log: 0, tx: 3 },
      ),
      fx(
        BASE,
        "PassportImported",
        { tokenId: TOKEN, revision: 0n, cid: CID0 },
        { block: 7, ts: 30, log: 1, tx: 3 },
      ),
      fx(
        BASE,
        "ONFTReceived",
        { guid: guid(1), srcEid: 40231, toAddress: BOB, tokenId: TOKEN },
        { block: 7, ts: 30, log: 2, tx: 3 },
      ),
      fx(
        BASE,
        "PassportRevised",
        { tokenId: TOKEN, revision: 1n, cid: CID1, author: BOB },
        { block: 8, ts: 40, log: 0, tx: 4, from: BOB },
      ),
      fx(
        BASE,
        "Transfer",
        { from: BOB, to: ZERO, tokenId: TOKEN },
        { block: 9, ts: 50, log: 0, tx: 5 },
      ),
      fx(
        BASE,
        "ONFTSent",
        { guid: guid(2), dstEid: 40161, fromAddress: BOB, tokenId: TOKEN },
        { block: 9, ts: 50, log: 1, tx: 5 },
      ),
      fx(
        SEPOLIA,
        "Transfer",
        { from: ZERO, to: CAROL, tokenId: TOKEN },
        { block: 3, ts: 60, log: 0, tx: 6 },
      ),
      fx(
        SEPOLIA,
        "PassportImported",
        { tokenId: TOKEN, revision: 1n, cid: CID1 },
        { block: 3, ts: 60, log: 1, tx: 6 },
      ),
      fx(
        SEPOLIA,
        "ONFTReceived",
        { guid: guid(2), srcEid: 40245, toAddress: CAROL, tokenId: TOKEN },
        { block: 3, ts: 60, log: 2, tx: 6 },
      ),
      fx(
        SEPOLIA,
        "PassportRevised",
        { tokenId: TOKEN, revision: 2n, cid: CID2, author: CAROL },
        { block: 4, ts: 70, log: 0, tx: 7, from: CAROL },
      ),
    ];
    const forward = await summaryOf(e);
    const reversed = await summaryOf([
      ...e.filter((x) => x.chainId === SEPOLIA),
      ...e.filter((x) => x.chainId === BASE),
      ...e.filter((x) => x.chainId === ARBITRUM),
    ]);

    expect(reversed).toEqual(forward);
    expect(forward.status).toBe("held");
    expect(forward.currentChainId).toBe(SEPOLIA);
    expect(forward.revisions.map((r) => [r.revision, r.chainId])).toEqual([
      ["0", ARBITRUM],
      ["1", BASE],
      ["2", SEPOLIA],
    ]);
  });

  it("a PassportImported that disagrees with the revision flags a conflict and is incomplete", async () => {
    const { arbitrum, base } = roundTrip();
    const tampered = base.map((e) =>
      e.name === "PassportImported" ? { ...e, args: { ...e.args, cid: "bafkreiEVIL" } } : e,
    );
    const a = await summaryOf([...arbitrum, ...tampered]);
    const b = await summaryOf([...tampered, ...arbitrum]);

    expect(b).toEqual(a);
    expect(a.status).toBe("incomplete");
    expect(a.revisions.find((r) => r.revision === "1")?.conflict).toBe(true);
    expect(a.revisions.find((r) => r.revision === "0")?.conflict).toBe(false);
    // The original record is never overwritten by the observation.
    expect(a.revisions.find((r) => r.revision === "1")?.cid).toBe(CID1);
  });

  it("a lagging chain gives incomplete and no location", async () => {
    const { arbitrum, base } = roundTrip();
    const lagging: ChainProgress[] = [
      { chainId: ARBITRUM, indexedBlock: 1_100n, latestBlock: 1_200n },
      { chainId: BASE, indexedBlock: 9_000n, latestBlock: 9_000n },
      { chainId: SEPOLIA, indexedBlock: 9_000n, latestBlock: 9_000n },
    ];
    const summary = await summaryOf([...arbitrum, ...base], lagging);

    expect(summary.status).toBe("incomplete");
    expect(summary.currentChainId).toBeNull();
    expect(summary.owner).toBeNull();
    expect(summary.progress).toHaveLength(3);
  });

  it("tolerates a lag worth eight seconds of blocks per chain, not more", async () => {
    const { arbitrum, base } = roundTrip();
    const at = (lag: bigint): ChainProgress[] =>
      CHAINS.map((chainId) => ({ chainId, indexedBlock: 9_000n - lag, latestBlock: 9_000n }));
    // Sepolia (12 s blocks) tolerates one block, so a uniform lag of 1 is fine and 2 is not.
    expect((await summaryOf([...arbitrum, ...base], at(1n))).status).toBe("held");
    expect((await summaryOf([...arbitrum, ...base], at(2n))).status).toBe("incomplete");
    // Arbitrum Sepolia (0.25 s blocks) alone may lag by 32 blocks, not 33.
    const arbitrumOnly = (lag: bigint): ChainProgress[] =>
      CHAINS.map((chainId) => ({
        chainId,
        indexedBlock: chainId === ARBITRUM ? 9_000n - lag : 9_000n,
        latestBlock: 9_000n,
      }));
    expect((await summaryOf([...arbitrum, ...base], arbitrumOnly(32n))).status).toBe("held");
    expect((await summaryOf([...arbitrum, ...base], arbitrumOnly(33n))).status).toBe("incomplete");
  });

  it("derives the tolerance in blocks from the chain's block time", () => {
    expect(lagToleranceBlocks(421614)).toBe(32n);
    expect(lagToleranceBlocks(84532)).toBe(40n);
    expect(lagToleranceBlocks(ARBITRUM)).toBe(32n);
    expect(lagToleranceBlocks(BASE)).toBe(40n);
    expect(lagToleranceBlocks(SEPOLIA)).toBe(1n);
    expect(lagToleranceBlocks(999_999)).toBe(1n);
  });

  it("keeps the eight-second Base Sepolia cutoff after the 200ms block upgrade", async () => {
    const { arbitrum, base } = roundTrip();
    const baseLag = (lag: bigint) =>
      caughtUp.map((p) => ({
        ...p,
        indexedBlock: p.chainId === BASE ? p.latestBlock - lag : p.indexedBlock,
      }));
    expect((await summaryOf([...arbitrum, ...base], baseLag(40n))).status).toBe("held");
    expect((await summaryOf([...arbitrum, ...base], baseLag(41n))).status).toBe("incomplete");
  });

  it("a chain without known progress counts as behind", async () => {
    const { arbitrum, base } = roundTrip();
    const summary = await summaryOf(
      [...arbitrum, ...base],
      caughtUp.filter((p) => p.chainId !== SEPOLIA),
    );
    expect(summary.status).toBe("incomplete");
    expect(summary.progress.map((p) => p.chainId)).toEqual([BASE, ARBITRUM]);
  });

  it("in flight: the newest send has no receive and no chain holds the token", async () => {
    const { arbitrum } = oneWay();
    const summary = await summaryOf(arbitrum);
    expect(summary).toMatchObject({
      status: "in_flight",
      currentChainId: null,
      owner: null,
      revision: null,
      cid: null,
    });
  });

  it("incomplete when two chains claim the token", async () => {
    const { arbitrum } = oneWay();
    const duplicate = fx(
      BASE,
      "Transfer",
      { from: ZERO, to: BOB, tokenId: TOKEN },
      { block: 5, ts: 130, log: 0, tx: 9 },
    );
    // ARBITRUM still shows the token (no send), Base Sepolia claims it too.
    const summary = await summaryOf([...arbitrum.slice(0, 2), duplicate]);
    expect(summary.status).toBe("incomplete");
    expect(summary.currentChainId).toBeNull();
  });

  it("a transfer between holders on one chain is a timeline entry, not a revision", async () => {
    const { arbitrum } = oneWay();
    const move = fx(
      ARBITRUM,
      "Transfer",
      { from: ALICE, to: BOB, tokenId: TOKEN },
      { block: 1001, ts: 105, log: 5, tx: 20 },
    );
    const summary = await summaryOf([...arbitrum.slice(0, 2), move]);
    expect(summary).toMatchObject({ status: "held", currentChainId: ARBITRUM, owner: BOB });
    expect(summary.revisions).toHaveLength(1);
    expect(summary.timeline.map((e) => e.kind)).toEqual(["issued", "transferred"]);
  });

  it("token ids beyond 2^53 survive as exact decimal strings", async () => {
    const summary = deriveSummary({
      deploymentId: "whisky-v2-eval3",
      tokenId: 11_155_111_000_000_000_001n,
      rows: {
        chainPassports: [],
        revisions: [],
        observations: [],
        sends: [],
        receives: [],
        transfers: [],
      },
      progress: caughtUp,
      configuredChainIds: CHAINS,
    });
    expect(summary.tokenId).toBe("11155111000000000001");
    expect(summary.originChainId).toBe(SEPOLIA);
  });
});
