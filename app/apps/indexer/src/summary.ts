import { ID_SPACE } from "@idpp/passport-config";

/**
 * Pure derivation of the passport summary from per-chain rows. No I/O, no Ponder imports: the rows
 * are the shapes of the tables in `ponder.schema.ts`, so unit tests feed fixtures directly.
 *
 * The result depends only on the set of rows (and on the progress snapshot), never on the order in
 * which the chains were indexed: every ordering below uses a total key that is part of the data.
 */

export type ChainPassportRow = {
  chainId: number;
  tokenId: bigint;
  present: boolean;
  owner: string | null;
  revision: bigint | null;
  cid: string | null;
  lastBlock: bigint;
};

export type PassportRevisionRow = {
  tokenId: bigint;
  revision: bigint;
  chainId: number;
  cid: string;
  author: string;
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  timestamp: bigint;
};

export type RevisionObservationRow = {
  chainId: number;
  txHash: string;
  logIndex: number;
  tokenId: bigint;
  revision: bigint;
  cid: string;
};

export type SendRow = {
  chainId: number;
  guid: string;
  tokenId: bigint;
  dstEid: number;
  from: string;
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  timestamp: bigint;
};

export type ReceiveRow = {
  chainId: number;
  guid: string;
  tokenId: bigint;
  srcEid: number;
  to: string;
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  timestamp: bigint;
};

export type TransferRow = {
  chainId: number;
  txHash: string;
  logIndex: number;
  tokenId: bigint;
  from: string;
  to: string;
  blockNumber: bigint;
  timestamp: bigint;
};

/** All rows of one token, from every chain. */
export type TokenRows = {
  chainPassports: readonly ChainPassportRow[];
  revisions: readonly PassportRevisionRow[];
  observations: readonly RevisionObservationRow[];
  sends: readonly SendRow[];
  receives: readonly ReceiveRow[];
  transfers: readonly TransferRow[];
};

export type ChainProgress = { chainId: number; indexedBlock: bigint; latestBlock: bigint };

/**
 * How far behind the chain head the indexer may be and still count as caught up, in seconds. The
 * head (read from the RPC) and the indexed block (Ponder's checkpoint) are sampled at different
 * moments from different RPC backends, so a fixed lag of one or two blocks is normal on a fast
 * chain, where a lag of 2 blocks is well under a second.
 */
export const LAG_TOLERANCE_SECONDS = 8;

/** Approximate block time per chain id, in milliseconds. Unlisted chains get a tolerance of one block. */
const BLOCK_TIME_MS: Readonly<Record<number, number>> = {
  421614: 250, // Arbitrum Sepolia
  // Base Sepolia uses native 200ms blocks after Denim (2026-10-21).
  // https://github.com/base/base/releases/tag/v1.5.0
  84532: 200,
  11155111: 12_000, // Sepolia
};

/** Number of blocks `LAG_TOLERANCE_SECONDS` covers on `chainId` (at least one). */
export function lagToleranceBlocks(chainId: number): bigint {
  const blockTime = BLOCK_TIME_MS[chainId];
  if (blockTime === undefined) return 1n;
  return BigInt(Math.max(1, Math.floor((LAG_TOLERANCE_SECONDS * 1000) / blockTime)));
}

type TimelineBase = {
  chainId: number;
  txHash: string;
  blockNumber: string;
  timestamp: string;
  logIndex: number;
};

export type TimelineEntry =
  | (TimelineBase & { kind: "issued"; revision: string; cid: string; author: string })
  | (TimelineBase & { kind: "revised"; revision: string; cid: string; author: string })
  | (TimelineBase & { kind: "transferred"; from: string; to: string })
  | (TimelineBase & { kind: "sent"; guid: string; from: string; dstEid: number })
  | (TimelineBase & { kind: "received"; guid: string; to: string; srcEid: number });

export type PassportSummary = {
  deploymentId: string;
  tokenId: string;
  originChainId: number;
  currentChainId: number | null;
  status: "held" | "in_flight" | "incomplete";
  owner: string | null;
  revision: string | null;
  cid: string | null;
  progress: { chainId: number; indexedBlock: string; latestBlock: string }[];
  revisions: {
    revision: string;
    cid: string;
    chainId: number;
    author: string;
    txHash: string;
    timestamp: string;
    conflict: boolean;
  }[];
  timeline: TimelineEntry[];
};

type OrderKey = { timestamp: bigint; chainId: number; blockNumber: bigint; logIndex: number };

/** Total order used for the timeline and for "newest send": (timestamp, chainId, blockNumber, logIndex). */
export function compareOrder(a: OrderKey, b: OrderKey): number {
  if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? -1 : 1;
  if (a.chainId !== b.chainId) return a.chainId - b.chainId;
  if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
  return a.logIndex - b.logIndex;
}

