import { db } from "ponder:api";
import { MANIFEST } from "@idpp/passport-config";
import { and, asc, eq, gt, inArray } from "ponder";
import {
  chainPassport,
  ownershipTransfer,
  passportRevision,
  receiveObservation,
  revisionObservation,
  sendObservation,
} from "../../ponder.schema";
import {
  type ChainProgress,
  deriveSummary,
  type PassportSummary,
  type TokenRows,
} from "../summary";
import type { ListQuery } from "./params";

const configuredChainIds = MANIFEST.chains.map((chain) => chain.chainId);

/** Token ids scanned per database round while filling a page. */
const BATCH = 50;

function groupByToken<T extends { tokenId: bigint }>(rows: readonly T[]): Map<bigint, T[]> {
  const grouped = new Map<bigint, T[]>();
  for (const row of rows) {
    const list = grouped.get(row.tokenId);
    if (list) list.push(row);
    else grouped.set(row.tokenId, [row]);
  }
  return grouped;
}

/** Loads every row of the given tokens (all chains) and derives their summaries. */
async function summarize(
  tokenIds: readonly bigint[],
  progress: readonly ChainProgress[],
): Promise<Map<bigint, PassportSummary>> {
  if (tokenIds.length === 0) return new Map();
  const ids = [...tokenIds];
  const [chainPassports, revisions, observations, sends, receives, transfers] = await Promise.all([
    db.select().from(chainPassport).where(inArray(chainPassport.tokenId, ids)),
    db.select().from(passportRevision).where(inArray(passportRevision.tokenId, ids)),
    db.select().from(revisionObservation).where(inArray(revisionObservation.tokenId, ids)),
    db.select().from(sendObservation).where(inArray(sendObservation.tokenId, ids)),
    db.select().from(receiveObservation).where(inArray(receiveObservation.tokenId, ids)),
    db.select().from(ownershipTransfer).where(inArray(ownershipTransfer.tokenId, ids)),
  ]);

  const by = {
    chainPassports: groupByToken(chainPassports),
    revisions: groupByToken(revisions),
    observations: groupByToken(observations),
    sends: groupByToken(sends),
    receives: groupByToken(receives),
    transfers: groupByToken(transfers),
  };

  const summaries = new Map<bigint, PassportSummary>();
  for (const tokenId of ids) {
    const rows: TokenRows = {
      chainPassports: by.chainPassports.get(tokenId) ?? [],
      revisions: by.revisions.get(tokenId) ?? [],
      observations: by.observations.get(tokenId) ?? [],
      sends: by.sends.get(tokenId) ?? [],
      receives: by.receives.get(tokenId) ?? [],
      transfers: by.transfers.get(tokenId) ?? [],
    };
    summaries.set(
      tokenId,
      deriveSummary({
        deploymentId: MANIFEST.deploymentId,
        tokenId,
        rows,
        progress,
        configuredChainIds,
      }),
    );
  }
  return summaries;
}

/** `undefined` when no chain has ever reported the token. */
export async function getPassport(
  tokenId: bigint,
  progress: readonly ChainProgress[],
): Promise<PassportSummary | undefined> {
  const known = await db
    .select({ tokenId: chainPassport.tokenId })
    .from(chainPassport)
    .where(eq(chainPassport.tokenId, tokenId))
    .limit(1);
  if (known.length === 0) return undefined;
  return (await summarize([tokenId], progress)).get(tokenId);
}

/**
 * One page of summaries in ascending token-id order. Status is derived, so it is filtered after
 * derivation: token ids are scanned in batches until `limit + 1` summaries match, the extra one
 * only proving that another page exists. `chainId` keeps tokens that are present on that chain.
 */
export async function listPassports(
  query: ListQuery,
  progress: readonly ChainProgress[],
): Promise<{ items: PassportSummary[]; nextCursor: string | null }> {
  const items: PassportSummary[] = [];
  let after = query.cursor;

  for (;;) {
    const conditions = [
      after === undefined ? undefined : gt(chainPassport.tokenId, after),
      query.chainId === undefined
        ? undefined
        : and(eq(chainPassport.chainId, query.chainId), eq(chainPassport.present, true)),
    ].filter((condition) => condition !== undefined);

    const page = await db
      .select({ tokenId: chainPassport.tokenId })
      .from(chainPassport)
      .where(and(...conditions))
      .groupBy(chainPassport.tokenId)
      .orderBy(asc(chainPassport.tokenId))
      .limit(BATCH);
    if (page.length === 0) return { items, nextCursor: null };

    const summaries = await summarize(
      page.map((row) => row.tokenId),
      progress,
    );
    for (const { tokenId } of page) {
      const summary = summaries.get(tokenId);
      if (!summary || (query.status !== undefined && summary.status !== query.status)) continue;
      if (items.length === query.limit) {
        const last = items[items.length - 1];
        return { items, nextCursor: last ? last.tokenId : null };
      }
      items.push(summary);
    }

    if (page.length < BATCH) return { items, nextCursor: null };
    after = page[page.length - 1]?.tokenId;
  }
}
