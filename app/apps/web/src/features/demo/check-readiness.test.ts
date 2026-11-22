import { MANIFEST } from "@idpp/passport-config";
import { afterEach, expect, it, vi } from "vitest";

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/features/read/live", () => ({ publicClientFor: () => ({ readContract: read }) }));

import { checkReadiness } from "./readiness";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
function status() {
  return {
    deploymentId: MANIFEST.deploymentId,
    chains: MANIFEST.chains.map((c) => ({
      chainId: c.chainId,
      indexedBlock: "100",
      latestBlock: "100",
      toleranceBlocks: "1",
      caughtUp: true,
    })),
  };
}
it("combines live catch-up, read-only browser probes and configuration", async () => {
  vi.stubEnv("NEXT_PUBLIC_INDEXER_URL", "http://indexer.test");
  read.mockResolvedValue(1n);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      Response.json(
        url.startsWith("http://indexer.test")
          ? status()
          : { publicationConfigured: true, allowlisted: true },
      ),
    ),
  );
  const data = await checkReadiness("0x0000000000000000000000000000000000000001");
  expect(data.indexer.every((i) => i.ok)).toBe(true);
  expect(data.chains.every((i) => i.ok)).toBe(true);
  expect(data.publication?.allowlisted).toBe(true);
  expect(read).toHaveBeenCalledTimes(MANIFEST.chains.length);
  for (const [request] of read.mock.calls) expect(request.functionName).toBe("nextTokenId");
});
it("keeps failed dependencies separate and never turns request errors into success", async () => {
  vi.stubEnv("NEXT_PUBLIC_INDEXER_URL", "http://indexer.test");
  read.mockResolvedValue(1n).mockRejectedValueOnce(new Error("offline"));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("unavailable", { status: 503 })),
  );
  const data = await checkReadiness();
  expect(data.indexer[0]?.ok).toBe(false);
  expect(data.chains.filter((i) => !i.ok)).toHaveLength(1);
  expect(data.publication).toBeNull();
});
it("never reports fixture mode as live readiness or probes chains in fixture mode", async () => {
  vi.stubEnv("NEXT_PUBLIC_INDEXER_URL", "");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ publicationConfigured: true, allowlisted: true })),
  );
  const data = await checkReadiness();
  expect(data.indexer[0]?.ok).toBe(false);
  expect(data.chains[0]?.ok).toBe(false);
  expect(read).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(1);
});
