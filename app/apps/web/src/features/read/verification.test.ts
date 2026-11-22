import { canonicalBytes, computeCidV1, historyHashOf } from "@idpp/passport-config";
import { describe, expect, it, vi } from "vitest";
import { mockRevisionReceipt } from "@/lib/indexer/mock";
import {
  fetchGatewayPayload,
  type PayloadFetch,
  type VerifyInput,
  verifyPassport,
} from "./verification";

// Shared test vector, docs/TECHNICAL-REFERENCE.md "Canonical bytes and CID profile".
const VECTOR_ENVELOPE = {
  schema: "idpp-passport/1",
  deploymentId: "whisky-v2-final",
  tokenId: "97000000000000",
  revision: "0",
  previousCid: null,
  kind: "cask",
  granularity: "item",
  data: {
    distillery: "Demo Distillery",
    caskType: "Bourbon barrel",
    caskNumber: "1",
    volumeLiters: "200",
    alcoholByVolume: "63.5",
    fillDate: "2026-10-01",
  },
};
const VECTOR_CID = "bafkreibnugdjrt4xfyb4untqebjbktbq7lhbbxbiwtlgcefchoioao6dhm";
const DEPLOYMENT = "whisky-v2-final";
const TOKEN = "97000000000000";

const bytesOf = (value: unknown) => canonicalBytes(value);
const store = (...entries: [string, Uint8Array][]) => {
  const map = new Map(entries);
  return async (cid: string): Promise<PayloadFetch> => {
    const bytes = map.get(cid);
    return bytes ? { ok: true, bytes } : { ok: false, reason: "not found" };
  };
};

function input(over: Partial<VerifyInput>): VerifyInput {
  return {
    deploymentId: DEPLOYMENT,
    tokenId: TOKEN,
    revisions: [{ revision: "0", cid: VECTOR_CID }],
    fetchPayload: store([VECTOR_CID, bytesOf(VECTOR_ENVELOPE)]),
    ...over,
  };
}

function revisionTwo(previousCid: string | null = VECTOR_CID) {
  const envelope = { ...VECTOR_ENVELOPE, revision: "1", previousCid };
  const bytes = bytesOf(envelope);
  return { bytes, cid: computeCidV1(bytes) };
}

describe("test vector", () => {
  it("hashes to the README CID, so the fixtures below are anchored to the shared vector", () => {
    expect(computeCidV1(bytesOf(VECTOR_ENVELOPE))).toBe(VECTOR_CID);
    expect(bytesOf(VECTOR_ENVELOPE)).toHaveLength(312);
  });
});

