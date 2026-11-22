import type { Address } from "viem";
import type {
  DestinationOwnership,
  DestinationRead,
  IndexerObservation,
  ScanStatus,
} from "./delivery";
import { continueDeliveryPolling, type DeliveryClock, latchDeliveryClock } from "./delivery-clock";

/** Separate queries publish their own source immediately; no source waits on an auxiliary service. */
export function deliveryPolls(deps: {
  active: boolean;
  indexerConfigured: boolean;
  receiver: Address;
  destinationChainId: number;
  timeoutMs: number;
  pollMs: number;
  getClock: () => DeliveryClock;
  publishClock: (clock: DeliveryClock) => void;
  scan: () => Promise<ScanStatus>;
  indexer: () => Promise<IndexerObservation>;
  destination: (onOwner: (observation: DestinationOwnership) => void) => Promise<DestinationRead>;
  publishDestination: (result: DestinationRead) => void;
  now?: () => number;
}) {
  const now = deps.now ?? Date.now;
  const beforeDelivery = () =>
    deps.active &&
    deps.getClock().deliveredAt === undefined &&
    now() - deps.getClock().mountedAt < deps.timeoutMs;
  const awaitingIndexer = () =>
    deps.active &&
    deps.indexerConfigured &&
    deps.getClock().indexerObservedAt === undefined &&
    continueDeliveryPolling(deps.getClock(), now(), true, deps.timeoutMs);
  const latch = (delivered: boolean, indexed: boolean) =>
    deps.publishClock(latchDeliveryClock(deps.getClock(), now(), delivered, indexed));
  const onOwner = (observation: DestinationOwnership) => {
    deps.publishDestination(observation);
    if (observation.owner.toLowerCase() === deps.receiver.toLowerCase()) latch(true, false);
  };
  return {
    scan: {
      enabled: beforeDelivery,
      refetchInterval: () => (beforeDelivery() ? deps.pollMs : false),
      queryFn: deps.scan,
    },
    indexer: {
      enabled: awaitingIndexer,
      refetchInterval: () => (awaitingIndexer() ? deps.pollMs : false),
      queryFn: async () => {
        const result = await deps.indexer();
        if (result.state === "received" && result.chainId === deps.destinationChainId)
          latch(false, true);
        return result;
      },
    },
    destination: {
      enabled: beforeDelivery,
      refetchInterval: () => (beforeDelivery() ? deps.pollMs : false),
      queryFn: async () => {
        const result = await deps.destination(onOwner);
        deps.publishDestination(result);
        return result;
      },
    },
  };
}
