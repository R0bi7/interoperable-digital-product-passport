import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type DeliveryTiming = {
  mountedAt: string | null;
  deliveredAt: string | null;
  indexerObservedAt: string | null;
};
export type TimingObservation = {
  operation: "mint" | "revise" | "send";
  direction?: string;
  tokenId: string;
  chainId: number;
  txHash?: string;
  clickAt: string;
  confirmedAt: string | null;
  verifiedAt: string | null;
  outcome: "verified" | "timed-out" | "not-measured";
  delivery?: DeliveryTiming;
  lastPageState?: string;
};
export type TimingHeader = {
  startedAt: string;
  gitSha: string;
  gitDirty: boolean;
  deploymentId: string;
  chains: readonly { chainId: number; address: string; eid: number }[];
  tools: { node: string; playwright: string };
  indexerUrl: string | null;
};

/** No file is created until an operation is attempted. Every append preserves earlier samples. */
export class TimingRecorder {
  readonly observations: TimingObservation[] = [];
  readonly path: string;
  constructor(
    readonly header: TimingHeader,
    output = process.env.UI_TIMINGS_OUT,
  ) {
    this.path = resolve(
      output || `e2e-live/out/ui-timings-${header.startedAt.replace(/:/g, "-")}.json`,
    );
  }
  append(observation: TimingObservation) {
    this.observations.push(observation);
    this.write();
    return observation;
  }
  write() {
    if (!this.observations.length) return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(
      this.path,
      `${JSON.stringify({ header: this.header, observations: this.observations }, null, 2)}\n`,
    );
  }
}

export function gitState(cwd = process.cwd()) {
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
  try {
    return { gitSha: git("rev-parse", "HEAD"), gitDirty: git("status", "--porcelain").length > 0 };
  } catch {
    return { gitSha: "unknown", gitDirty: true };
  }
}

export function liveRepeat(raw = process.env.LIVE_REPEAT): number {
  const count = raw === undefined ? 1 : Number(raw);
  if (!Number.isSafeInteger(count) || count < 1)
    throw new Error("LIVE_REPEAT must be a positive integer");
  return count;
}

export type ReaderResult = { verifiedAt: string | null; lastPageState: string };
/** Reload cadence bounds resolution; the deadline includes loads and asynchronous verification. */
export async function observeReader(deps: {
  load: (remainingMs: number) => Promise<void>;
  snapshot: () => Promise<{ verified: boolean; pending?: boolean; state: string }>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<ReaderResult> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
  const deadline = now() + (deps.timeoutMs ?? 5 * 60_000);
  let lastPageState = "reader not loaded";
  while (now() < deadline) {
    const nextLoad = now() + (deps.intervalMs ?? 5_000);
    try {
      await deps.load(deadline - now());
      // A reload aborts the page's pending gateway/RPC work. Keep observing it within this
      // reader deadline; only settled failures or stale indexer results are reloaded.
      let pending: boolean;
      do {
        const snapshot = await deps.snapshot();
        lastPageState = snapshot.state;
        pending = snapshot.pending ?? false;
        if (snapshot.verified) return { verifiedAt: new Date(now()).toISOString(), lastPageState };
        const nextCheck = pending ? deadline : Math.min(nextLoad, deadline);
        await sleep(Math.min(200, Math.max(0, nextCheck - now())));
      } while (now() < deadline && (pending || now() < nextLoad));
    } catch (error) {
      lastPageState = String(error);
    }
    if (now() < nextLoad && now() < deadline) await sleep(Math.min(nextLoad, deadline) - now());
  }
  return { verifiedAt: null, lastPageState };
}

/** Start both clocks immediately; publishing the reader result must not wait for the panel. */
export async function observeTogether(
  reader: () => Promise<ReaderResult>,
  panel: () => Promise<DeliveryTiming>,
  onReader: (result: ReaderResult) => void,
) {
  const readerTask = reader().then((result) => {
    onReader(result);
    return result;
  });
  const panelTask = panel();
  const [verified, delivery] = await Promise.all([readerTask, panelTask]);
  return { ...verified, delivery };
}

export type ReaderSnapshot = {
  tokenId?: string;
  revision?: string;
  cid?: string;
  chain?: string;
  agreement: boolean;
  badges: Record<string, { total: number; verified: number }>;
  historyHash: boolean;
  state: string;
};
/** No old revision, other token, stale placement, or partially verified history counts. */
export function readerMatches(
  snapshot: ReaderSnapshot,
  expected: { tokenId: string; revision: string; cid: string; chain: string },
): boolean {
  const count = Number(expected.revision) + 1;
  return (
    snapshot.tokenId === expected.tokenId &&
    snapshot.revision === expected.revision &&
    snapshot.cid === expected.cid &&
    snapshot.chain === expected.chain &&
    snapshot.agreement &&
    snapshot.historyHash &&
    ["content", "binding", "history", "recorded on chain"].every(
      (name) => snapshot.badges[name]?.total === count && snapshot.badges[name]?.verified === count,
    )
  );
}
