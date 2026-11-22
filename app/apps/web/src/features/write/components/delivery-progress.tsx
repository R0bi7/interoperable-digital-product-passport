"use client";

import { MANIFEST } from "@idpp/passport-config";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { Address } from "viem";
import { Notice } from "@/features/write/components/ui";
import { usePublicClientFor } from "@/features/write/hooks/use-passport";
import {
  type DestinationRead,
  deriveProgress,
  fetchIndexerObservation,
  fetchScanStatus,
  readDestination,
  type StepState,
} from "@/features/write/lib/delivery";
import type { DeliveryClock } from "@/features/write/lib/delivery-clock";
import { deliveryPolls } from "@/features/write/lib/delivery-polls";
import { chainName } from "@/features/write/lib/links";
import { lzScanTxUrl } from "@/features/write/lib/send-param";
import { indexerBaseUrl } from "@/lib/indexer/client";

const POLL_MS = 6_000;
/** After this long without delivery the panel says "not yet observed". It never says "failed". */
export const DELIVERY_TIMEOUT_MS = 10 * 60_000;

export type DeliveryProps = {
  txHash: `0x${string}`;
  guid: `0x${string}`;
  tokenId: bigint;
  destinationChainId: number;
  receiver: Address;
  sent: { revision: bigint; cid: string };
  sourceReceipt: "waiting" | "success" | "reverted";
};

const stateLabel: Record<StepState, string> = {
  waiting: "waiting",
  done: "done",
  unavailable: "unavailable",
};
const stateClass: Record<StepState, string> = {
  waiting: "bg-muted text-muted-foreground",
  done: "bg-success-soft text-success",
  unavailable: "bg-warning-soft text-warning",
};

function Step({
  title,
  state,
  children,
}: {
  title: string;
  state: StepState;
  children: React.ReactNode;
}) {
  return (
    <li className="flex flex-col gap-1 rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <strong>{title}</strong>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${stateClass[state]}`}>
          {stateLabel[state]}
        </span>
      </div>
      <div className="flex flex-col gap-0.5 text-sm text-muted-foreground">{children}</div>
    </li>
  );
}

/**
 * Three independent states of one transfer, correlated by its GUID:
 * pending (source receipt), observed (LayerZero Scan or the indexer's received entry) and
 * confirmed (live `ownerOf` on the destination at an explicit block).
 */
export function DeliveryProgress(props: DeliveryProps) {
  const clientFor = usePublicClientFor();
  const [clock, setClock] = useState<DeliveryClock>(() => ({ mountedAt: Date.now() }));
  const clockRef = useRef(clock);
  const [destinationRead, setDestinationRead] = useState<DestinationRead>();
  const destination = MANIFEST.chains.find((chain) => chain.chainId === props.destinationChainId);

  const polls = deliveryPolls({
    active: props.sourceReceipt === "success" && destination !== undefined,
    indexerConfigured: Boolean(indexerBaseUrl()),
    receiver: props.receiver,
    destinationChainId: props.destinationChainId,
    timeoutMs: DELIVERY_TIMEOUT_MS,
    pollMs: POLL_MS,
    getClock: () => clockRef.current,
    publishDestination: setDestinationRead,
    publishClock: (next) => {
      clockRef.current = next;
      setClock(next);
    },
    scan: () => fetchScanStatus(props.txHash),
    indexer: () =>
      fetchIndexerObservation(
        indexerBaseUrl(),
        props.tokenId.toString(),
        props.guid,
        fetch,
        props.destinationChainId,
      ),
    destination: (onOwner) => {
      if (!destination) throw new Error("unknown destination chain");
      return readDestination(
        clientFor(destination.chainId),
        destination.address,
        props.tokenId,
        onOwner,
      );
    },
  });
  const options = { refetchOnWindowFocus: false, retry: false } as const;
  const scan = useQuery({
    queryKey: ["write", "delivery", props.txHash, "scan"],
    ...options,
    ...polls.scan,
  });
  const indexer = useQuery({
    queryKey: ["write", "delivery", props.txHash, "indexer"],
    ...options,
    ...polls.indexer,
  });
  useQuery({
    queryKey: ["write", "delivery", props.txHash, "destination"],
    ...options,
    ...polls.destination,
  });

  const view = deriveProgress({
    sourceReceipt: props.sourceReceipt,
    scan: scan.data,
    indexer:
      indexer.data ??
      (!indexerBaseUrl() ? { state: "unavailable", reason: "no indexer configured" } : undefined),
    destination: destinationRead,
    receiver: props.receiver,
    sent: props.sent,
    timedOut: Date.now() - clock.mountedAt >= DELIVERY_TIMEOUT_MS,
  });

  return (
    <section
      className="flex flex-col gap-3"
      data-mounted-at={new Date(clock.mountedAt).toISOString()}
      data-delivered-at={
        clock.deliveredAt === undefined ? undefined : new Date(clock.deliveredAt).toISOString()
      }
      data-indexer-observed-at={
        clock.indexerObservedAt === undefined
          ? undefined
          : new Date(clock.indexerObservedAt).toISOString()
      }
    >
      <h2 className="text-lg font-semibold">Delivery to {chainName(props.destinationChainId)}</h2>
      <Notice tone={view.confirmed.state === "done" ? "ok" : "info"}>{view.headline}</Notice>
      <ol className="flex flex-col gap-2">
        <Step title="1. Pending (source chain)" state={view.pending.state}>
          <span>{view.pending.detail}</span>
        </Step>
        <Step title="2. Observed (LayerZero Scan, indexer)" state={view.observed.state}>
          <span>{view.observed.scan}</span>
          <span>{view.observed.indexer}</span>
        </Step>
        <Step title="3. Confirmed (destination ownerOf)" state={view.confirmed.state}>
          <span>{view.confirmed.detail}</span>
        </Step>
      </ol>
      <dl className="grid gap-1 text-xs text-muted-foreground">
        <div className="break-all">
          Transfer GUID: <span className="font-mono">{props.guid}</span>
        </div>
        <div>
          <a
            className="underline"
            href={lzScanTxUrl(props.txHash)}
            target="_blank"
            rel="noreferrer"
          >
            Open in LayerZero Scan
          </a>
        </div>
      </dl>
    </section>
  );
}