describe("verifyPassport", () => {
  it("verifies content and history while leaving indexer-only binding unconfirmed", async () => {
    const { entries, notes } = await verifyPassport(input({}));
    expect(notes).toEqual([]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      revision: "0",
      cid: VECTOR_CID,
      source: "indexed",
      content: { status: "verified" },
      binding: { status: "unconfirmed" },
      history: { status: "verified" },
    });
    expect(entries[0]?.envelope?.tokenId).toBe(TOKEN);
  });

  it("fails content, and does not judge binding or history, for tampered bytes under the expected CID", async () => {
    const tampered = bytesOf({
      ...VECTOR_ENVELOPE,
      data: { ...VECTOR_ENVELOPE.data, volumeLiters: "250" },
    });
    const { entries } = await verifyPassport(
      input({ fetchPayload: store([VECTOR_CID, tampered]) }),
    );
    expect(entries[0]?.content.status).toBe("failed");
    expect(entries[0]?.content.reason).toContain(VECTOR_CID);
    expect(entries[0]?.binding.status).toBe("unavailable");
    expect(entries[0]?.history.status).toBe("unavailable");
    expect(entries[0]?.envelope).toBeUndefined();
  });

  it("fails binding for a valid CID whose envelope names another tokenId", async () => {
    const other = bytesOf({ ...VECTOR_ENVELOPE, tokenId: "97000000000001" });
    const cid = computeCidV1(other);
    const { entries } = await verifyPassport(
      input({ revisions: [{ revision: "0", cid }], fetchPayload: store([cid, other]) }),
    );
    expect(entries[0]?.content.status).toBe("verified");
    expect(entries[0]?.binding.status).toBe("failed");
    expect(entries[0]?.binding.reason).toContain("tokenId");
  });

  it("fails binding for another deployment id and another revision", async () => {
    const wrongDeployment = bytesOf({ ...VECTOR_ENVELOPE, deploymentId: "whisky-v2-old" });
    const cidD = computeCidV1(wrongDeployment);
    const d = await verifyPassport(
      input({
        revisions: [{ revision: "0", cid: cidD }],
        fetchPayload: store([cidD, wrongDeployment]),
      }),
    );
    expect(d.entries[0]?.binding.status).toBe("failed");

    const r1 = revisionTwo();
    const r = await verifyPassport(
      input({
        revisions: [{ revision: "0", cid: r1.cid }],
        fetchPayload: store([r1.cid, r1.bytes]),
      }),
    );
    expect(r.entries[0]?.binding).toMatchObject({ status: "failed" });
    expect(r.entries[0]?.binding.reason).toContain("revision");
  });

  it("fails history when previousCid is not the CID of the preceding revision", async () => {
    const broken = revisionTwo(computeCidV1(new TextEncoder().encode("another payload")));
    const { entries } = await verifyPassport(
      input({
        revisions: [
          { revision: "0", cid: VECTOR_CID },
          { revision: "1", cid: broken.cid },
        ],
        fetchPayload: store([VECTOR_CID, bytesOf(VECTOR_ENVELOPE)], [broken.cid, broken.bytes]),
      }),
    );
    expect(entries[0]?.history.status).toBe("verified");
    expect(entries[1]?.content.status).toBe("verified");
    expect(entries[1]?.binding.status).toBe("unconfirmed");
    expect(entries[1]?.history.status).toBe("failed");
    expect(entries[1]?.history.reason).toContain("previousCid");
  });

  it("verifies a two-revision chain and sorts revisions numerically", async () => {
    const r1 = revisionTwo();
    const { entries } = await verifyPassport(
      input({
        revisions: [
          { revision: "1", cid: r1.cid },
          { revision: "0", cid: VECTOR_CID },
        ],
        fetchPayload: store([VECTOR_CID, bytesOf(VECTOR_ENVELOPE)], [r1.cid, r1.bytes]),
      }),
    );
    expect(entries.map((e) => e.revision)).toEqual(["0", "1"]);
    expect(entries.every((e) => e.history.status === "verified")).toBe(true);
  });

  it("reports unavailable for all three checks when the gateway has no payload", async () => {
    const { entries } = await verifyPassport(input({ fetchPayload: store() }));
    expect(entries[0]?.content).toMatchObject({ status: "unavailable" });
    expect(entries[0]?.content.reason).toContain("not found");
    expect(entries[0]?.binding.status).toBe("unavailable");
    expect(entries[0]?.history.status).toBe("unavailable");
  });

  it("marks a revision after an unreadable one unavailable for history, not failed", async () => {
    const r1 = revisionTwo();
    const { entries } = await verifyPassport(
      input({
        revisions: [
          { revision: "0", cid: VECTOR_CID },
          { revision: "1", cid: r1.cid },
        ],
        fetchPayload: store([r1.cid, r1.bytes]),
      }),
    );
    expect(entries[0]?.content.status).toBe("unavailable");
    expect(entries[1]?.content.status).toBe("verified");
    expect(entries[1]?.history.status).toBe("unavailable");
  });

  it("checks the current revision against the live CID, not the indexed one", async () => {
    const r1 = revisionTwo();
    const { entries, notes } = await verifyPassport(
      input({
        revisions: [
          { revision: "0", cid: VECTOR_CID },
          { revision: "1", cid: VECTOR_CID }, // indexer is wrong about revision 1
        ],
        live: { revision: "1", cid: r1.cid },
        fetchPayload: store([VECTOR_CID, bytesOf(VECTOR_ENVELOPE)], [r1.cid, r1.bytes]),
      }),
    );
    expect(entries[1]).toMatchObject({ cid: r1.cid, source: "live" });
    expect(entries[1]?.content.status).toBe("verified");
    expect(entries[1]?.history.status).toBe("verified");
    expect(notes.join(" ")).toContain("differs from the on-chain CID");
  });

  it("verifies a revision that is on chain but not yet indexed", async () => {
    const r1 = revisionTwo();
    const { entries, notes } = await verifyPassport(
      input({
        live: { revision: "1", cid: r1.cid },
        fetchPayload: store([VECTOR_CID, bytesOf(VECTOR_ENVELOPE)], [r1.cid, r1.bytes]),
      }),
    );
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({ source: "live-only", revision: "1" });
    expect(entries[1]?.binding.status).toBe("verified");
    expect(entries[1]?.history.status).toBe("verified");
    expect(notes[0]).toContain("not indexed yet");
  });

  it("does not claim history across a gap between indexed and live revisions", async () => {
    const r2 = revisionTwo();
    const { entries } = await verifyPassport(
      input({
        live: { revision: "5", cid: r2.cid },
        fetchPayload: store([VECTOR_CID, bytesOf(VECTOR_ENVELOPE)], [r2.cid, r2.bytes]),
      }),
    );
    expect(entries[1]?.history.status).toBe("unavailable");
  });

  it("keeps ids above 2^53 exact", async () => {
    const big = "11155111000000000001";
    expect(Number(big).toString()).not.toBe(big); // would be lossy as a Number
    const envelope = { ...VECTOR_ENVELOPE, tokenId: big };
    const bytes = bytesOf(envelope);
    const cid = computeCidV1(bytes);
    const { entries } = await verifyPassport({
      deploymentId: DEPLOYMENT,
      tokenId: big,
      revisions: [{ revision: "0", cid }],
      fetchPayload: store([cid, bytes]),
    });
    expect(entries[0]?.binding.status).toBe("unconfirmed");
  });
});

