import { request } from "node:http";
import { request as httpsRequest } from "node:https";
import { MANIFEST, whiskyDistilleryAbi } from "@idpp/passport-config";
import { createPublicClient, http } from "viem";
import { beforeAll, describe, expect, it } from "vitest";
import { readPassportState } from "./chain-state";

/**
 * The indexer's HTTP API against a running indexer and the chains themselves. Every token the
 * indexer lists is compared with `ownerOf` / `passportOf` on the chains. Nothing is written and no
 * gas is spent. Start the indexer first (`pnpm --filter indexer start`, see `app/README.md`), then
 * `pnpm --filter indexer test:live`. `INDEXER_URL` defaults to http://localhost:42069; chain reads
 * use `PONDER_RPC_URL_<chainId>` when set and public RPCs otherwise.
 */

const INDEXER_URL = (process.env.INDEXER_URL ?? "http://localhost:42069").replace(/\/$/, "");
const FALLBACK_RPC: Record<number, string> = {
  421614: "https://sepolia-rollup.arbitrum.io/rpc",
  84532: "https://sepolia.base.org",
  11155111: "https://ethereum-sepolia-rpc.publicnode.com",
};

type Summary = {
  deploymentId: string;
  tokenId: string;
  originChainId: number;
  currentChainId: number | null;
  status: "held" | "in_flight" | "incomplete";
  owner: string | null;
  revision: string | null;
  cid: string | null;
  progress: { chainId: number; indexedBlock: string; latestBlock: string }[];
  revisions: { revision: string; cid: string; chainId: number; conflict: boolean }[];
  timeline: {
    kind: string;
    chainId: number;
    blockNumber: string;
    timestamp: string;
    logIndex: number;
    guid?: string;
  }[];
};
type Page = { items: Summary[]; nextCursor: string | null };

async function get(path: string) {
  const response = await fetch(`${INDEXER_URL}${path}`);
  return { status: response.status, body: (await response.json()) as unknown };
}

