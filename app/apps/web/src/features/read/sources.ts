import { publicEnv } from "@/lib/env";
import {
  fetchPassport,
  fetchPassports,
  indexerBaseUrl,
  type PassportPage,
  type PassportQuery,
  type PassportSummary,
} from "@/lib/indexer/client";
import { type LiveRecord, publicClientFor, readLiveRecord } from "./live";
import { fetchGatewayPayload, type PayloadFetch, type ReceiptView } from "./verification";

/**
 * Everything the read pages fetch from outside: indexer, IPFS gateway, chain RPC. In `mock` mode
 * (`NEXT_PUBLIC_INDEXER_URL` unset) all three come from `lib/indexer/mock.ts`, so the pages run
 * without an indexer, Pinata, or RPC access.
 */
export type ReadSources = {
  mode: "indexer" | "mock";
  listPassports(query: PassportQuery): Promise<PassportPage>;
  getPassport(tokenId: bigint): Promise<PassportSummary | null>;
  fetchPayload(cid: string): Promise<PayloadFetch>;
  readReceipt(chainId: number, txHash: string): Promise<ReceiptView | null>;
  readLive(chainId: number, tokenId: bigint): Promise<LiveRecord>;
  /** Mock mode only: one line describing what the fixture for `tokenId` simulates. */
  scenario?(tokenId: bigint): Promise<string | undefined>;
};

function indexerSources(baseUrl: string): ReadSources {
  return {
    mode: "indexer",
    listPassports: (query) => fetchPassports(baseUrl, query),
    getPassport: (tokenId) => fetchPassport(baseUrl, tokenId),
    fetchPayload: (cid) => fetchGatewayPayload(publicEnv.NEXT_PUBLIC_PINATA_GATEWAY, cid),
    readReceipt: (chainId, txHash) =>
      publicClientFor(chainId).getTransactionReceipt({ hash: txHash as `0x${string}` }),
    readLive: (chainId, tokenId) => readLiveRecord(publicClientFor(chainId), chainId, tokenId),
  };
}

export function mockSources(): ReadSources {
  return {
    mode: "mock",
    async listPassports(query) {
      return await (await import("@/lib/indexer/mock")).mockFetchPassports(query);
    },
    async getPassport(tokenId) {
      return await (await import("@/lib/indexer/mock")).mockFetchPassport(tokenId);
    },
    async fetchPayload(cid) {
      const bytes = await (await import("@/lib/indexer/mock")).mockGatewayBytes(cid);
      return bytes ? { ok: true, bytes } : { ok: false, reason: "not found on the mock gateway" };
    },
    async readReceipt(chainId, txHash) {
      return (await import("@/lib/indexer/mock")).mockReceipt(chainId, txHash);
    },
    async readLive(chainId, tokenId) {
      const mock = await (await import("@/lib/indexer/mock")).mockPassport(tokenId);
      if (mock?.liveError) throw new Error(mock.liveError);
      const live = mock?.live;
      if (!live || live.chainId !== chainId) {
        return {
          chainId,
          blockNumber: 0n,
          owner: null,
          revision: null,
          cid: null,
          historyHash: null,
        };
      }
      return { ...live };
    },
    async scenario(tokenId) {
      return (await (await import("@/lib/indexer/mock")).mockPassport(tokenId))?.scenario;
    },
  };
}

let cached: ReadSources | undefined;

export function getReadSources(): ReadSources {
  if (!cached) {
    const baseUrl = indexerBaseUrl();
    cached = baseUrl ? indexerSources(baseUrl) : mockSources();
  }
  return cached;
}
