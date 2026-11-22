import {
  canonicalBytes,
  historyHashOf,
  MANIFEST,
  whiskyDistilleryAbi,
} from "@idpp/passport-config";
import { type Address, encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
import type { ReceiptView } from "@/features/read/verification";
import { getContractAddress } from "@/lib/chains";
import type { PassportPage, PassportQuery, PassportSummary, TimelineEntry } from "./types";

/**
 * Fixture summaries, payload bytes and live records for the read path. Used by the tests and, when
 * `NEXT_PUBLIC_INDEXER_URL` is unset, by the UI (indexer, gateway and RPC are all replaced), so the
 * package works without a running indexer, Pinata, or an RPC key. Every address, hash, block and
 * timestamp here is invented; nothing refers to a real transaction.
 */

const ARBITRUM = 421614;
const BASE = 84532;
const SEPOLIA = 11155111;
const T0 = 1_790_900_000;

const ALICE = "0x00000000000000000000000000000000000a11ce";
const BOB = "0x0000000000000000000000000000000000000b0b";

let txCounter = 0;
const fakeTx = () => `0x${(++txCounter).toString(16).padStart(64, "0")}`;
const fakeGuid = (n: number) => `0x${"6d".repeat(15)}${n.toString(16).padStart(4, "0")}`;

type Envelope = Record<string, unknown>;

function envelope(
  tokenId: string,
  revision: number,
  previousCid: string | null,
  kind: "cask" | "bottle",
  data: Record<string, unknown>,
): Envelope {
  return {
    schema: "idpp-passport/1",
    deploymentId: MANIFEST.deploymentId,
    tokenId,
    revision: String(revision),
    previousCid,
    kind,
    granularity: "item",
    data,
  };
}

function caskData(caskNumber: string, description: string): Record<string, unknown> {
  return {
    distillery: "Demo Distillery",
    caskType: "Bourbon barrel",
    caskNumber,
    volumeLiters: "200",
    alcoholByVolume: "63.5",
    fillDate: "2026-10-01",
    origin: { country: "Scotland", region: "Speyside" },
    description,
  };
}

const bottleData = (sourceTokenId: string): Record<string, unknown> => ({
  brand: "Demo Single Malt",
  bottleType: "Standard",
  bottledDate: "2026-10-05",
  volumeMl: "700",
  alcoholByVolume: "46",
  sourceCasks: [{ tokenId: sourceTokenId, revision: "1", volumeMl: "700" }],
  description: "Bottled from one cask.",
});

type Built = { cid: string; bytes: Uint8Array; envelope: Envelope };

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/**
 * CIDv1, raw, sha2-256, base32 lower, via WebCrypto. `computeCidV1` from passport-config is
 * synchronous and throws in a browser bundle, and the fixtures are built in the browser in mock
 * mode. mock.test.ts checks this against `computeCidV1` under Node.
 */
export async function cidOfBytes(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource),
  );
  const input = [0x01, 0x55, 0x12, 0x20, ...digest]; // version, raw, sha2-256, length
  let bits = 0;
  let value = 0;
  let out = "b"; // multibase prefix for base32 lower
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

async function build(env: Envelope): Promise<Built> {
  const bytes = canonicalBytes(env);
  return { cid: await cidOfBytes(bytes), bytes, envelope: env };
}

function progress(lagOn?: number): PassportSummary["progress"] {
  return [ARBITRUM, BASE, SEPOLIA].map((chainId) => {
    const latest = 1_000_000n + BigInt(chainId % 1000);
    return {
      chainId,
      latestBlock: latest.toString(),
      indexedBlock: (chainId === lagOn ? latest - 5_000n : latest).toString(),
    };
  });
}

function entry(
  kind: TimelineEntry["kind"],
  chainId: number,
  seconds: number,
  block: number,
  guid?: string,
): TimelineEntry {
  return {
    kind,
    chainId,
    txHash: fakeTx(),
    blockNumber: String(block),
    timestamp: String(T0 + seconds),
    ...(guid ? { guid } : {}),
  };
}

