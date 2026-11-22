import { computeCidV1 } from "@idpp/passport-config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPassport, fetchPassports, IndexerError, indexerBaseUrl } from "./client";
import { cidOfBytes, loadMockPassports, mockFetchPassport, mockFetchPassports } from "./mock";

const MOCK_PASSPORTS = await loadMockPassports();
const BASE = "http://indexer.test";

function respond(body: unknown, init: ResponseInit = {}) {
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify(body), init);
  }) as unknown as typeof fetch;
  return { urls, fetchImpl };
}

describe("fetchPassports", () => {
  it("builds the query string and validates the page", async () => {
    const page = await mockFetchPassports({ limit: 2 });
    const { urls, fetchImpl } = respond(page);
    const result = await fetchPassports(
      BASE,
      { chainId: 421614, status: "held", limit: 2, cursor: "2" },
      fetchImpl,
    );
    expect(urls).toEqual([`${BASE}/api/passports?chainId=421614&status=held&limit=2&cursor=2`]);
    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBe("2");
  });

  it("sends no query string without filters", async () => {
    const { urls, fetchImpl } = respond({ items: [], nextCursor: null });
    await fetchPassports(BASE, {}, fetchImpl);
    expect(urls).toEqual([`${BASE}/api/passports`]);
  });

  it("rejects a token id that is a JSON number", async () => {
    const bad = { ...MOCK_PASSPORTS[0]?.summary, tokenId: Number("421614000000000001") };
    const { fetchImpl } = respond({ items: [bad], nextCursor: null });
    await expect(fetchPassports(BASE, {}, fetchImpl)).rejects.toBeInstanceOf(IndexerError);
  });

  it("surfaces HTTP errors", async () => {
    const { fetchImpl } = respond({}, { status: 503 });
    await expect(fetchPassports(BASE, {}, fetchImpl)).rejects.toThrow(/HTTP 503/);
  });
});

describe("fetchPassport", () => {
  it("requests the decimal id of a bigint above 2^53 unchanged", async () => {
    const summary = MOCK_PASSPORTS.find(
      (p) => p.summary.tokenId === "11155111000000000001",
    )?.summary;
    const { urls, fetchImpl } = respond(summary);
    const result = await fetchPassport(BASE, 11155111000000000001n, fetchImpl);
    expect(urls).toEqual([`${BASE}/api/passports/11155111000000000001`]);
    expect(result?.tokenId).toBe("11155111000000000001");
  });

  it("returns null on 404", async () => {
    const { fetchImpl } = respond({}, { status: 404 });
    expect(await fetchPassport(BASE, 5n, fetchImpl)).toBeNull();
  });

  it("rejects an answer for another token", async () => {
    const { fetchImpl } = respond(MOCK_PASSPORTS[0]?.summary);
    await expect(fetchPassport(BASE, 5n, fetchImpl)).rejects.toThrow(/not 5/);
  });

  it("reports an unreachable indexer", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(fetchPassport(BASE, 5n, fetchImpl)).rejects.toThrow(/unreachable/);
  });
});

describe("mock fixtures", () => {
  it("covers a round-trip held token, an in-flight token and an incomplete token", () => {
    const held = MOCK_PASSPORTS.find((p) => p.summary.tokenId === "421614000000000001")?.summary;
    expect(held?.status).toBe("held");
    expect(held?.currentChainId).toBe(421614);
    const hops = held?.timeline.filter((t) => t.kind === "sent").map((t) => t.chainId);
    expect(hops).toEqual([421614, 84532]);
    expect(held?.timeline.filter((t) => t.kind === "received").map((t) => t.chainId)).toEqual([
      84532, 421614,
    ]);
    expect(MOCK_PASSPORTS.some((p) => p.summary.status === "in_flight")).toBe(true);
    expect(MOCK_PASSPORTS.some((p) => p.summary.status === "incomplete")).toBe(true);
  });

  it("every summary matches the schema, with unique ids and the id prefix as origin", async () => {
    const ids = new Set<string>();
    for (const { summary } of MOCK_PASSPORTS) {
      expect(ids.has(summary.tokenId)).toBe(false);
      ids.add(summary.tokenId);
      expect(BigInt(summary.originChainId)).toBe(BigInt(summary.tokenId) / 10n ** 12n);
    }
    const { fetchImpl } = respond(await mockFetchPassports({ limit: 100 }));
    expect((await fetchPassports(BASE, {}, fetchImpl)).items).toHaveLength(MOCK_PASSPORTS.length);
  });

  it("filters by status and chain and paginates", async () => {
    const inFlight = await mockFetchPassports({ status: "in_flight" });
    expect(inFlight.items.length).toBeGreaterThan(0);
    expect(inFlight.items.every((i) => i.status === "in_flight")).toBe(true);
    const base = await mockFetchPassports({ chainId: 84532 });
    expect(base.items.length).toBeGreaterThan(0);
    expect(base.items.every((i) => (i.currentChainId ?? i.originChainId) === 84532)).toBe(true);
    const first = await mockFetchPassports({ limit: 3 });
    const second = await mockFetchPassports({ limit: 3, cursor: first.nextCursor ?? undefined });
    expect(first.items).toHaveLength(3);
    expect(second.items[0]?.tokenId).not.toBe(first.items[0]?.tokenId);
    expect(await mockFetchPassport(123n)).toBeNull();
  });

  it("builds CIDs with WebCrypto that equal computeCidV1 from passport-config", async () => {
    for (const text of ["", "a", "idpp", "x".repeat(1000)]) {
      const bytes = new TextEncoder().encode(text);
      expect(await cidOfBytes(bytes)).toBe(computeCidV1(bytes));
    }
  });
});

describe("indexerBaseUrl and the public env share one rule", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("treats unset and empty NEXT_PUBLIC_INDEXER_URL as no indexer (mock mode)", async () => {
    for (const value of [undefined, ""]) {
      vi.stubEnv("NEXT_PUBLIC_INDEXER_URL", value);
      vi.resetModules();
      const env = await import("@/lib/env");
      expect(indexerBaseUrl()).toBeUndefined();
      expect(env.publicEnv.NEXT_PUBLIC_INDEXER_URL).toBeUndefined();
    }
  });

  it("uses a configured URL, without a trailing slash for requests", async () => {
    vi.stubEnv("NEXT_PUBLIC_INDEXER_URL", "http://localhost:42069/");
    vi.resetModules();
    const env = await import("@/lib/env");
    expect(indexerBaseUrl()).toBe("http://localhost:42069");
    expect(env.publicEnv.NEXT_PUBLIC_INDEXER_URL).toBe("http://localhost:42069/");
  });
});
