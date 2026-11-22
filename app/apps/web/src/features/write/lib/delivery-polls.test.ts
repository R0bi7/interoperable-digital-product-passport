import type { PublicClient } from "viem";
import { describe, expect, it, vi } from "vitest";
import {
  type DestinationRead,
  deriveProgress,
  type IndexerObservation,
  readDestination,
} from "./delivery";
import type { DeliveryClock } from "./delivery-clock";
import { deliveryPolls } from "./delivery-polls";

const owner = "0x0000000000000000000000000000000000000001" as const;
const contract = "0x0000000000000000000000000000000000000002" as const;
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe("independent delivery source polls", () => {
  it("latches owner and indexer clocks before an unrelated never-resolving Scan and a pending passport read", async () => {
    let clock: DeliveryClock = { mountedAt: 100 };
    let now = 200;
    const indexed = deferred<IndexerObservation>();
    const passport = deferred<{ revision: bigint; cid: string }>();
    const ownerObserved = deferred<void>();
    const readContract = vi.fn(async ({ functionName }: { functionName: string }) =>
      functionName === "ownerOf" ? owner : passport.promise,
    );
    const scan = vi.fn(() => new Promise<never>(() => {}));
    const polls = deliveryPolls({
      active: true,
      indexerConfigured: true,
      receiver: owner,
      destinationChainId: 84532,
      timeoutMs: 600_000,
      pollMs: 6_000,
      publishDestination: () => {},
      getClock: () => clock,
      publishClock: (next) => {
        clock = next;
        if (clock.deliveredAt !== undefined) ownerObserved.resolve();
      },
      now: () => now,
      scan,
      indexer: () => indexed.promise,
      destination: (onOwner) =>
        readDestination(
          { getBlockNumber: async () => 7n, readContract } as unknown as PublicClient,
          contract,
          1n,
          onOwner,
        ),
    });
    let scanSettled = false;
    void polls.scan.queryFn().then(() => {
      scanSettled = true;
    });
    const indexerTask = polls.indexer.queryFn();
    let destinationSettled = false;
    const destinationTask = polls.destination.queryFn().then((result) => {
      destinationSettled = true;
      return result;
    });
    await ownerObserved.promise;
    expect(clock).toEqual({ mountedAt: 100, deliveredAt: 200 });
    expect(scanSettled).toBe(false);
    expect(destinationSettled).toBe(false);
    expect(polls.scan.enabled()).toBe(false);
    expect(polls.destination.enabled()).toBe(false);
    expect(polls.indexer.enabled()).toBe(true);
    expect(polls.indexer.refetchInterval()).toBe(6_000);
    now = 300;
    indexed.resolve({ state: "received", chainId: 84532 });
    await indexerTask;
    expect(clock).toEqual({ mountedAt: 100, deliveredAt: 200, indexerObservedAt: 300 });
    expect(scanSettled).toBe(false);
    expect(polls.indexer.enabled()).toBe(false);
    expect(polls.indexer.refetchInterval()).toBe(false);
    passport.resolve({ revision: 1n, cid: "sent-cid" });
    expect(await destinationTask).toMatchObject({ state: "present", owner });
    expect(readContract).toHaveBeenCalledTimes(2);
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it("keeps confirmed delivery renderable if passportOf fails after ownerOf succeeds", async () => {
    let clock: DeliveryClock = { mountedAt: 100 };
    let rendered: DestinationRead | undefined;
    const polls = deliveryPolls({
      active: true,
      indexerConfigured: true,
      receiver: owner,
      destinationChainId: 84532,
      timeoutMs: 600_000,
      pollMs: 6_000,
      getClock: () => clock,
      publishClock: (next) => {
        clock = next;
      },
      publishDestination: (result) => {
        rendered = result;
      },
      now: () => 200,
      scan: async () => ({ state: "not_indexed" }),
      indexer: async () => ({ state: "not_yet" }),
      destination: (onOwner) =>
        readDestination(
          {
            getBlockNumber: async () => 7n,
            readContract: async ({ functionName }: { functionName: string }) => {
              if (functionName === "ownerOf") return owner;
              // The owner sample has already reached the production view before this RPC completes.
              expect(rendered).toMatchObject({ state: "owned", owner });
              throw new Error("passport RPC unavailable");
            },
          } as unknown as PublicClient,
          contract,
          1n,
          onOwner,
        ),
    });
    const result = await polls.destination.queryFn();
    expect(result).toMatchObject({ state: "owned", owner, reason: "passport RPC unavailable" });
    const view = deriveProgress({
      sourceReceipt: "success",
      receiver: owner,
      sent: { revision: 1n, cid: "sent" },
      timedOut: false,
      destination: rendered,
    });
    expect(view.confirmed.state).toBe("done");
    expect(view.headline).toBe("Delivered: the token is held on the destination chain.");
    expect(view.confirmed.detail).toContain("passport snapshot unavailable");
    expect(view.confirmed.snapshotMatches).toBeUndefined();
    expect(clock.deliveredAt).toBe(200);
    expect(polls.destination.enabled()).toBe(false);
  });

  it("retains a bounded indexer-only window after destination ownership", async () => {
    let clock: DeliveryClock = { mountedAt: 100, deliveredAt: 200 };
    let now = 60_199;
    const scan = vi.fn(async () => ({ state: "not_indexed" as const }));
    const destination = vi.fn(async () => ({ state: "absent" as const, blockNumber: 1n }));
    const polls = deliveryPolls({
      active: true,
      indexerConfigured: true,
      receiver: owner,
      destinationChainId: 84532,
      timeoutMs: 600_000,
      pollMs: 6_000,
      publishDestination: () => {},
      getClock: () => clock,
      publishClock: (next) => {
        clock = next;
      },
      now: () => now,
      scan,
      indexer: async () => ({ state: "not_yet" }),
      destination,
    });
    expect(polls.scan.refetchInterval()).toBe(false);
    expect(polls.destination.refetchInterval()).toBe(false);
    expect(polls.indexer.enabled()).toBe(true);
    expect(await polls.indexer.queryFn()).toEqual({ state: "not_yet" });
    expect(clock.deliveredAt).toBe(200);
    now = 60_200;
    expect(polls.indexer.enabled()).toBe(false);
    expect(polls.indexer.refetchInterval()).toBe(false);
    expect(scan).not.toHaveBeenCalled();
    expect(destination).not.toHaveBeenCalled();
  });
});