/** One payload per revision, the bytes the (mock) gateway serves for a CID. */
export type MockPassport = {
  summary: PassportSummary;
  /** CID -> bytes served by the mock gateway. Absent CIDs are "not found". */
  payloads: ReadonlyMap<string, Uint8Array>;
  /** What `ownerOf` / `passportOf` return at the mock block; `null` when no chain holds the token. */
  live: {
    chainId: number;
    blockNumber: bigint;
    owner: string;
    revision: string;
    cid: string;
    /** `historyHash` over the CIDs the chain recorded for revisions 0..revision. */
    historyHash: string;
  } | null;
  /** Short description of the scenario, shown next to the mock banner. */
  scenario: string;
  liveError?: string;
  receipts?: ReadonlyMap<string, ReceiptView>;
};

function revisionRows(
  builds: Built[],
  chainIds: number[],
  author: string,
  seconds: number[],
): PassportSummary["revisions"] {
  return builds.map((built, i) => ({
    revision: String(i),
    cid: built.cid,
    chainId: chainIds[i] as number,
    author,
    txHash: fakeTx(),
    timestamp: String(T0 + (seconds[i] as number)),
    conflict: false,
  }));
}

function payloadMap(...builds: Built[]): Map<string, Uint8Array> {
  return new Map(builds.map((b) => [b.cid, b.bytes]));
}

function summaryOf(
  tokenId: string,
  originChainId: number,
  rest: Partial<PassportSummary> & Pick<PassportSummary, "status" | "revisions" | "timeline">,
): PassportSummary {
  return {
    deploymentId: MANIFEST.deploymentId,
    tokenId,
    originChainId,
    currentChainId: null,
    owner: null,
    revision: null,
    cid: null,
    progress: progress(),
    ...rest,
  };
}

