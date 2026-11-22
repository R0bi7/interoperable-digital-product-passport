import { getViemChain } from "@/lib/chains";
import type { TimelineEntry } from "@/lib/indexer/client";

export const LAYERZERO_SCAN = "https://testnet.layerzeroscan.com/tx";

export function chainName(chainId: number): string {
  return getViemChain(chainId)?.name ?? `chain ${chainId}`;
}

export function txUrl(chainId: number, txHash: string): string | undefined {
  const base = getViemChain(chainId)?.blockExplorers?.default.url;
  return base ? `${base}/tx/${txHash}` : undefined;
}

export function addressUrl(chainId: number, address: string): string | undefined {
  const base = getViemChain(chainId)?.blockExplorers?.default.url;
  return base ? `${base}/address/${address}` : undefined;
}

export function layerZeroScanUrl(sourceTxHash: string): string {
  return `${LAYERZERO_SCAN}/${sourceTxHash}`;
}

/** Unix seconds (decimal string) as an ISO-8601 UTC string. */
export function formatTimestamp(seconds: string): string {
  const millis = BigInt(seconds) * 1000n;
  // Timestamps are far below 2^53 ms, so the conversion for Date is exact.
  return new Date(Number(millis)).toISOString().replace(".000Z", "Z");
}

export type Hop = {
  guid: string;
  sent: TimelineEntry;
  received: TimelineEntry | null;
  /** Receive minus send block timestamp in seconds; an approximation, not a latency measurement. */
  intervalSeconds: bigint | null;
};

export type TimelineItem = { kind: "event"; entry: TimelineEntry } | { kind: "hop"; hop: Hop };

/**
 * Timeline entries in indexer order, with `sent` and `received` that share a `guid` merged into
 * one hop at the position of the send. A received entry whose send is not in the timeline stays a
 * plain event, and a send without a receive is a hop with `received: null`.
 */
export function buildTimelineItems(timeline: readonly TimelineEntry[]): TimelineItem[] {
  const sentByGuid = new Map<string, TimelineEntry>();
  for (const entry of timeline) {
    if (entry.kind === "sent" && entry.guid) sentByGuid.set(entry.guid, entry);
  }
  const receivedByGuid = new Map<string, TimelineEntry>();
  for (const entry of timeline) {
    if (entry.kind === "received" && entry.guid && sentByGuid.has(entry.guid)) {
      receivedByGuid.set(entry.guid, entry);
    }
  }
  const items: TimelineItem[] = [];
  for (const entry of timeline) {
    if (entry.kind === "sent" && entry.guid) {
      const received = receivedByGuid.get(entry.guid) ?? null;
      items.push({
        kind: "hop",
        hop: {
          guid: entry.guid,
          sent: entry,
          received,
          intervalSeconds: received ? BigInt(received.timestamp) - BigInt(entry.timestamp) : null,
        },
      });
    } else if (
      entry.kind === "received" &&
      entry.guid &&
      receivedByGuid.get(entry.guid) === entry
    ) {
      // merged into its hop
    } else {
      items.push({ kind: "event", entry });
    }
  }
  return items;
}

export function formatInterval(seconds: bigint): string {
  if (seconds < 120n) return `${seconds} s`;
  return `${seconds / 60n} min ${seconds % 60n} s`;
}
