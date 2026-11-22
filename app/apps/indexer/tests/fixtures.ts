import {
  onONFTReceived,
  onONFTSent,
  onPassportImported,
  onPassportIssued,
  onPassportRevised,
  onTransfer,
} from "../src/handlers";
import { FakeStore } from "./fake-store";

export const ARBITRUM = 421614;
export const BASE = 84532;
export const SEPOLIA = 11155111;

export const ZERO = "0x0000000000000000000000000000000000000000";
export const ALICE = "0x00000000000000000000000000000000000a11ce";
export const BOB = "0x0000000000000000000000000000000000000b0b";
export const CAROL = "0x000000000000000000000000000000000000ca01";
export const OPERATOR = "0x00000000000000000000000000000000000000f0";

export const CID0 = "bafkreia";
export const CID1 = "bafkreib";
export const CID2 = "bafkreic";

/** Token issued on Arbitrum Sepolia (origin chain 421614). */
export const TOKEN = 421_614_000_000_000_006n;

export const guid = (n: number): `0x${string}` => `0x${n.toString(16).padStart(64, "0")}`;
const txHash = (n: number): `0x${string}` => `0x${n.toString(16).padStart(64, "0")}`;

type Name =
  | "Transfer"
  | "PassportIssued"
  | "PassportRevised"
  | "PassportImported"
  | "ONFTSent"
  | "ONFTReceived";

export type Fixture = {
  chainId: number;
  name: Name;
  args: Record<string, unknown>;
  block: bigint;
  timestamp: bigint;
  logIndex: number;
  tx: number;
  from?: string;
};

const handlers = {
  Transfer: onTransfer,
  PassportIssued: onPassportIssued,
  PassportRevised: onPassportRevised,
  PassportImported: onPassportImported,
  ONFTSent: onONFTSent,
  ONFTReceived: onONFTReceived,
} as const;

/** Runs one decoded log through its handler against the fake store. */
export async function apply(store: FakeStore, f: Fixture): Promise<void> {
  store.currentChainId = f.chainId;
  const event = {
    args: f.args,
    log: { address: "0x00000000000000000000000000000000000000aa", logIndex: f.logIndex },
    block: { number: f.block, timestamp: f.timestamp, hash: txHash(Number(f.block)) },
    transaction: { hash: txHash(f.tx), from: f.from ?? ALICE },
  };
  const context = { chain: { id: f.chainId }, db: store.db };
  // The handlers are typed against Ponder's generated event types; the fake mirrors their shape.
  await (handlers[f.name] as (args: unknown) => Promise<void>)({ event, context });
}

export const fx = (
  chainId: number,
  name: Name,
  args: Record<string, unknown>,
  at: { block: number; ts: number; log: number; tx: number; from?: string },
): Fixture => ({
  chainId,
  name,
  args,
  block: BigInt(at.block),
  timestamp: BigInt(at.ts),
  logIndex: at.log,
  tx: at.tx,
  ...(at.from === undefined ? {} : { from: at.from }),
});

/**
 * Round trip ARBITRUM -> Base Sepolia -> ARBITRUM with a revision on each leg, as the harness produces it. Per-chain
 * streams are in (block, logIndex) order, as Ponder delivers them.
 *
 *   ARBITRUM   t=100 mint (Issued rev0, Transfer 0->alice)   t=110 revise rev1 (alice)
 *         t=120 send (Transfer alice->0, ONFTSent g1)
 *   Base Sepolia  t=145 receive (Transfer 0->bob, Imported rev1, ONFTReceived g1)
 *         t=150 revise rev2 (bob)   t=160 send (Transfer bob->0, ONFTSent g2)
 *   ARBITRUM   t=190 receive (Transfer 0->carol, Imported rev2, ONFTReceived g2)
 */
export function roundTrip(): { arbitrum: Fixture[]; base: Fixture[] } {
  const arbitrum = [
    fx(
      ARBITRUM,
      "PassportIssued",
      { tokenId: TOKEN, cid: CID0 },
      { block: 1000, ts: 100, log: 0, tx: 1, from: OPERATOR },
    ),
    fx(
      ARBITRUM,
      "Transfer",
      { from: ZERO, to: ALICE, tokenId: TOKEN },
      { block: 1000, ts: 100, log: 1, tx: 1, from: OPERATOR },
    ),
    fx(
      ARBITRUM,
      "PassportRevised",
      { tokenId: TOKEN, revision: 1n, cid: CID1, author: ALICE },
      { block: 1001, ts: 110, log: 0, tx: 2, from: ALICE },
    ),
    fx(
      ARBITRUM,
      "Transfer",
      { from: ALICE, to: ZERO, tokenId: TOKEN },
      { block: 1002, ts: 120, log: 0, tx: 3, from: ALICE },
    ),
    fx(
      ARBITRUM,
      "ONFTSent",
      { guid: guid(1), dstEid: 40245, fromAddress: ALICE, tokenId: TOKEN },
      { block: 1002, ts: 120, log: 1, tx: 3, from: ALICE },
    ),
    fx(
      ARBITRUM,
      "Transfer",
      { from: ZERO, to: CAROL, tokenId: TOKEN },
      { block: 1100, ts: 190, log: 0, tx: 8, from: OPERATOR },
    ),
    fx(
      ARBITRUM,
      "PassportImported",
      { tokenId: TOKEN, revision: 2n, cid: CID2 },
      { block: 1100, ts: 190, log: 1, tx: 8, from: OPERATOR },
    ),
    fx(
      ARBITRUM,
      "ONFTReceived",
      { guid: guid(2), srcEid: 40245, toAddress: CAROL, tokenId: TOKEN },
      { block: 1100, ts: 190, log: 2, tx: 8, from: OPERATOR },
    ),
  ];
  const base = [
    fx(
      BASE,
      "Transfer",
      { from: ZERO, to: BOB, tokenId: TOKEN },
      { block: 5000, ts: 145, log: 0, tx: 4, from: OPERATOR },
    ),
    fx(
      BASE,
      "PassportImported",
      { tokenId: TOKEN, revision: 1n, cid: CID1 },
      { block: 5000, ts: 145, log: 1, tx: 4, from: OPERATOR },
    ),
    fx(
      BASE,
      "ONFTReceived",
      { guid: guid(1), srcEid: 40231, toAddress: BOB, tokenId: TOKEN },
      { block: 5000, ts: 145, log: 2, tx: 4, from: OPERATOR },
    ),
    fx(
      BASE,
      "PassportRevised",
      { tokenId: TOKEN, revision: 2n, cid: CID2, author: BOB },
      { block: 5001, ts: 150, log: 0, tx: 5, from: BOB },
    ),
    fx(
      BASE,
      "Transfer",
      { from: BOB, to: ZERO, tokenId: TOKEN },
      { block: 5002, ts: 160, log: 0, tx: 6, from: BOB },
    ),
    fx(
      BASE,
      "ONFTSent",
      { guid: guid(2), dstEid: 40231, fromAddress: BOB, tokenId: TOKEN },
      { block: 5002, ts: 160, log: 1, tx: 6, from: BOB },
    ),
  ];
  return { arbitrum, base };
}

export async function ingest(fixtures: readonly Fixture[]): Promise<FakeStore> {
  const store = new FakeStore();
  for (const fixture of fixtures) await apply(store, fixture);
  return store;
}