describe("verifyPassport history hash", () => {
  // historyHash of revision 0 (TOKEN, VECTOR_CID), read from the deployed contract's nextHistoryHash.
  const H0 = "0xf5e0f56ab79d9274b1ba95243bca82d1dc703bd424b01001b6230f756f065d0e";

  it("verifies revision 0 against the contract's value", async () => {
    const { historyHash } = await verifyPassport(
      input({ live: { revision: "0", cid: VECTOR_CID, historyHash: H0 } }),
    );
    expect(historyHash).toEqual({ status: "verified" });
  });

  it("verifies a live-only tip on top of the indexed revisions", async () => {
    const r1 = revisionTwo();
    const { historyHash } = await verifyPassport(
      input({
        live: {
          revision: "1",
          cid: r1.cid,
          historyHash: historyHashOf(TOKEN, [VECTOR_CID, r1.cid]),
        },
        fetchPayload: store([VECTOR_CID, bytesOf(VECTOR_ENVELOPE)], [r1.cid, r1.bytes]),
      }),
    );
    expect(historyHash.status).toBe("verified");
  });

  it("fails when an indexed CID is not the recorded one, even if every payload checks out", async () => {
    const r1 = revisionTwo();
    const { entries, historyHash } = await verifyPassport(
      input({
        revisions: [
          { revision: "0", cid: VECTOR_CID },
          { revision: "1", cid: r1.cid },
        ],
        live: { revision: "1", cid: r1.cid, historyHash: historyHashOf(TOKEN, [r1.cid, r1.cid]) },
        fetchPayload: store([VECTOR_CID, bytesOf(VECTOR_ENVELOPE)], [r1.cid, r1.bytes]),
      }),
    );
    expect(entries.map((e) => e.history.status)).toEqual(["verified", "verified"]);
    expect(historyHash.status).toBe("failed");
  });

  it("is unavailable without a live read, across a gap, but hashes only through an older live tip", async () => {
    expect((await verifyPassport(input({}))).historyHash.status).toBe("unavailable");
    const gap = await verifyPassport(
      input({ live: { revision: "5", cid: VECTOR_CID, historyHash: H0 } }),
    );
    expect(gap.historyHash).toMatchObject({ status: "unavailable" });
    expect(gap.historyHash.reason).toContain("revision 1 is not listed");
    const r1 = revisionTwo();
    const older = await verifyPassport(
      input({
        revisions: [
          { revision: "0", cid: VECTOR_CID },
          { revision: "1", cid: r1.cid },
        ],
        live: { revision: "0", cid: VECTOR_CID, historyHash: H0 },
        fetchPayload: store([VECTOR_CID, bytesOf(VECTOR_ENVELOPE)], [r1.cid, r1.bytes]),
      }),
    );
    expect(older.historyHash.status).toBe("verified");
    expect(older.assurance).toBe("live-tip-older");
    expect(older.entries[0]?.source).toBe("live");
    expect(older.entries[1]?.binding.status).toBe("unconfirmed");
  });
});

