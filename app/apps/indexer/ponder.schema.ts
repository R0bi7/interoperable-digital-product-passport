import { index, onchainTable, primaryKey } from "ponder";

/**
 * Per-chain facts. Every row is written by the handlers of exactly one chain and carries that chain's
 * id in its key; nothing here is written from two chains. Cross-chain joins (a transfer's send and
 * receive, a revision seen on several chains) happen at query time in `src/summary.ts`.
 */

/** Every passport-relevant log, as emitted. `argsJson` holds the decoded args (bigints as decimal strings). */
export const chainEvent = onchainTable(
  "chain_event",
  (t) => ({
    chainId: t.integer().notNull(),
    txHash: t.hex().notNull(),
    logIndex: t.integer().notNull(),
    deploymentId: t.text().notNull(),
    address: t.hex().notNull(),
    blockNumber: t.bigint().notNull(),
    blockHash: t.hex().notNull(),
    timestamp: t.bigint().notNull(),
    kind: t.text().notNull(),
    tokenId: t.bigint().notNull(),
    argsJson: t.json().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.chainId, table.txHash, table.logIndex] }),
    tokenIdx: index().on(table.tokenId),
  }),
);

/**
 * What one chain currently holds for a token. `revision` and `cid` of an absent token are the stale
 * snapshot the contract keeps after a send; readers must only use them when `present` is true.
 */
export const chainPassport = onchainTable(
  "chain_passport",
  (t) => ({
    chainId: t.integer().notNull(),
    tokenId: t.bigint().notNull(),
    present: t.boolean().notNull(),
    owner: t.hex(),
    revision: t.bigint(),
    cid: t.text(),
    lastBlock: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.chainId, table.tokenId] }),
    tokenIdx: index().on(table.tokenId),
  }),
);

/**
 * A revision as issued or revised on a chain (`PassportIssued` is revision 0, `author` = tx sender).
 * The key includes `chainId` so that a (never expected) second writer of the same revision on another
 * chain is a second row, not an order-dependent overwrite. `conflict` is derived at query time.
 */
export const passportRevision = onchainTable(
  "passport_revision",
  (t) => ({
    tokenId: t.bigint().notNull(),
    revision: t.bigint().notNull(),
    chainId: t.integer().notNull(),
    cid: t.text().notNull(),
    author: t.hex().notNull(),
    txHash: t.hex().notNull(),
    logIndex: t.integer().notNull(),
    blockNumber: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.tokenId, table.revision, table.chainId] }),
  }),
);

/** `PassportImported`: a chain observed an existing revision arriving. Never a new revision. */
export const revisionObservation = onchainTable(
  "revision_observation",
  (t) => ({
    chainId: t.integer().notNull(),
    txHash: t.hex().notNull(),
    logIndex: t.integer().notNull(),
    tokenId: t.bigint().notNull(),
    revision: t.bigint().notNull(),
    cid: t.text().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.chainId, table.txHash, table.logIndex] }),
    tokenIdx: index().on(table.tokenId),
  }),
);

/** `ONFTSent` on the source chain. Joined to `receiveObservation` by `guid` at query time. */
export const sendObservation = onchainTable(
  "send_observation",
  (t) => ({
    chainId: t.integer().notNull(),
    guid: t.hex().notNull(),
    tokenId: t.bigint().notNull(),
    dstEid: t.integer().notNull(),
    from: t.hex().notNull(),
    txHash: t.hex().notNull(),
    logIndex: t.integer().notNull(),
    blockNumber: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.chainId, table.guid] }),
    tokenIdx: index().on(table.tokenId),
  }),
);

/** `ONFTReceived` on the destination chain. */
export const receiveObservation = onchainTable(
  "receive_observation",
  (t) => ({
    chainId: t.integer().notNull(),
    guid: t.hex().notNull(),
    tokenId: t.bigint().notNull(),
    srcEid: t.integer().notNull(),
    to: t.hex().notNull(),
    txHash: t.hex().notNull(),
    logIndex: t.integer().notNull(),
    blockNumber: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.chainId, table.guid] }),
    tokenIdx: index().on(table.tokenId),
  }),
);

/** `Transfer` with both sides non-zero (mint and burn are not ownership transfers). */
export const ownershipTransfer = onchainTable(
  "ownership_transfer",
  (t) => ({
    chainId: t.integer().notNull(),
    txHash: t.hex().notNull(),
    logIndex: t.integer().notNull(),
    tokenId: t.bigint().notNull(),
    from: t.hex().notNull(),
    to: t.hex().notNull(),
    blockNumber: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.chainId, table.txHash, table.logIndex] }),
    tokenIdx: index().on(table.tokenId),
  }),
);
