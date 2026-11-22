import { MANIFEST } from "@idpp/passport-config";
import type { ChainProgress } from "../summary";

const TTL_MS = 3_000;

type StatusBody = Record<string, { id: number; block: { number: number } } | undefined>;

export function resolveStatusUrl(
  env: { INDEXER_STATUS_URL?: string; PORT?: string },
  listeningPort?: number,
): string {
  return env.INDEXER_STATUS_URL || `http://127.0.0.1:${listeningPort ?? env.PORT ?? 42069}/status`;
}

export function createProgressReader({
  fetch,
  statusUrl,
  publicClients,
  now = Date.now,
}: {
  fetch: typeof globalThis.fetch;
  statusUrl: string;
  publicClients: Record<string, { getBlockNumber(): Promise<bigint> } | undefined>;
  now?: () => number;
}) {
  let cached: { at: number; value: ChainProgress[] } | undefined;
  let inflight: Promise<ChainProgress[]> | undefined;

  async function readProgress(): Promise<ChainProgress[]> {
    let status: StatusBody = {};
    try {
      const response = await fetch(statusUrl);
      if (response.ok) status = (await response.json()) as StatusBody;
    } catch {
      // Left empty: every chain is then reported as behind.
    }

    const entries = await Promise.all(
      MANIFEST.chains.map(async (chain): Promise<ChainProgress | undefined> => {
        const indexed = status[chain.network]?.block.number;
        if (indexed === undefined) return undefined;
        try {
          const latest = await publicClients[chain.network]?.getBlockNumber();
          if (latest === undefined) return undefined;
          return { chainId: chain.chainId, indexedBlock: BigInt(indexed), latestBlock: latest };
        } catch {
          return undefined;
        }
      }),
    );
    return entries.filter((entry): entry is ChainProgress => entry !== undefined);
  }

  async function getProgress(): Promise<ChainProgress[]> {
    const at = now();
    if (cached && at - cached.at < TTL_MS) return cached.value;
    if (!inflight) {
      inflight = readProgress()
        .then((value) => {
          cached = { at: now(), value };
          return value;
        })
        .finally(() => {
          inflight = undefined;
        });
    }
    return inflight;
  }

  return { getProgress };
}
