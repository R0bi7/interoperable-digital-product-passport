import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  gitState,
  liveRepeat,
  observeReader,
  observeTogether,
  type ReaderSnapshot,
  readerMatches,
  type TimingHeader,
  type TimingObservation,
  TimingRecorder,
} from "./timing";

const header: TimingHeader = {
  startedAt: "2026-10-20T10:00:00.000Z",
  gitSha: "abc",
  gitDirty: true,
  deploymentId: "whisky-v2-eval3",
  chains: [{ chainId: 421614, eid: 40231, address: "0x123" }],
  tools: { node: "v24", playwright: "1.64" },
  indexerUrl: "http://localhost:42069",
};
const observation: TimingObservation = {
  operation: "mint",
  tokenId: "421614000000000001",
  chainId: 421614,
  clickAt: header.startedAt,
  confirmedAt: "2026-10-20T10:00:02.000Z",
  verifiedAt: null,
  outcome: "timed-out",
};
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "ui-timing-test-"));
  dirs.push(dir);
  return dir;
};

describe("TimingRecorder", () => {
  it("creates nothing before the first operation; writes header, append order, and later results", () => {
    const output = join(temp(), "nested", "ui-timings.json");
    const recorder = new TimingRecorder(header, output);
    recorder.write();
    expect(existsSync(output)).toBe(false);
    const first = recorder.append({ ...observation });
    recorder.append({
      ...observation,
      operation: "send",
      direction: "421614->84532",
      txHash: "0xabc",
      delivery: { mountedAt: header.startedAt, deliveredAt: null, indexerObservedAt: null },
    });
    first.verifiedAt = "2026-10-20T10:00:05.000Z";
    first.outcome = "verified";
    recorder.write();
    const file = JSON.parse(readFileSync(output, "utf8"));
    expect(file.header).toEqual(header);
    expect(file.observations).toEqual(recorder.observations);
    expect(file.observations.map((sample: TimingObservation) => sample.operation)).toEqual([
      "mint",
      "send",
    ]);
  });
  it("names the default output without a flows task prefix", () => {
    expect(new TimingRecorder(header, "").path).toMatch(
      /e2e-live\/out\/ui-timings-2026-10-20T10-00-00.000Z.json$/,
    );
  });
  it("keeps not-measured and timed-out results including last page state", () => {
    const output = join(temp(), "result.json");
    const recorder = new TimingRecorder({ ...header, indexerUrl: null }, output);
    recorder.append({ ...observation, outcome: "not-measured", lastPageState: "mock mode" });
    recorder.append({ ...observation, lastPageState: "content: unavailable" });
    expect(JSON.parse(readFileSync(output, "utf8")).observations).toMatchObject([
      { verifiedAt: null, outcome: "not-measured", lastPageState: "mock mode" },
      { verifiedAt: null, outcome: "timed-out", lastPageState: "content: unavailable" },
    ]);
  });
  it("reports an unknown git state without a checkout", () => {
    expect(gitState(temp())).toEqual({ gitSha: "unknown", gitDirty: true });
  });
});

it("requires a positive integral LIVE_REPEAT", () => {
  expect(liveRepeat(undefined)).toBe(1);
  expect(liveRepeat("10")).toBe(10);
  for (const raw of ["", "0", "-1", "1.5", "NaN", "Infinity"])
    expect(() => liveRepeat(raw)).toThrow("positive integer");
});

it("reloads a settled reader until the expected passport verifies", async () => {
  let time = 0;
  let loads = 0;
  const result = await observeReader({
    load: async () => {
      loads++;
    },
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    intervalMs: 5_000,
    timeoutMs: 15_000,
    snapshot: async () => ({
      verified: loads === 3,
      state: loads === 3 ? "expected passport" : "old revision",
    }),
  });
  expect(loads).toBe(3);
  expect(result).toEqual({
    verifiedAt: "1970-01-01T00:00:10.000Z",
    lastPageState: "expected passport",
  });
});