async function listAll(query = "", limit = 100): Promise<Summary[]> {
  const items: Summary[] = [];
  let cursor: string | null = null;
  do {
    const { status, body } = await get(
      `/api/passports?limit=${limit}${query}${cursor ? `&cursor=${cursor}` : ""}`,
    );
    expect(status).toBe(200);
    const page = body as Page;
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

const clients = Object.fromEntries(
  MANIFEST.chains.map((chain) => [
    chain.chainId,
    createPublicClient({
      transport: http(
        process.env[`PONDER_RPC_URL_${chain.chainId}`] ?? FALLBACK_RPC[chain.chainId],
      ),
    }),
  ]),
);

async function onChain(chainId: number, tokenId: string) {
  const chain = MANIFEST.chains.find((c) => c.chainId === chainId);
  if (!chain) throw new Error(`chain ${chainId} not in the manifest`);
  const client = clients[chainId];
  if (!client) throw new Error(`no client for ${chainId}`);
  const args = [BigInt(tokenId)] as const;
  const address = chain.address as `0x${string}`;
  return readPassportState(BigInt(tokenId), {
    ownerOf: async () =>
      (await client.readContract({
        address,
        abi: whiskyDistilleryAbi,
        functionName: "ownerOf",
        args,
      })) as string,
    passportOf: async () =>
      (await client.readContract({
        address,
        abi: whiskyDistilleryAbi,
        functionName: "passportOf",
        args,
      })) as { revision: bigint; cid: string },
  });
}

let all: Summary[] = [];

beforeAll(async () => {
  try {
    all = await listAll();
  } catch (error) {
    throw new Error(
      `indexer not reachable at ${INDEXER_URL}; start it first (${(error as Error).message})`,
    );
  }
});

describe("configured status URL", () => {
  it("keeps progress and held placement with a hostile Host header", async () => {
    // Expire the shared 3 s cache so the hostile request exercises the actual status fetch.
    await new Promise((resolve) => setTimeout(resolve, 3100));
    const url = new URL("/api/passports?limit=100", INDEXER_URL);
    const body = await new Promise<Page>((resolve, reject) => {
      const req = (url.protocol === "https:" ? httpsRequest : request)(
        url,
        {
          headers: { Host: "evil.example" },
        },
        (res) => {
          let raw = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            raw += chunk;
          });
          res.on("end", () => {
            try {
              expect(res.statusCode).toBe(200);
              resolve(JSON.parse(raw) as Page);
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      req.setTimeout(15000, () => req.destroy(new Error("request timed out")));
      req.on("error", reject);
      req.end();
    });
    expect(body.items.length).toBeGreaterThan(0);
    const held = new Set(all.filter((item) => item.status === "held").map((item) => item.tokenId));
    expect(held.size).toBeGreaterThan(0);
    let checkedHeld = 0;
    for (const item of body.items) {
      expect(item.progress.map((p) => p.chainId).sort()).toEqual(
        MANIFEST.chains.map((c) => c.chainId).sort(),
      );
      if (held.has(item.tokenId)) {
        expect(item.status).toBe("held");
        checkedHeld++;
      }
    }
    expect(checkedHeld).toBeGreaterThan(0);
  });
});

describe("list and pagination", () => {
  it("indexes the deployment's tokens", () => {
    expect(all.length).toBeGreaterThan(0);
    for (const item of all) expect(item.deploymentId).toBe(all[0]?.deploymentId);
  });

  it("returns ids in ascending numeric order without duplicates", () => {
    const ids = all.map((item) => BigInt(item.tokenId));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it("walks small pages to the same set as one big page", async () => {
    const walked = await listAll("", 3);
    expect(walked.map((i) => i.tokenId)).toEqual(all.map((i) => i.tokenId));
  });

  it("caps the limit at 100 and defaults to 20", async () => {
    const big = (await get("/api/passports?limit=100000")).body as Page;
    expect(big.items.length).toBeLessThanOrEqual(100);
    const def = (await get("/api/passports")).body as Page;
    expect(def.items.length).toBeLessThanOrEqual(20);
  });

  it("filters by status and by current chain", async () => {
    for (const status of ["held", "in_flight", "incomplete"] as const) {
      const items = await listAll(`&status=${status}`);
      expect(items.map((i) => i.tokenId)).toEqual(
        all.filter((i) => i.status === status).map((i) => i.tokenId),
      );
    }
    for (const chain of MANIFEST.chains) {
      const items = await listAll(`&chainId=${chain.chainId}`);
      expect(items.every((i) => i.currentChainId === chain.chainId)).toBe(true);
    }
  });

  it("rejects malformed parameters with 400 and an error", async () => {
    for (const query of [
      "status=nope",
      "chainId=abc",
      "chainId=-1",
      "limit=0",
      "limit=x",
      "cursor=1.5",
      "cursor=0x10",
    ]) {
      const { status, body } = await get(`/api/passports?${query}`);
      expect(status, query).toBe(400);
      expect(body).toHaveProperty("error");
    }
  });
});

describe("single passport", () => {
  it("answers 400 for a non-decimal id and 404 for an unknown token", async () => {
    expect((await get("/api/passports/abc")).status).toBe(400);
    expect((await get("/api/passports/0x10")).status).toBe(400);
    const unknown = await get("/api/passports/421614000000999999");
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ error: "unknown token" });
  });

  it("matches the list entry for every token", async () => {
    for (const item of all) {
      const { status, body } = await get(`/api/passports/${item.tokenId}`);
      expect(status).toBe(200);
      const single = body as Summary;
      // Progress moves between requests; everything else must agree.
      expect({ ...single, progress: [] }).toEqual({ ...item, progress: [] });
    }
  });
});

describe("the indexer agrees with the chains", () => {
  it("reports progress for all three chains", () => {
    const first = all[0];
    expect(first?.progress.map((p) => p.chainId).sort()).toEqual(
      MANIFEST.chains.map((c) => c.chainId).sort(),
    );
  });

  it("derives the issuing chain from the id prefix", () => {
    for (const item of all) {
      expect(item.originChainId).toBe(Number(BigInt(item.tokenId) / 1_000_000_000_000n));
    }
  });

  it("matches owner, revision and CID on chain for every held token, and absence elsewhere", async () => {
    const held = all.filter((item) => item.status === "held");
    expect(held.length).toBeGreaterThan(0);
    for (const item of held) {
      const holder = await onChain(item.currentChainId as number, item.tokenId);
      expect(holder.present, `${item.tokenId} on ${item.currentChainId}`).toBe(true);
      if (!holder.present) continue;
      expect(item.owner?.toLowerCase()).toBe(holder.owner.toLowerCase());
      expect(item.revision).toBe(holder.revision.toString());
      expect(item.cid).toBe(holder.cid);
      for (const chain of MANIFEST.chains) {
        if (chain.chainId === item.currentChainId) continue;
        expect(
          (await onChain(chain.chainId, item.tokenId)).present,
          `${item.tokenId} must not also exist on ${chain.chainId}`,
        ).toBe(false);
      }
    }
  });

  it("keeps null placement fields for tokens that are not held", () => {
    for (const item of all.filter((i) => i.status !== "held")) {
      expect(item.currentChainId).toBeNull();
      expect(item.owner).toBeNull();
      expect(item.revision).toBeNull();
      expect(item.cid).toBeNull();
    }
  });
});

describe("revisions and timeline", () => {
  it("has contiguous revisions from 0 to the held revision, without conflicts", () => {
    for (const item of all.filter((i) => i.status === "held")) {
      const numbers = [...new Set(item.revisions.map((r) => Number(r.revision)))].sort(
        (a, b) => a - b,
      );
      expect(numbers, item.tokenId).toEqual(Array.from({ length: numbers.length }, (_, i) => i));
      expect(numbers.at(-1), item.tokenId).toBe(Number(item.revision));
      expect(
        item.revisions.every((r) => !r.conflict),
        item.tokenId,
      ).toBe(true);
      const latest = item.revisions.find((r) => r.revision === item.revision);
      expect(latest?.cid, item.tokenId).toBe(item.cid);
    }
  });

  it("records one issue and one revise per revision in the timeline", () => {
    for (const item of all.filter((i) => i.status === "held")) {
      const count = (kind: string) => item.timeline.filter((e) => e.kind === kind).length;
      expect(count("issued"), item.tokenId).toBe(1);
      expect(count("revised"), item.tokenId).toBe(Number(item.revision));
      expect(count("sent"), item.tokenId).toBe(count("received"));
    }
  });

  it("starts every timeline with the issue, in block order per chain", () => {
    for (const item of all) {
      expect(item.timeline[0]?.kind, item.tokenId).toBe("issued");
      const lastBlock = new Map<number, bigint>();
      for (const entry of item.timeline) {
        const block = BigInt(entry.blockNumber);
        expect(block >= (lastBlock.get(entry.chainId) ?? 0n), item.tokenId).toBe(true);
        lastBlock.set(entry.chainId, block);
      }
    }
  });

  it("pairs every send with a receive by guid unless the token is in flight", () => {
    for (const item of all) {
      const sent = item.timeline.filter((e) => e.kind === "sent");
      const received = new Set(
        item.timeline.filter((e) => e.kind === "received").map((e) => e.guid),
      );
      for (const entry of sent) {
        expect(entry.guid, item.tokenId).toMatch(/^0x[0-9a-f]{64}$/);
      }
      const unmatched = sent.filter((e) => !received.has(e.guid));
      if (item.status === "held") {
        // A held token has no outstanding send except one superseded on its origin chain.
        expect(unmatched.length, item.tokenId).toBeLessThanOrEqual(0);
      }
    }
  });
});