describe("fetchGatewayPayload", () => {
  it("requests https://<gateway>/ipfs/<cid> and returns the raw bytes", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      return new Response(bytesOf(VECTOR_ENVELOPE) as unknown as BodyInit);
    }) as unknown as typeof fetch;
    const result = await fetchGatewayPayload("gateway.example", VECTOR_CID, fetchImpl);
    expect(urls).toEqual([`https://gateway.example/ipfs/${VECTOR_CID}`]);
    expect(result.ok && result.bytes.byteLength).toBe(312);
  });

  it("refuses CIDs outside the profile before building a URL", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response("x");
    }) as unknown as typeof fetch;
    const result = await fetchGatewayPayload("gateway.example", "../../etc/passwd", fetchImpl);
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  it("reports HTTP errors and oversized bodies", async () => {
    const notFound = (async () => new Response("no", { status: 404 })) as unknown as typeof fetch;
    expect(await fetchGatewayPayload("g", VECTOR_CID, notFound)).toMatchObject({ ok: false });
    const big = (async () => new Response(new Uint8Array(65_537))) as unknown as typeof fetch;
    const result = await fetchGatewayPayload("g", VECTOR_CID, big);
    expect(result.ok).toBe(false);
  });
});

describe("receipt verification and assurance", () => {
  const author = "0x00000000000000000000000000000000000a11ce";
  const row = {
    revision: "0",
    cid: VECTOR_CID,
    chainId: 421614,
    author,
    txHash: `0x${"01".repeat(32)}`,
  };
  const receipt = () => mockRevisionReceipt(TOKEN, row);
  const check = async (
    readReceipt: NonNullable<VerifyInput["readReceipt"]>,
    over: Partial<VerifyInput> = {},
  ) => {
    const entry = (await verifyPassport(input({ revisions: [row], readReceipt, ...over })))
      .entries[0];
    if (!entry) throw new Error("expected one revision");
    return entry.recorded;
  };

  it("verifies revision 0 from the emitting contract and transaction sender, without a live read", async () => {
    const readReceipt = vi.fn(async () => receipt());
    expect(await check(readReceipt)).toEqual({ status: "verified" });
    expect(readReceipt).toHaveBeenCalledExactlyOnceWith(row.chainId, row.txHash);
  });

  it("verifies a revised CID, revision and author on its emitting chain", async () => {
    const r1 = revisionTwo();
    const revised = { ...row, revision: "1", cid: r1.cid, chainId: 84532 };
    const readReceipt = vi.fn(async () => mockRevisionReceipt(TOKEN, revised));
    const outcome = await verifyPassport(
      input({
        revisions: [row, revised],
        live: { revision: "1", cid: r1.cid },
        readReceipt,
        fetchPayload: store([VECTOR_CID, bytesOf(VECTOR_ENVELOPE)], [r1.cid, r1.bytes]),
      }),
    );
    expect(outcome.entries[1]?.recorded.status).toBe("verified");
    expect(readReceipt).toHaveBeenCalledWith(84532, row.txHash);
    for (const wrong of [
      { author: "0x0000000000000000000000000000000000000001" },
      { revision: "2" },
      { cid: VECTOR_CID },
    ]) {
      const result = await verifyPassport(
        input({
          revisions: [revised],
          readReceipt: async () => mockRevisionReceipt(TOKEN, { ...revised, ...wrong }),
        }),
      );
      expect(result.entries[0]?.recorded.status).toBe("failed");
    }
  });

  it("reports missing, failed RPC and metadata as unavailable, reverted as failed", async () => {
    expect((await check(async () => null)).status).toBe("unavailable");
    expect(
      (
        await check(async () => {
          throw new Error("offline");
        })
      ).status,
    ).toBe("unavailable");
    expect(
      (await check(async () => receipt(), { revisions: [{ revision: "0", cid: VECTOR_CID }] }))
        .status,
    ).toBe("unavailable");
    expect((await check(async () => ({ ...receipt(), status: "reverted" }))).status).toBe("failed");
  });

  it("rejects a foreign contract, another token, a wrong sender and an absent event", async () => {
    const r = receipt();
    expect(
      (
        await check(async () => ({
          ...r,
          logs: r.logs.map((log) => ({
            ...log,
            address: "0x0000000000000000000000000000000000000001" as const,
          })),
        }))
      ).status,
    ).toBe("failed");
    expect((await check(async () => mockRevisionReceipt("1", row))).status).toBe("failed");
    expect(
      (await check(async () => ({ ...r, from: "0x0000000000000000000000000000000000000001" })))
        .status,
    ).toBe("failed");
    expect((await check(async () => ({ ...r, logs: [] }))).status).toBe("failed");
  });

  it("matches the displayed live CID, never the replaced indexed CID", async () => {
    const different = computeCidV1(
      bytesOf({ ...VECTOR_ENVELOPE, data: { ...VECTOR_ENVELOPE.data, caskNumber: "2" } }),
    );
    const result = await verifyPassport(
      input({
        revisions: [row],
        live: { revision: "0", cid: different },
        readReceipt: async () => receipt(),
      }),
    );
    expect(result.entries[0]).toMatchObject({
      cid: different,
      conflict: true,
      recorded: { status: "failed" },
    });
    expect(result.notes.join()).toContain(VECTOR_CID);
    expect(result.notes.join()).toContain(different);
    expect(result.entries[0]?.recorded.reason).toContain(VECTOR_CID);
    expect(result.entries[0]?.recorded.reason).toContain(different);
  });

  it("keeps a failing above-tip binding failed, and labels only a passing binding unconfirmed", async () => {
    const wrong = bytesOf({
      ...VECTOR_ENVELOPE,
      revision: "1",
      tokenId: "1",
      previousCid: VECTOR_CID,
    });
    const wrongCid = computeCidV1(wrong);
    const result = await verifyPassport(
      input({
        revisions: [row, { revision: "1", cid: wrongCid }],
        live: { revision: "0", cid: VECTOR_CID },
        fetchPayload: store([VECTOR_CID, bytesOf(VECTOR_ENVELOPE)], [wrongCid, wrong]),
      }),
    );
    expect(result.entries[1]).toMatchObject({
      binding: { status: "failed" },
      assurance: "live-tip-older",
    });
    const offline = await verifyPassport(input({ live: null, liveError: "RPC offline" }));
    expect(offline).toMatchObject({
      assurance: "indexer-only",
      reason: "indexer only: RPC offline",
    });
    expect(offline.entries[0]?.binding).toMatchObject({
      status: "unconfirmed",
      reason: "indexer only: RPC offline",
    });
  });

  it("replaces a conflicting indexed CID at an older live tip, and hashes the live prefix", async () => {
    const r1 = revisionTwo();
    const result = await verifyPassport(
      input({
        revisions: [
          { revision: "0", cid: r1.cid },
          { revision: "1", cid: r1.cid },
        ],
        live: { revision: "0", cid: VECTOR_CID, historyHash: historyHashOf(TOKEN, [VECTOR_CID]) },
        fetchPayload: store([VECTOR_CID, bytesOf(VECTOR_ENVELOPE)], [r1.cid, r1.bytes]),
      }),
    );
    expect(result.entries[0]).toMatchObject({
      cid: VECTOR_CID,
      source: "live",
      conflict: true,
      binding: { status: "verified" },
    });
    expect(result.entries[1]?.binding.status).toBe("unconfirmed");
    expect(result.historyHash.status).toBe("verified");
    expect(result.notes.join()).toContain(r1.cid);
    expect(result.notes.join()).toContain(VECTOR_CID);
  });

  it("adds a missing live tip below indexed revisions while retaining numeric order", async () => {
    const r1 = revisionTwo();
    const result = await verifyPassport(
      input({
        revisions: [{ revision: "1", cid: r1.cid }],
        live: { revision: "0", cid: VECTOR_CID, historyHash: historyHashOf(TOKEN, [VECTOR_CID]) },
        fetchPayload: store([VECTOR_CID, bytesOf(VECTOR_ENVELOPE)], [r1.cid, r1.bytes]),
      }),
    );
    expect(result.entries.map((entry) => [entry.revision, entry.source])).toEqual([
      ["0", "live-only"],
      ["1", "indexed"],
    ]);
    expect(result.historyHash.status).toBe("verified");
    expect(result.entries[0]?.recorded.status).toBe("unavailable");
    expect(result.entries[1]?.binding.status).toBe("unconfirmed");
  });

  it("starts receipt and payload work concurrently and makes one call of each per reference", async () => {
    const fetchPayload = vi.fn(async () => {
      expect(readReceipt).toHaveBeenCalledTimes(1);
      return { ok: true as const, bytes: bytesOf(VECTOR_ENVELOPE) };
    });
    const readReceipt = vi.fn(async () => receipt());
    // Payload checks may start first, but both promise sets must start before either is awaited.
    const payload = vi.fn(() => Promise.resolve().then(() => fetchPayload()));
    await verifyPassport(input({ revisions: [row], fetchPayload: payload, readReceipt }));
    expect(payload).toHaveBeenCalledExactlyOnceWith(VECTOR_CID);
    expect(readReceipt).toHaveBeenCalledExactlyOnceWith(row.chainId, row.txHash);
  });
});
