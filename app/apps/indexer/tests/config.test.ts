import { MANIFEST, whiskyDistilleryAbi } from "@idpp/passport-config";
import type { Transport } from "viem";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildChains, whiskyDistilleryChains } from "../manifest-config";

const env = Object.fromEntries(
  MANIFEST.chains.map((chain) => [
    `PONDER_RPC_URL_${chain.chainId}`,
    `http://rpc.test/${chain.chainId}`,
  ]),
);

// `ponder.config.ts` reads PONDER_RPC_URL_* when loaded, so set them before importing it.
let config: typeof import("../ponder.config")["default"];
beforeAll(async () => {
  Object.assign(process.env, env);
  config = (await import("../ponder.config")).default;
});

describe("ponder.config", () => {
  it("starts the next request on schedule while an earlier response is pending", async () => {
    vi.useFakeTimers();
    let release!: (response: Response) => void;
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(Response.json({ jsonrpc: "2.0", id: 2, result: "0x1" }));
    try {
      const rpc = buildChains({ ...env, PONDER_RPC_INTERVAL_MS_84532: "500" })["base-sepolia"]
        ?.rpc as Transport;
      const transport = rpc({});
      const first = transport.request({ method: "eth_chainId" });
      const second = transport.request({ method: "eth_chainId" });
      await vi.advanceTimersByTimeAsync(500);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(await second).toBe("0x1");
      release(Response.json({ jsonrpc: "2.0", id: 1, result: "0x1" }));
      expect(await first).toBe("0x1");
      await vi.advanceTimersByTimeAsync(500);
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });

  it.each(["0", "-1", "1.5", "", "Infinity", "2147483648"])(
    "rejects invalid request interval %s",
    (value) => {
      expect(() => buildChains({ ...env, PONDER_RPC_INTERVAL_MS_84532: value })).toThrow(
        "PONDER_RPC_INTERVAL_MS_84532 must be an integer from 1 to 2147483647",
      );
    },
  );

  it.each([false, true])("paces requests and continues after failure=%s", async (failFirst) => {
    vi.useFakeTimers();
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => Response.json({ jsonrpc: "2.0", id: 1, result: "0x1" }));
    if (failFirst) fetch.mockRejectedValueOnce(new Error("provider unavailable"));
    try {
      const rpc = buildChains({ ...env, PONDER_RPC_INTERVAL_MS_84532: "500" })["base-sepolia"]
        ?.rpc as Transport;
      const transport = rpc({});
      const first = transport.request({ method: "eth_chainId" }).catch(() => "failed");
      const second = transport.request({ method: "eth_chainId" });
      await vi.advanceTimersByTimeAsync(0);
      expect(fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(499);
      expect(fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(await first).toBe(failFirst ? "failed" : "0x1");
      expect(await second).toBe("0x1");
      await vi.advanceTimersByTimeAsync(500);
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });

  it("lists every manifest chain, address and deployment block", () => {
    for (const manifestChain of MANIFEST.chains) {
      const chain = config.chains[manifestChain.network];
      expect(chain?.id).toBe(manifestChain.chainId);

      const entry = config.contracts.WhiskyDistillery.chain[manifestChain.network];
      expect(entry?.address.toLowerCase()).toBe(manifestChain.address.toLowerCase());
      expect(entry?.startBlock).toBe(manifestChain.deploymentBlock);
    }
    expect(Object.keys(config.chains)).toHaveLength(MANIFEST.chains.length);
    expect(Object.keys(config.contracts.WhiskyDistillery.chain)).toHaveLength(
      MANIFEST.chains.length,
    );
  });

  it("uses the manifest's ABI", () => {
    expect(config.contracts.WhiskyDistillery.abi).toBe(whiskyDistilleryAbi);
  });

  it("never starts before the deployment block", () => {
    for (const entry of Object.values(whiskyDistilleryChains)) {
      expect(entry.startBlock).toBeGreaterThan(0);
    }
  });

  it("names the missing RPC variable", () => {
    expect(() => buildChains({})).toThrow(/PONDER_RPC_URL_421614/);
    expect(buildChains(env)["base-sepolia"]).toEqual({ id: 84532, rpc: "http://rpc.test/84532" });
  });

  it("accepts a per-chain historical log range without changing deployment blocks", () => {
    expect(
      buildChains({ ...env, PONDER_LOG_BLOCK_RANGE_84532: "1000000" })["base-sepolia"],
    ).toEqual({ id: 84532, rpc: "http://rpc.test/84532", ethGetLogsBlockRange: 1000000 });
    expect(buildChains(env)["arbitrum-sepolia"]).not.toHaveProperty("ethGetLogsBlockRange");
  });

  it.each(["0", "-1", "1.5", "", "Infinity", "9007199254740992"])(
    "rejects invalid historical log range %s",
    (value) => {
      expect(() => buildChains({ ...env, PONDER_LOG_BLOCK_RANGE_84532: value })).toThrow(
        "PONDER_LOG_BLOCK_RANGE_84532 must be a positive safe integer",
      );
    },
  );
});
