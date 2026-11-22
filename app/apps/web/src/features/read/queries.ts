import type { PassportSummary } from "@/lib/indexer/client";
import type { LiveRecord } from "./live";
import type { ReadSources } from "./sources";
import type { VerifyOutcome } from "./verification";

/** Production query boundary: one indexer read, then one logical live read (two RPC requests). */
export const passportQuery = (sources: ReadSources, tokenId: bigint) => () =>
  sources.getPassport(tokenId);
export const liveQuery = (sources: ReadSources, chainId: number, tokenId: bigint) => () =>
  sources.readLive(chainId, tokenId);

/** Include receipt metadata so corrected transaction rows invalidate independent receipt checks. */
export function revisionQueryKey(revisions: PassportSummary["revisions"]): string {
  return JSON.stringify(
    revisions.map(({ revision, cid, txHash, chainId, author, conflict }) => ({
      revision,
      cid,
      txHash,
      chainId,
      author,
      conflict,
    })),
  );
}

export function assuranceMessage(
  summary: PassportSummary,
  outcome: VerifyOutcome,
): string | undefined {
  if (outcome.assurance === "indexer-only") {
    const why =
      summary.currentChainId !== null
        ? "the live read failed"
        : summary.status === "in_flight"
          ? "the token is in flight; no chain holds it to read"
          : "the indexer is incomplete and names no chain to read";
    return `Indexer only: ${why}. No binding below is confirmed on chain.`;
  }
  if (outcome.assurance === "live-tip-older") {
    const tip = outcome.entries.find((entry) => entry.source !== "indexed")?.revision;
    const newest = outcome.entries.at(-1)?.revision;
    return `The chain holds revision ${tip}; the indexer lists revision ${newest}. Revisions above ${tip} are not confirmed on chain.`;
  }
}

/** A failed refetch retains cached data in TanStack; that sample no longer confirms a live read. */
export function currentLiveRecord(query: {
  status: "pending" | "success" | "error";
  data?: LiveRecord | null;
}): LiveRecord | undefined {
  return query.status === "success" ? (query.data ?? undefined) : undefined;
}