async function buildFixtures(): Promise<MockPassport[]> {
  txCounter = 0;
  const fixtures: MockPassport[] = [];

  // A: held on ARBITRUM after ARBITRUM -> Base Sepolia -> ARBITRUM, revised on Base Sepolia.
  {
    const id = "421614000000000001";
    const r0 = await build(
      envelope(id, 0, null, "cask", caskData("1", "Filled at the distillery.")),
    );
    const r1 = await build(
      envelope(id, 1, r0.cid, "cask", caskData("1", "Revised on Base Sepolia after a tasting.")),
    );
    fixtures.push({
      scenario:
        "held on Arbitrum Sepolia after ARBITRUM -> Base Sepolia -> ARBITRUM, revised on Base Sepolia",
      summary: summaryOf(id, ARBITRUM, {
        status: "held",
        currentChainId: ARBITRUM,
        owner: BOB,
        revision: "1",
        cid: r1.cid,
        revisions: revisionRows([r0, r1], [ARBITRUM, BASE], ALICE, [0, 200]),
        timeline: [
          entry("issued", ARBITRUM, 0, 136_300_001),
          entry("sent", ARBITRUM, 60, 136_300_030, fakeGuid(1)),
          entry("received", BASE, 75, 59_320_010, fakeGuid(1)),
          entry("revised", BASE, 200, 59_320_090),
          entry("sent", BASE, 300, 59_320_150, fakeGuid(2)),
          entry("received", ARBITRUM, 318, 136_300_190, fakeGuid(2)),
          entry("transferred", ARBITRUM, 400, 136_300_260),
        ],
      }),
      payloads: payloadMap(r0, r1),
      live: {
        chainId: ARBITRUM,
        blockNumber: 136_300_300n,
        owner: BOB,
        revision: "1",
        cid: r1.cid,
        historyHash: historyHashOf(id, [r0.cid, r1.cid]),
      },
    });
  }

  // B: in flight, ARBITRUM -> Sepolia sent, not yet received. A bottle made from cask A.
  {
    const id = "421614000000000002";
    const r0 = await build(envelope(id, 0, null, "bottle", bottleData("421614000000000001")));
    fixtures.push({
      scenario: "in flight, ARBITRUM -> Sepolia sent and not yet received (bottle)",
      summary: summaryOf(id, ARBITRUM, {
        status: "in_flight",
        revisions: revisionRows([r0], [ARBITRUM], ALICE, [0]),
        timeline: [
          entry("issued", ARBITRUM, 0, 136_301_001),
          entry("sent", ARBITRUM, 90, 136_301_040, fakeGuid(3)),
        ],
      }),
      payloads: payloadMap(r0),
      live: null,
    });
  }

  // C: incomplete, the indexer lags on Sepolia; the payload is not on the gateway.
  {
    const id = "84532000000000000";
    const r0 = await build(envelope(id, 0, null, "cask", caskData("2", "Filled on Base Sepolia.")));
    fixtures.push({
      scenario: "incomplete, the indexer is behind on Sepolia; payload missing on the gateway",
      summary: summaryOf(id, BASE, {
        status: "incomplete",
        progress: progress(SEPOLIA),
        revisions: revisionRows([r0], [BASE], ALICE, [0]),
        timeline: [entry("issued", BASE, 0, 59_321_001)],
      }),
      payloads: new Map(),
      live: null,
    });
  }

  // D: revision 1 bytes on the gateway do not hash to the CID (content failed).
  {
    const id = "84532000000000001";
    const r0 = await build(envelope(id, 0, null, "cask", caskData("3", "Filled on Base Sepolia.")));
    const r1 = await build(
      envelope(id, 1, r0.cid, "cask", caskData("3", "Revised on Base Sepolia.")),
    );
    const tampered = await build(
      envelope(id, 1, r0.cid, "cask", {
        ...caskData("3", "Revised on Base Sepolia."),
        volumeLiters: "250",
      }),
    );
    fixtures.push({
      scenario: "tampered: the gateway serves other bytes for revision 1 (content fails)",
      summary: summaryOf(id, BASE, {
        status: "held",
        currentChainId: BASE,
        owner: ALICE,
        revision: "1",
        cid: r1.cid,
        revisions: revisionRows([r0, r1], [BASE, BASE], ALICE, [0, 120]),
        timeline: [entry("issued", BASE, 0, 59_322_001), entry("revised", BASE, 120, 59_322_060)],
      }),
      payloads: new Map([
        [r0.cid, r0.bytes],
        [r1.cid, tampered.bytes],
      ]),
      live: {
        chainId: BASE,
        blockNumber: 59_322_100n,
        owner: ALICE,
        revision: "1",
        cid: r1.cid,
        historyHash: historyHashOf(id, [r0.cid, r1.cid]),
      },
    });
  }

  // E: valid CID over an envelope that names another token (binding failed).
  {
    const id = "11155111000000000000";
    const r0 = await build(
      envelope("421614000000000099", 0, null, "cask", caskData("4", "Names another token.")),
    );
    fixtures.push({
      scenario:
        "tampered: the envelope under the CID names token 421614000000000099 (binding fails)",
      summary: summaryOf(id, SEPOLIA, {
        status: "held",
        currentChainId: SEPOLIA,
        owner: ALICE,
        revision: "0",
        cid: r0.cid,
        revisions: revisionRows([r0], [SEPOLIA], ALICE, [0]),
        timeline: [entry("issued", SEPOLIA, 0, 11_894_501)],
      }),
      payloads: payloadMap(r0),
      live: {
        chainId: SEPOLIA,
        blockNumber: 11_894_600n,
        owner: ALICE,
        revision: "0",
        cid: r0.cid,
        historyHash: historyHashOf(id, [r0.cid]),
      },
    });
  }

  // F: revision 1 has a valid CID, but its previousCid is not revision 0's CID (history failed).
  {
    const id = "11155111000000000001";
    const r0 = await build(envelope(id, 0, null, "cask", caskData("5", "Filled on Sepolia.")));
    const stranger = "bafkreibnugdjrt4xfyb4untqebjbktbq7lhbbxbiwtlgcefchoioao6dhm";
    const r1 = await build(
      envelope(id, 1, stranger, "cask", caskData("5", "Revised, wrong parent.")),
    );
    fixtures.push({
      scenario:
        "tampered: revision 1 points at a previousCid that is not revision 0 (history fails)",
      summary: summaryOf(id, SEPOLIA, {
        status: "held",
        currentChainId: SEPOLIA,
        owner: BOB,
        revision: "1",
        cid: r1.cid,
        revisions: revisionRows([r0, r1], [SEPOLIA, SEPOLIA], ALICE, [0, 150]),
        timeline: [
          entry("issued", SEPOLIA, 0, 11_894_701),
          entry("revised", SEPOLIA, 150, 11_894_740),
        ],
      }),
      payloads: payloadMap(r0, r1),
      live: {
        chainId: SEPOLIA,
        blockNumber: 11_894_800n,
        owner: BOB,
        revision: "1",
        cid: r1.cid,
        historyHash: historyHashOf(id, [r0.cid, r1.cid]),
      },
    });
  }

  // G: the indexer shows revision 0, the chain already holds revision 1 (indexer behind).
  {
    const id = "421614000000000003";
    const r0 = await build(
      envelope(id, 0, null, "cask", caskData("6", "Filled at the distillery.")),
    );
    const r1 = await build(
      envelope(id, 1, r0.cid, "cask", caskData("6", "Revised, not yet indexed.")),
    );
    fixtures.push({
      scenario: "indexer behind: the indexer shows revision 0, the chain holds revision 1",
      summary: summaryOf(id, ARBITRUM, {
        status: "held",
        currentChainId: ARBITRUM,
        owner: ALICE,
        revision: "0",
        cid: r0.cid,
        revisions: revisionRows([r0], [ARBITRUM], ALICE, [0]),
        timeline: [entry("issued", ARBITRUM, 0, 136_302_001)],
      }),
      payloads: payloadMap(r0, r1),
      live: {
        chainId: ARBITRUM,
        blockNumber: 136_302_100n,
        owner: ALICE,
        revision: "1",
        cid: r1.cid,
        historyHash: historyHashOf(id, [r0.cid, r1.cid]),
      },
    });
  }

  // H: decoy. The chain recorded r0 then r1, but r1's payload names a decoy revision 0 that was
  // never recorded, and the indexer lists that decoy. content, binding and history all pass; the
  // live history hash and the independent receipt show that revision 0 is not the recorded one.
  {
    const id = "421614000000000004";
    const r0 = await build(
      envelope(id, 0, null, "cask", caskData("7", "Filled at the distillery.")),
    );
    const decoy = await build(
      envelope(id, 0, null, "cask", caskData("7", "A revision 0 that was never recorded.")),
    );
    const r1 = await build(
      envelope(id, 1, decoy.cid, "cask", caskData("7", "Revised, pointing at the decoy.")),
    );
    const rows = revisionRows([decoy, r1], [ARBITRUM, ARBITRUM], ALICE, [0, 90]);
    fixtures.push({
      receipts: new Map(
        rows.map((row) => [
          row.txHash,
          mockRevisionReceipt(id, { ...row, cid: row.revision === "0" ? r0.cid : row.cid }),
        ]),
      ),
      scenario:
        "decoy: the indexer lists a revision 0 the chain never recorded (history hash and recorded fail)",
      summary: summaryOf(id, ARBITRUM, {
        status: "held",
        currentChainId: ARBITRUM,
        owner: ALICE,
        revision: "1",
        cid: r1.cid,
        revisions: rows,
        timeline: [
          entry("issued", ARBITRUM, 0, 136_303_001),
          entry("revised", ARBITRUM, 90, 136_303_040),
        ],
      }),
      payloads: payloadMap(r0, decoy, r1),
      live: {
        chainId: ARBITRUM,
        blockNumber: 136_303_100n,
        owner: ALICE,
        revision: "1",
        cid: r1.cid,
        historyHash: historyHashOf(id, [r0.cid, r1.cid]),
      },
    });
  }

  // I and J preserve valid historical receipts even though the current live state is unavailable/older.
  for (const [suffix, failed] of [
    ["5", true],
    ["6", false],
  ] as const) {
    const id = `42161400000000000${suffix}`;
    const r0 = await build(envelope(id, 0, null, "cask", caskData(suffix, "Filled.")));
    const r1 = await build(envelope(id, 1, r0.cid, "cask", caskData(suffix, "Revised.")));
    fixtures.push({
      scenario: failed
        ? "live read fails; historical receipts remain available"
        : "indexer ahead of the chain: indexed revision 1, live revision 0",
      summary: summaryOf(id, ARBITRUM, {
        status: "held",
        currentChainId: ARBITRUM,
        owner: ALICE,
        revision: "1",
        cid: r1.cid,
        revisions: revisionRows([r0, r1], [ARBITRUM, BASE], ALICE, [0, 90]),
        timeline: [
          entry("issued", ARBITRUM, 0, 136_304_001),
          entry("revised", BASE, 90, 59_324_001),
        ],
      }),
      payloads: payloadMap(r0, r1),
      liveError: failed ? "mock RPC is unavailable" : undefined,
      live: {
        chainId: ARBITRUM,
        blockNumber: 136_304_100n,
        owner: ALICE,
        revision: failed ? "1" : "0",
        cid: failed ? r1.cid : r0.cid,
        historyHash: historyHashOf(id, failed ? [r0.cid, r1.cid] : [r0.cid]),
      },
    });
  }
  for (const fixture of fixtures) {
    fixture.receipts ??= new Map(
      fixture.summary.revisions.map((row) => [
        row.txHash,
        mockRevisionReceipt(fixture.summary.tokenId, row),
      ]),
    );
  }
  return fixtures;
}

