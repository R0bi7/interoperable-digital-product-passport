import * as schema from "../ponder.schema";
import type {
  ChainPassportRow,
  PassportRevisionRow,
  ReceiveRow,
  RevisionObservationRow,
  SendRow,
  TokenRows,
  TransferRow,
} from "../src/summary";

/**
 * In-memory stand-in for Ponder's `context.db`, supporting exactly what `src/handlers.ts` uses:
 * `insert(table).values(row)` with optional `onConflictDoNothing()` / `onConflictDoUpdate(patch)`.
 * Rows are keyed by the table's primary-key columns, like the real store. It also records the
 * chain id of every row's writers so tests can assert that no row is written from two chains.
 */

type Row = Record<string, unknown>;
type Table = object;

const PRIMARY_KEYS = new Map<Table, readonly string[]>([
  [schema.chainEvent, ["chainId", "txHash", "logIndex"]],
  [schema.chainPassport, ["chainId", "tokenId"]],
  [schema.passportRevision, ["tokenId", "revision", "chainId"]],
  [schema.revisionObservation, ["chainId", "txHash", "logIndex"]],
  [schema.sendObservation, ["chainId", "guid"]],
  [schema.receiveObservation, ["chainId", "guid"]],
  [schema.ownershipTransfer, ["chainId", "txHash", "logIndex"]],
]);

export class FakeStore {
  readonly tables = new Map<Table, Map<string, Row>>();
  /** Chain ids that wrote each row, keyed by `<table index>:<pk>`. */
  readonly writers = new Map<string, Set<number>>();
  currentChainId = 0;

  rows<T = Row>(table: Table): T[] {
    return [...(this.tables.get(table)?.values() ?? [])] as T[];
  }

  readonly db = {
    insert: (table: Table) => {
      const keyColumns = PRIMARY_KEYS.get(table);
      if (!keyColumns) throw new Error("unknown table");
      return {
        values: (row: Row) => {
          const key = keyColumns.map((column) => String(row[column])).join("|");
          const rows = this.tables.get(table) ?? new Map<string, Row>();
          this.tables.set(table, rows);
          const writerKey = `${[...PRIMARY_KEYS.keys()].indexOf(table)}:${key}`;
          const writers = this.writers.get(writerKey) ?? new Set<number>();
          writers.add(this.currentChainId);
          this.writers.set(writerKey, writers);

          const run = (onConflict: "error" | "nothing" | Row) => {
            const existing = rows.get(key);
            if (!existing) rows.set(key, { ...row });
            else if (onConflict === "error") throw new Error(`duplicate key ${key}`);
            else if (onConflict !== "nothing") Object.assign(existing, onConflict);
            return Promise.resolve();
          };
          return {
            onConflictDoNothing: () => run("nothing"),
            onConflictDoUpdate: (patch: Row) => run(patch),
            // biome-ignore lint/suspicious/noThenProperty: mimics the awaitable insert builder
            then: (resolve: () => void, reject: (error: unknown) => void) =>
              run("error").then(resolve, reject),
          };
        },
      };
    },
  };

  /** Rows of one token in the shapes `deriveSummary` takes. */
  tokenRows(tokenId: bigint): TokenRows {
    const mine = <T extends { tokenId: bigint }>(table: Table) =>
      this.rows<T>(table).filter((row) => row.tokenId === tokenId);
    return {
      chainPassports: mine<ChainPassportRow>(schema.chainPassport),
      revisions: mine<PassportRevisionRow>(schema.passportRevision),
      observations: mine<RevisionObservationRow>(schema.revisionObservation),
      sends: mine<SendRow>(schema.sendObservation),
      receives: mine<ReceiveRow>(schema.receiveObservation),
      transfers: mine<TransferRow>(schema.ownershipTransfer),
    };
  }
}
