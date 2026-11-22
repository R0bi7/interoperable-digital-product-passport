import type { TimelineEntry } from "@/lib/indexer/client";
import {
  buildTimelineItems,
  chainName,
  formatInterval,
  formatTimestamp,
  type Hop,
  layerZeroScanUrl,
  txUrl,
} from "../timeline";

const EVENT_LABEL: Record<TimelineEntry["kind"], string> = {
  issued: "Issued",
  revised: "Revised",
  transferred: "Ownership transferred",
  sent: "Sent",
  received: "Received",
};

function TxLink({ chainId, txHash, label }: { chainId: number; txHash: string; label?: string }) {
  const url = txUrl(chainId, txHash);
  const text = label ?? `${txHash.slice(0, 10)}…${txHash.slice(-6)}`;
  return url ? (
    <a className="underline underline-offset-2" href={url} target="_blank" rel="noreferrer">
      {text}
    </a>
  ) : (
    <span className="font-mono">{text}</span>
  );
}

function EventRow({ entry }: { entry: TimelineEntry }) {
  return (
    <li className="space-y-2 border-b py-4 text-sm last:border-b-0">
      <div className="font-medium">
        {EVENT_LABEL[entry.kind]} on {chainName(entry.chainId)}
      </div>
      <div className="leading-relaxed text-muted-foreground">
        {formatTimestamp(entry.timestamp)}, block {entry.blockNumber},{" "}
        <TxLink chainId={entry.chainId} txHash={entry.txHash} />
      </div>
    </li>
  );
}

function HopRow({ hop }: { hop: Hop }) {
  const { sent, received } = hop;
  return (
    <li className="space-y-2 border-b py-4 text-sm last:border-b-0">
      <div className="font-medium">
        Hop: {chainName(sent.chainId)} to{" "}
        {received ? chainName(received.chainId) : "destination not confirmed yet"}
      </div>
      <div className="leading-relaxed text-muted-foreground">
        Sent {formatTimestamp(sent.timestamp)}, block {sent.blockNumber},{" "}
        <TxLink chainId={sent.chainId} txHash={sent.txHash} />
      </div>
      {received ? (
        <div className="leading-relaxed text-muted-foreground">
          Received {formatTimestamp(received.timestamp)}, block {received.blockNumber},{" "}
          <TxLink chainId={received.chainId} txHash={received.txHash} />
        </div>
      ) : (
        <div className="leading-relaxed text-muted-foreground">
          No receive recorded for this message in the indexed range.
        </div>
      )}
      {hop.intervalSeconds !== null && (
        <div>
          Block interval (approximate): {formatInterval(hop.intervalSeconds)}
          <span className="ml-1 text-xs text-muted-foreground">
            (difference of the two block timestamps, not a latency measurement)
          </span>
        </div>
      )}
      <div className="break-all text-xs text-muted-foreground">
        guid <span className="font-mono">{hop.guid}</span>
      </div>
      <a
        className="text-xs underline underline-offset-2"
        href={layerZeroScanUrl(sent.txHash)}
        target="_blank"
        rel="noreferrer"
      >
        LayerZero Scan
      </a>
    </li>
  );
}

export function TimelineView({ timeline }: { timeline: readonly TimelineEntry[] }) {
  const items = buildTimelineItems(timeline);
  if (items.length === 0) {
    return <p className="leading-relaxed text-muted-foreground">No events recorded.</p>;
  }
  return (
    <ol className="flex flex-col">
      {items.map((item) =>
        item.kind === "hop" ? (
          <HopRow key={`hop-${item.hop.guid}`} hop={item.hop} />
        ) : (
          <EventRow
            key={`${item.entry.chainId}-${item.entry.txHash}-${item.entry.kind}-${item.entry.guid ?? ""}`}
            entry={item.entry}
          />
        ),
      )}
    </ol>
  );
}
