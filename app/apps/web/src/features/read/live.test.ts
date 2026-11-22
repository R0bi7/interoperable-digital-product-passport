import { MANIFEST } from "@idpp/passport-config";
import { describe, expect, it } from "vitest";
import { loadMockPassports } from "@/lib/indexer/mock";
import { compareLive, type LiveRecord, readLiveRecord } from "./live";

const MOCK_PASSPORTS = await loadMockPassports();
const chain = MANIFEST.chains[0] as (typeof MANIFEST.chains)[number];

function fakeClient(results: unknown[], block = 123n) {
  const calls: { blockNumber?: bigint; contracts: { functionName: string; args: unknown[] }[] }[] =
    [];
  return {
    calls,
    client: {
      getBlockNumber: async () => block,
      multicall: async (args: (typeof calls)[number]) => {
        calls.push(args);
        return results;
      },
    } as never,
  };
}

describe("readLiveRecord", () => {
  it("reads ownerOf and passportOf in one multicall at an explicit block", async () => {
    const { client, calls } = fakeClient([
      { status: "success", result: "0x00000000000000000000000000000000000a11ce" },
      {
        status: "success",
        result: { revision: 3n, historyHash: `0x${"ab".repeat(32)}`, cid: "bafkrei-x" },
      },
    ]);
    const live = await readLiveRecord(client, chain.chainId, 421614000000000001n);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.blockNumber).toBe(123n);
    expect(calls[0]?.contracts.map((c) => c.functionName)).toEqual(["ownerOf", "passportOf"]);
    expect(calls[0]?.contracts[0]?.args).toEqual([421614000000000001n]);
    expect(live).toEqual({
      chainId: chain.chainId,
      blockNumber: 123n,
      owner: "0x00000000000000000000000000000000000a11ce",
      revision: "3",
      cid: "bafkrei-x",
      historyHash: `0x${"ab".repeat(32)}`,
    });
  });

  it("reports the token as absent when ownerOf reverts", async () => {
    const { client } = fakeClient([
      { status: "failure", error: new Error("ERC721NonexistentToken") },
      { status: "success", result: { revision: 0n, cid: "" } },
    ]);
    const live = await readLiveRecord(client, chain.chainId, 1n);
    expect(live).toMatchObject({ owner: null, revision: null, cid: null, historyHash: null });
  });

  it("rejects chains outside the deployment", async () => {
    const { client } = fakeClient([]);
    await expect(readLiveRecord(client, 1, 1n)).rejects.toThrow(/not part of this deployment/);
  });
});

describe("compareLive", () => {
  const behind = MOCK_PASSPORTS.find((p) => p.scenario.startsWith("indexer behind"));
  const held = MOCK_PASSPORTS[0];

  it("agrees when owner, revision and cid match (owner compared case-insensitively)", () => {
    const live = held?.live as NonNullable<typeof held>["live"] & object;
    const record: LiveRecord = {
      ...live,
      blockNumber: live.blockNumber,
      owner: live.owner.toUpperCase().replace("0X", "0x"),
    };
    expect(compareLive((held as NonNullable<typeof held>).summary, record)).toEqual({
      agrees: true,
      differences: [],
    });
  });

  it("flags the indexer as behind when the chain holds a newer revision", () => {
    const result = compareLive(
      (behind as NonNullable<typeof behind>).summary,
      (behind as NonNullable<typeof behind>).live as LiveRecord,
    );
    expect(result.agrees).toBe(false);
    expect(result.differences.join(" ")).toContain("revision: indexer 0, chain 1");
  });

  it("flags a token that the chain does not hold", () => {
    const result = compareLive((held as NonNullable<typeof held>).summary, {
      chainId: 421614,
      blockNumber: 5n,
      owner: null,
      revision: null,
      cid: null,
      historyHash: null,
    });
    expect(result.agrees).toBe(false);
    expect(result.differences[0]).toContain("not present");
  });
});
