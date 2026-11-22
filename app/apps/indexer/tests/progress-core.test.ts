import { MANIFEST } from "@idpp/passport-config";
import { describe, expect, it, vi } from "vitest";
import { createProgressReader, resolveStatusUrl } from "../src/api/progress-core";

function fixture() {
  let at = 0;
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify(
          Object.fromEntries(
            MANIFEST.chains.map((chain) => [
              chain.network,
              { id: chain.chainId, block: { number: 10 } },
            ]),
          ),
        ),
      ),
  );
  const publicClients = Object.fromEntries(
    MANIFEST.chains.map((chain) => [
      chain.network,
      {
        getBlockNumber: vi.fn(async () => 12n),
      },
    ]),
  );
  return {
    fetch,
    publicClients,
    now: () => at,
    tick: () => {
      at += 3001;
    },
  };
}

describe("configured progress endpoint", () => {
  it("resolves from environment only", () => {
    expect(resolveStatusUrl({})).toBe("http://127.0.0.1:42069/status");
    expect(resolveStatusUrl({ PORT: "43210" })).toBe("http://127.0.0.1:43210/status");
    expect(resolveStatusUrl({ PORT: "42069" }, 42070)).toBe("http://127.0.0.1:42070/status");
    expect(resolveStatusUrl({ INDEXER_STATUS_URL: "http://internal/status" }, 42070)).toBe(
      "http://internal/status",
    );
    expect(resolveStatusUrl({ PORT: "43210", INDEXER_STATUS_URL: "http://internal/status" })).toBe(
      "http://internal/status",
    );
  });

  it("fetches the configured URL through getProgress, shares inflight reads and caches for 3 s", async () => {
    const deps = fixture();
    const reader = createProgressReader({ ...deps, statusUrl: "http://internal/status" });
    // The production reader accepts no request URL: hostile Host headers cannot select its target.
    const results = await Promise.all([reader.getProgress(), reader.getProgress()]);
    expect(results[0]).toHaveLength(MANIFEST.chains.length);
    expect(results[0]).toEqual(results[1]);
    expect(deps.fetch).toHaveBeenCalledExactlyOnceWith("http://internal/status");
    await reader.getProgress();
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    deps.tick();
    await reader.getProgress();
    expect(deps.fetch).toHaveBeenCalledTimes(2);
  });

  it("leaves progress missing when status or a chain RPC fails", async () => {
    const deps = fixture();
    deps.fetch.mockRejectedValueOnce(new Error("offline"));
    const reader = createProgressReader({ ...deps, statusUrl: "http://internal/status" });
    expect(await reader.getProgress()).toEqual([]);
    deps.tick();
    const first = MANIFEST.chains[0];
    if (!first) throw new Error("empty manifest");
    deps.publicClients[first.network]?.getBlockNumber.mockRejectedValueOnce(new Error("offline"));
    expect(await reader.getProgress()).toHaveLength(MANIFEST.chains.length - 1);
  });
});
