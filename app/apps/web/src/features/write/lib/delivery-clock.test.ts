import { describe, expect, it } from "vitest";
import {
  continueDeliveryPolling,
  latchDeliveryClock,
  POST_DELIVERY_INDEXER_MS,
} from "./delivery-clock";

describe("delivery observation clock", () => {
  it("latches first delivery and first indexer observation independently", () => {
    const mounted = { mountedAt: 100 };
    const delivered = latchDeliveryClock(mounted, 200, true, false);
    expect(delivered).toEqual({ mountedAt: 100, deliveredAt: 200 });
    const indexed = latchDeliveryClock(delivered, 300, false, true);
    expect(indexed).toEqual({ mountedAt: 100, deliveredAt: 200, indexerObservedAt: 300 });
    expect(latchDeliveryClock(indexed, 400, true, true)).toEqual(indexed);
  });
  it("polls the indexer after delivery for at most 60 seconds", () => {
    const delivered = { mountedAt: 100, deliveredAt: 200 };
    expect(continueDeliveryPolling(delivered, 200, true, 600_000)).toBe(true);
    expect(
      continueDeliveryPolling(delivered, 200 + POST_DELIVERY_INDEXER_MS - 1, true, 600_000),
    ).toBe(true);
    expect(continueDeliveryPolling(delivered, 200 + POST_DELIVERY_INDEXER_MS, true, 600_000)).toBe(
      false,
    );
    expect(continueDeliveryPolling(delivered, 201, false, 600_000)).toBe(false);
    expect(
      continueDeliveryPolling({ ...delivered, indexerObservedAt: 201 }, 202, true, 600_000),
    ).toBe(false);
  });
  it("allows indexer observation before delivery and still waits for destination ownership", () => {
    const indexed = latchDeliveryClock({ mountedAt: 100 }, 200, false, true);
    expect(continueDeliveryPolling(indexed, 200, true, 600_000)).toBe(true);
    expect(continueDeliveryPolling(indexed, 600_100, true, 600_000)).toBe(false);
    expect(
      continueDeliveryPolling(latchDeliveryClock(indexed, 300, true, true), 300, true, 600_000),
    ).toBe(false);
  });
});
