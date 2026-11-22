import type { IndexingFunctionArgs } from "ponder:registry";
import { MANIFEST } from "@idpp/passport-config";
import {
  chainEvent,
  chainPassport,
  ownershipTransfer,
  passportRevision,
  receiveObservation,
  revisionObservation,
  sendObservation,
} from "../ponder.schema";

/**
 * Indexing functions, kept apart from `ponder.on` registration (`src/index.ts`) so tests can drive
 * them with an in-memory store.
 *
 * Rules:
 * - Every write is keyed by the chain the handler runs on (`context.chain.id`). Nothing reads or
 *   writes another chain's rows, so the result cannot depend on which chain is indexed first.
 * - Handlers never fetch IPFS and never call external services.
 * - Within one chain, Ponder delivers logs in (block, logIndex) order, which the upserts rely on:
 *   `PassportIssued` precedes the mint `Transfer`, `Transfer` precedes `PassportImported`.
 */

const ZERO = "0x0000000000000000000000000000000000000000";

type Name =
  | "Transfer"
  | "PassportIssued"
  | "PassportRevised"
  | "PassportImported"
  | "ONFTSent"
  | "ONFTReceived";

type Args<N extends Name> = IndexingFunctionArgs<`WhiskyDistillery:${N}`>;

/** JSON-safe copy of decoded args: bigints become decimal strings. */
function jsonArgs(args: object): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => [
      key,
      typeof value === "bigint" ? value.toString() : (value as string | number | boolean | null),
    ]),
  );
}

async function recordEvent<N extends Name>(
  kind: N,
  { event, context }: Args<N>,
  tokenId: bigint,
): Promise<void> {
  await context.db
    .insert(chainEvent)
    .values({
      chainId: context.chain.id,
      txHash: event.transaction.hash,
      logIndex: event.log.logIndex,
      deploymentId: MANIFEST.deploymentId,
      address: event.log.address,
      blockNumber: event.block.number,
      blockHash: event.block.hash,
      timestamp: event.block.timestamp,
      kind,
      tokenId,
      argsJson: jsonArgs(event.args),
    })
    .onConflictDoNothing();
}

export async function onTransfer(args: Args<"Transfer">): Promise<void> {
  const { event, context } = args;
  const { from, to, tokenId } = event.args;
  const chainId = context.chain.id;
  await recordEvent("Transfer", args, tokenId);

  const minted = from === ZERO;
  const burned = to === ZERO;
  await context.db
    .insert(chainPassport)
    .values({
      chainId,
      tokenId,
      present: !burned,
      owner: burned ? null : to,
      revision: null,
      cid: null,
      lastBlock: event.block.number,
    })
    .onConflictDoUpdate({
      present: !burned,
      owner: burned ? null : to,
      lastBlock: event.block.number,
    });

  if (!minted && !burned) {
    await context.db
      .insert(ownershipTransfer)
      .values({
        chainId,
        txHash: event.transaction.hash,
        logIndex: event.log.logIndex,
        tokenId,
        from,
        to,
        blockNumber: event.block.number,
        timestamp: event.block.timestamp,
      })
      .onConflictDoNothing();
  }
}

/** Sets the local revision and cid without touching `present` and `owner` (owned by `Transfer`). */
async function setLocalSnapshot(
  args: Args<"PassportIssued" | "PassportRevised" | "PassportImported">,
  tokenId: bigint,
  revision: bigint,
  cid: string,
): Promise<void> {
  const { event, context } = args;
  await context.db
    .insert(chainPassport)
    .values({
      chainId: context.chain.id,
      tokenId,
      present: false,
      owner: null,
      revision,
      cid,
      lastBlock: event.block.number,
    })
    .onConflictDoUpdate({ revision, cid, lastBlock: event.block.number });
}

export async function onPassportIssued(args: Args<"PassportIssued">): Promise<void> {
  const { event, context } = args;
  const { tokenId, cid } = event.args;
  await recordEvent("PassportIssued", args, tokenId);
  await setLocalSnapshot(args, tokenId, 0n, cid);
  await context.db
    .insert(passportRevision)
    .values({
      tokenId,
      revision: 0n,
      chainId: context.chain.id,
      cid,
      author: event.transaction.from,
      txHash: event.transaction.hash,
      logIndex: event.log.logIndex,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
    })
    .onConflictDoNothing();
}

export async function onPassportRevised(args: Args<"PassportRevised">): Promise<void> {
  const { event, context } = args;
  const { tokenId, revision, cid, author } = event.args;
  await recordEvent("PassportRevised", args, tokenId);
  await setLocalSnapshot(args, tokenId, revision, cid);
  await context.db
    .insert(passportRevision)
    .values({
      tokenId,
      revision,
      chainId: context.chain.id,
      cid,
      author,
      txHash: event.transaction.hash,
      logIndex: event.log.logIndex,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
    })
    .onConflictDoNothing();
}

/**
 * An observation of an existing revision, never a new one. Disagreement with the revision's own
 * record (or with another chain's observation) is detected at query time, so the order in which
 * the chains are indexed cannot change the outcome.
 */
export async function onPassportImported(args: Args<"PassportImported">): Promise<void> {
  const { event, context } = args;
  const { tokenId, revision, cid } = event.args;
  await recordEvent("PassportImported", args, tokenId);
  await setLocalSnapshot(args, tokenId, revision, cid);
  await context.db
    .insert(revisionObservation)
    .values({
      chainId: context.chain.id,
      txHash: event.transaction.hash,
      logIndex: event.log.logIndex,
      tokenId,
      revision,
      cid,
    })
    .onConflictDoNothing();
}

export async function onONFTSent(args: Args<"ONFTSent">): Promise<void> {
  const { event, context } = args;
  const { guid, dstEid, fromAddress, tokenId } = event.args;
  await recordEvent("ONFTSent", args, tokenId);
  await context.db
    .insert(sendObservation)
    .values({
      chainId: context.chain.id,
      guid,
      tokenId,
      dstEid,
      from: fromAddress,
      txHash: event.transaction.hash,
      logIndex: event.log.logIndex,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
    })
    .onConflictDoNothing();
}

export async function onONFTReceived(args: Args<"ONFTReceived">): Promise<void> {
  const { event, context } = args;
  const { guid, srcEid, toAddress, tokenId } = event.args;
  await recordEvent("ONFTReceived", args, tokenId);
  await context.db
    .insert(receiveObservation)
    .values({
      chainId: context.chain.id,
      guid,
      tokenId,
      srcEid,
      to: toAddress,
      txHash: event.transaction.hash,
      logIndex: event.log.logIndex,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
    })
    .onConflictDoNothing();
}
