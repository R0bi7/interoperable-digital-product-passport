/** First observations are immutable even if later polls fail or the token moves again. */
export type DeliveryClock = { mountedAt: number; deliveredAt?: number; indexerObservedAt?: number };
export const POST_DELIVERY_INDEXER_MS = 60_000;
export function latchDeliveryClock(
  clock: DeliveryClock,
  at: number,
  delivered: boolean,
  indexed: boolean,
): DeliveryClock {
  return {
    ...clock,
    deliveredAt: clock.deliveredAt ?? (delivered ? at : undefined),
    indexerObservedAt: clock.indexerObservedAt ?? (indexed ? at : undefined),
  };
}
export function continueDeliveryPolling(
  clock: DeliveryClock,
  at: number,
  indexerConfigured: boolean,
  timeoutMs: number,
) {
  if (clock.deliveredAt !== undefined) {
    return (
      indexerConfigured &&
      clock.indexerObservedAt === undefined &&
      at - clock.deliveredAt < POST_DELIVERY_INDEXER_MS
    );
  }
  return at - clock.mountedAt < timeoutMs;
}