/** Per revision, the distinct CIDs claimed by its issue/revise records and by import observations. */
function cidsByRevision(rows: TokenRows): Map<bigint, Set<string>> {
  const byRevision = new Map<bigint, Set<string>>();
  const add = (revision: bigint, cid: string) => {
    const set = byRevision.get(revision) ?? new Set<string>();
    set.add(cid);
    byRevision.set(revision, set);
  };
  for (const row of rows.revisions) add(row.revision, row.cid);
  for (const row of rows.observations) add(row.revision, row.cid);
  return byRevision;
}

export function deriveSummary(input: {
  deploymentId: string;
  tokenId: bigint;
  rows: TokenRows;
  progress: readonly ChainProgress[];
  /** Chain ids the indexer is configured for; a chain without progress counts as behind. */
  configuredChainIds: readonly number[];
}): PassportSummary {
  const { deploymentId, tokenId, rows, progress, configuredChainIds } = input;

  // Revisions: one entry per revision number; the earliest record is the canonical one.
  const claimed = cidsByRevision(rows);
  const canonical = new Map<bigint, PassportRevisionRow>();
  for (const row of [...rows.revisions].sort(compareOrder)) {
    if (!canonical.has(row.revision)) canonical.set(row.revision, row);
  }
  const revisions = [...canonical.values()]
    .sort((a, b) => (a.revision < b.revision ? -1 : a.revision > b.revision ? 1 : 0))
    .map((row) => ({
      revision: row.revision.toString(),
      cid: row.cid,
      chainId: row.chainId,
      author: row.author,
      txHash: row.txHash,
      timestamp: row.timestamp.toString(),
      conflict: (claimed.get(row.revision)?.size ?? 0) > 1,
    }));
  const anyConflict = [...claimed.values()].some((cids) => cids.size > 1);

  // Progress: a chain is behind when it lags by more than the time-based tolerance
  // (`lagToleranceBlocks`), or when no progress is known for it.
  const progressByChain = new Map(progress.map((p) => [p.chainId, p]));
  const behind = configuredChainIds.some((chainId) => {
    const p = progressByChain.get(chainId);
    return p === undefined || p.indexedBlock < p.latestBlock - lagToleranceBlocks(chainId);
  });

  // Location: the chains that hold the token.
  const present = rows.chainPassports.filter((row) => row.present);

  // Transfers: the newest send, and whether any receive carries its guid.
  const newestSend = [...rows.sends].sort(compareOrder).at(-1);
  const receivedGuids = new Set(rows.receives.map((row) => row.guid));
  const newestSendLanded = newestSend !== undefined && receivedGuids.has(newestSend.guid);

  let status: PassportSummary["status"];
  if (present.length > 1 || anyConflict || behind) {
    status = "incomplete";
  } else if (present.length === 1) {
    status = "held";
  } else if (newestSend !== undefined && !newestSendLanded) {
    status = "in_flight";
  } else {
    // Nothing holds the token and no send is outstanding: the evidence does not say where it is.
    status = "incomplete";
  }

  // The location is only reported when it is settled; otherwise it would be a guess.
  const holder = status === "held" ? present[0] : undefined;

  const timeline: (TimelineEntry & { order: OrderKey })[] = [];
  const stamp = (row: {
    chainId: number;
    txHash: string;
    blockNumber: bigint;
    timestamp: bigint;
    logIndex: number;
  }) => ({
    chainId: row.chainId,
    txHash: row.txHash,
    blockNumber: row.blockNumber.toString(),
    timestamp: row.timestamp.toString(),
    logIndex: row.logIndex,
    order: {
      timestamp: row.timestamp,
      chainId: row.chainId,
      blockNumber: row.blockNumber,
      logIndex: row.logIndex,
    },
  });
  for (const row of rows.revisions) {
    timeline.push({
      ...stamp(row),
      kind: row.revision === 0n ? "issued" : "revised",
      revision: row.revision.toString(),
      cid: row.cid,
      author: row.author,
    });
  }
  for (const row of rows.transfers) {
    timeline.push({ ...stamp(row), kind: "transferred", from: row.from, to: row.to });
  }
  for (const row of rows.sends) {
    timeline.push({
      ...stamp(row),
      kind: "sent",
      guid: row.guid,
      from: row.from,
      dstEid: row.dstEid,
    });
  }
  for (const row of rows.receives) {
    timeline.push({
      ...stamp(row),
      kind: "received",
      guid: row.guid,
      to: row.to,
      srcEid: row.srcEid,
    });
  }
  timeline.sort((a, b) => compareOrder(a.order, b.order) || a.kind.localeCompare(b.kind));

  return {
    deploymentId,
    tokenId: tokenId.toString(),
    originChainId: Number(tokenId / ID_SPACE),
    currentChainId: holder?.chainId ?? null,
    status,
    owner: holder?.owner ?? null,
    revision: holder?.revision?.toString() ?? null,
    cid: holder?.cid ?? null,
    progress: [...progress]
      .sort((a, b) => a.chainId - b.chainId)
      .map((p) => ({
        chainId: p.chainId,
        indexedBlock: p.indexedBlock.toString(),
        latestBlock: p.latestBlock.toString(),
      })),
    revisions,
    timeline: timeline.map(({ order: _order, ...entry }) => entry as TimelineEntry),
  };
}