it("retains a timeout's last state and bounds loads by the reader deadline", async () => {
  let time = 0;
  const remaining: number[] = [];
  const result = await observeReader({
    load: async (ms) => {
      remaining.push(ms);
    },
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    intervalMs: 5_000,
    timeoutMs: 7_000,
    snapshot: async () => ({ verified: false, state: "binding: unconfirmed" }),
  });
  expect(remaining).toEqual([7_000, 2_000]);
  expect(time).toBe(7_000);
  expect(result).toEqual({ verifiedAt: null, lastPageState: "binding: unconfirmed" });
});

it("records reader verification before the panel's indexer observation finishes", async () => {
  let finishPanel!: (value: {
    mountedAt: string;
    deliveredAt: string;
    indexerObservedAt: string;
  }) => void;
  const panel = new Promise<{ mountedAt: string; deliveredAt: string; indexerObservedAt: string }>(
    (done) => {
      finishPanel = done;
    },
  );
  let published: string | null = null;
  let finished = false;
  const pending = observeTogether(
    async () => ({
      verifiedAt: "2026-10-20T10:00:04.000Z",
      lastPageState: "all four badges verified",
    }),
    () => panel,
    (reader) => {
      published = reader.verifiedAt;
    },
  ).then((result) => {
    finished = true;
    return result;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(published).toBe("2026-10-20T10:00:04.000Z");
  expect(finished).toBe(false);
  finishPanel({
    mountedAt: header.startedAt,
    deliveredAt: "2026-10-20T10:00:03.000Z",
    indexerObservedAt: "2026-10-20T10:01:00.000Z",
  });
  expect((await pending).verifiedAt).toBe(published);
});

it("requires the expected token, tip CID/revision, live destination, agreement and all four badges per revision", () => {
  const expected = {
    tokenId: observation.tokenId,
    revision: "1",
    cid: "expected-tip",
    chain: "Base Sepolia",
  };
  const snapshot: ReaderSnapshot = {
    ...expected,
    agreement: true,
    historyHash: true,
    state: "passport",
    badges: Object.fromEntries(
      ["content", "binding", "history", "recorded on chain"].map((name) => [
        name,
        { total: 2, verified: 2 },
      ]),
    ),
  };
  expect(readerMatches(snapshot, expected)).toBe(true);
  for (const patch of [
    { tokenId: "other" },
    { revision: "0" },
    { cid: "old" },
    { chain: "Arbitrum Sepolia" },
    { agreement: false },
    { historyHash: false },
  ]) {
    expect(readerMatches({ ...snapshot, ...patch }, expected)).toBe(false);
  }
  for (const name of ["content", "binding", "history", "recorded on chain"]) {
    expect(
      readerMatches(
        { ...snapshot, badges: { ...snapshot.badges, [name]: { total: 2, verified: 1 } } },
        expected,
      ),
    ).toBe(false);
    expect(
      readerMatches(
        { ...snapshot, badges: { ...snapshot.badges, [name]: { total: 1, verified: 1 } } },
        expected,
      ),
    ).toBe(false);
  }
});

it("lets healthy verification taking more than five seconds finish without reloading it", async () => {
  let time = 0;
  let loads = 0;
  const result = await observeReader({
    load: async () => {
      loads++;
    },
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    timeoutMs: 15_000,
    intervalMs: 5_000,
    snapshot: async () => ({
      verified: time >= 7_000,
      pending: time < 7_000,
      state: time < 7_000 ? "Verifying payloads" : "all checks verified",
    }),
  });
  expect(loads).toBe(1);
  expect(result).toEqual({
    verifiedAt: "1970-01-01T00:00:07.000Z",
    lastPageState: "all checks verified",
  });
});

it("keeps a forever-pending verification inside the overall reader deadline", async () => {
  let time = 0;
  let loads = 0;
  const result = await observeReader({
    load: async () => {
      loads++;
    },
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    timeoutMs: 7_000,
    intervalMs: 5_000,
    snapshot: async () => ({ verified: false, pending: true, state: "Verifying payloads" }),
  });
  expect(loads).toBe(1);
  expect(time).toBe(7_000);
  expect(result).toEqual({ verifiedAt: null, lastPageState: "Verifying payloads" });
});