let fixtures: Promise<readonly MockPassport[]> | undefined;

/** The fixtures, built once (hashing is asynchronous in the browser). */
export function loadMockPassports(): Promise<readonly MockPassport[]> {
  fixtures ??= buildFixtures();
  return fixtures;
}

export async function mockPassport(tokenId: bigint): Promise<MockPassport | undefined> {
  return (await loadMockPassports()).find((p) => p.summary.tokenId === tokenId.toString());
}

/** Same filter and pagination semantics as `GET /api/passports` (`cursor` is an offset). */
export async function mockFetchPassports(query: PassportQuery = {}): Promise<PassportPage> {
  const matching = (await loadMockPassports())
    .map((p) => p.summary)
    .filter(
      (s) =>
        (query.chainId === undefined || (s.currentChainId ?? s.originChainId) === query.chainId) &&
        (query.status === undefined || s.status === query.status),
    );
  const start = query.cursor ? Number.parseInt(query.cursor, 10) : 0;
  const limit = query.limit ?? 20;
  const items = matching.slice(start, start + limit);
  const next = start + limit;
  return { items, nextCursor: next < matching.length ? String(next) : null };
}

export async function mockFetchPassport(tokenId: bigint): Promise<PassportSummary | null> {
  return (await mockPassport(tokenId))?.summary ?? null;
}

