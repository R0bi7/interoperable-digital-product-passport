import { whiskyDistilleryAbi } from "@idpp/passport-config";
import { createPublicClient, http, type PublicClient } from "viem";
import { getContractAddress, getViemChain } from "@/lib/chains";
import type { PassportSummary } from "@/lib/indexer/client";

/** `ownerOf` and `passportOf` of one token, read together at one block. */
export type LiveRecord = {
  chainId: number;
  /** Block both calls were read at. */
  blockNumber: bigint;
  /** `null` when `ownerOf` reverted, i.e. the token does not exist on this chain. */
  owner: string | null;
  revision: string | null;
  cid: string | null;
  historyHash: string | null;
};

type LiveClient = Pick<PublicClient, "getBlockNumber" | "multicall">;

/**
 * One `getBlockNumber`, then one `multicall` at that explicit block number reading `ownerOf` and
 * `passportOf`, so owner and passport come from the same state.
 */
export async function readLiveRecord(
  client: LiveClient,
  chainId: number,
  tokenId: bigint,
): Promise<LiveRecord> {
  const address = getContractAddress(chainId);
  if (!address) throw new Error(`chain ${chainId} is not part of this deployment`);
  const blockNumber = await client.getBlockNumber();
  const [owner, passport] = await client.multicall({
    allowFailure: true,
    blockNumber,
    contracts: [
      { address, abi: whiskyDistilleryAbi, functionName: "ownerOf", args: [tokenId] },
      { address, abi: whiskyDistilleryAbi, functionName: "passportOf", args: [tokenId] },
    ],
  });
  if (owner.status === "failure") {
    return { chainId, blockNumber, owner: null, revision: null, cid: null, historyHash: null };
  }
  if (passport.status === "failure") {
    throw new Error(`passportOf failed on chain ${chainId}: ${passport.error.message}`);
  }
  return {
    chainId,
    blockNumber,
    owner: owner.result,
    revision: passport.result.revision.toString(),
    cid: passport.result.cid,
    historyHash: passport.result.historyHash,
  };
}

const clients = new Map<number, PublicClient>();

/** Browser RPC client for a chain of the deployment (the chain's default public RPC). */
export function publicClientFor(chainId: number): PublicClient {
  const cached = clients.get(chainId);
  if (cached) return cached;
  const chain = getViemChain(chainId);
  if (!chain) throw new Error(`chain ${chainId} is not part of this deployment`);
  const client = createPublicClient({ chain, transport: http() }) as PublicClient;
  clients.set(chainId, client);
  return client;
}

export type LiveComparison = { agrees: boolean; differences: string[] };

/**
 * Compares the indexer summary with the live read. A difference means the indexer is behind (or
 * wrong); the page then shows the live values.
 */
export function compareLive(summary: PassportSummary, live: LiveRecord): LiveComparison {
  const differences: string[] = [];
  const same = (a: string | null, b: string | null) =>
    (a ?? "").toLowerCase() === (b ?? "").toLowerCase();
  if (live.owner === null) {
    differences.push(
      `the token is not present on chain ${live.chainId} at block ${live.blockNumber}`,
    );
  } else {
    if (!same(summary.owner, live.owner)) {
      differences.push(`owner: indexer ${summary.owner ?? "none"}, chain ${live.owner}`);
    }
    if (summary.revision !== live.revision) {
      differences.push(`revision: indexer ${summary.revision ?? "none"}, chain ${live.revision}`);
    }
    if (summary.cid !== live.cid) {
      differences.push(`cid: indexer ${summary.cid ?? "none"}, chain ${live.cid}`);
    }
  }
  return { agrees: differences.length === 0, differences };
}