/** Bytes the mock gateway serves for `cid`, or `undefined` for not found. */
export async function mockGatewayBytes(cid: string): Promise<Uint8Array | undefined> {
  for (const passport of await loadMockPassports()) {
    const bytes = passport.payloads.get(cid);
    if (bytes) return bytes;
  }
  return undefined;
}

/** Encode exactly the deployed event ABI, so mock and RPC receipts use the same verifier. */
export function mockRevisionReceipt(
  tokenId: string,
  row: Pick<PassportSummary["revisions"][number], "revision" | "cid" | "chainId" | "author">,
): ReceiptView {
  const address = getContractAddress(row.chainId);
  if (!address) throw new Error("unknown fixture chain");
  const author = row.author as Address;
  const topics =
    row.revision === "0"
      ? encodeEventTopics({
          abi: whiskyDistilleryAbi,
          eventName: "PassportIssued",
          args: { tokenId: BigInt(tokenId) },
        })
      : encodeEventTopics({
          abi: whiskyDistilleryAbi,
          eventName: "PassportRevised",
          args: { tokenId: BigInt(tokenId), author },
        });
  const data =
    row.revision === "0"
      ? encodeAbiParameters([{ type: "string" }], [row.cid])
      : encodeAbiParameters(
          [{ type: "uint64" }, { type: "string" }],
          [BigInt(row.revision), row.cid],
        );
  return {
    status: "success",
    from: author,
    logs: [{ address, topics: topics as [Hex, ...Hex[]], data }],
  };
}

export async function mockReceipt(chainId: number, txHash: string): Promise<ReceiptView | null> {
  for (const fixture of await loadMockPassports()) {
    if (!fixture.summary.revisions.some((row) => row.chainId === chainId && row.txHash === txHash))
      continue;
    return fixture.receipts?.get(txHash) ?? null;
  }
  return null;
}
