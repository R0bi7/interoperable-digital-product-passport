import {
  canonicalBytes,
  computeCidV1,
  historyHashOf,
  MANIFEST,
  MAX_PAYLOAD_BYTES,
  type PassportEnvelope,
} from "@idpp/passport-config";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Location, PassportRecord } from "@/features/write/lib/locate";
import { fetchVerifiedPayload } from "@/features/write/lib/payload";
import {
  SOURCE_CASK_DEADLINE_MS,
  type SourceCask,
  type SourceCaskDeps,
  validateSourceCasks,
} from "@/lib/operator/source-casks";

const TOKEN = "421614000000000006";
const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const source = (overrides: Partial<SourceCask> = {}): SourceCask => ({
  tokenId: TOKEN,
  revision: "0",
  volumeMl: "700",
  ...overrides,
});

function scenario(tip = 0, kind: "cask" | "bottle" = "cask") {
  const payloads = new Map<string, Uint8Array>();
  const cids: string[] = [];
  for (let revision = 0; revision <= tip; revision++) {
    const envelope = {
      schema: "idpp-passport/1",
      deploymentId: MANIFEST.deploymentId,
      tokenId: TOKEN,
      revision: String(revision),
      previousCid: cids[revision - 1] ?? null,
      granularity: "item",
      ...(kind === "cask"
        ? {
            kind: "cask",
            data: {
              distillery: "Demo",
              caskType: "Bourbon",
              caskNumber: "1",
              volumeLiters: revision === 1 ? "0.7" : "200",
              alcoholByVolume: "63.5",
              fillDate: "2026-10-01",
            },
          }
        : {
            kind: "bottle",
            data: {
              brand: "Demo",
              bottleType: "Glass",
              bottledDate: "2026-10-20",
              volumeMl: "700",
              alcoholByVolume: "40",
            },
          }),
    } as PassportEnvelope;
    const bytes = canonicalBytes(envelope);
    const cid = computeCidV1(bytes);
    cids.push(cid);
    payloads.set(cid, bytes);
  }
  const record: PassportRecord = {
    chainId: 84532,
    blockNumber: 123n,
    owner: OWNER,
    revision: BigInt(tip),
    cid: cids[tip] as string,
    historyHash: historyHashOf(TOKEN, cids),
  };
  const locate = vi.fn(async (): Promise<Location> => ({ kind: "held", record, probes: [] }));
  const fetchImpl = vi.fn<typeof fetch>(async (url) => {
    const cid = String(url).split("/").at(-1) as string;
    const bytes = payloads.get(cid);
    return bytes ? new Response(bytes.slice().buffer) : new Response(null, { status: 404 });
  });
  const fetchPayload = vi.fn<SourceCaskDeps["fetchPayload"]>((cid, binding, signal) =>
    fetchVerifiedPayload("gateway.test", cid, binding, fetchImpl, signal),
  );
  return { record, cids, payloads, locate, fetchImpl, fetchPayload };
}

afterEach(() => vi.useRealTimers());

describe("validateSourceCasks", () => {
  it("refuses a held cask if another chain probe failed before retrieving or pinning payloads", async () => {
    const deps = scenario();
    deps.locate.mockResolvedValue({
      kind: "held",
      record: deps.record,
      probes: [
        { chainId: deps.record.chainId, status: "present", record: deps.record },
        { chainId: 11155111, status: "error", message: "RPC unavailable" },
      ],
    });
    await expect(validateSourceCasks([source()], deps)).rejects.toMatchObject({
      code: "chain_unavailable",
    });
    expect(deps.fetchPayload).not.toHaveBeenCalled();
  });

  it("accepts a cask held away from its issuing chain", async () => {
    const d = scenario();
    await validateSourceCasks([source()], d);
    expect(d.locate).toHaveBeenCalledWith(BigInt(TOKEN));
    expect(d.record.chainId).toBe(84532);
  });

  it("accepts a legitimate older revision only after authenticating the whole history", async () => {
    const d = scenario(2);
    await validateSourceCasks([source({ revision: "1" })], d);
    expect(d.fetchPayload.mock.calls.map(([, binding]) => binding.revision)).toEqual([2n, 1n, 0n]);
  });

  it("walks each cask once even when it is referenced at two revisions", async () => {
    const d = scenario(2);
    await validateSourceCasks([source(), source({ revision: "1" })], d);
    expect(d.locate).toHaveBeenCalledTimes(1);
    expect(d.fetchPayload).toHaveBeenCalledTimes(3);
  });

  it("rejects an absent cask", async () => {
    const d = scenario();
    d.locate.mockResolvedValue({ kind: "not_held", probes: [] });
    await expect(validateSourceCasks([source()], d)).rejects.toMatchObject({
      code: "source_cask_missing",
      message: expect.stringContaining(TOKEN),
    });
    expect(d.fetchPayload).not.toHaveBeenCalled();
  });

  it.each(["unknown", "rejection"])(
    "never treats a failed chain read as absence (%s)",
    async (mode) => {
      const d = scenario();
      if (mode === "unknown")
        d.locate.mockResolvedValue({
          kind: "unknown",
          probes: [],
          reason: "could not read chain 84532",
        });
      else d.locate.mockRejectedValue(new Error("RPC secret URL"));
      await expect(validateSourceCasks([source()], d)).rejects.toMatchObject({
        code: "chain_unavailable",
      });
      expect(d.fetchPayload).not.toHaveBeenCalled();
    },
  );

  it("rejects a reference to a bottle", async () => {
    await expect(validateSourceCasks([source()], scenario(0, "bottle"))).rejects.toMatchObject({
      code: "source_cask_not_cask",
    });
  });

  it("rejects a revision above the live tip before fetching", async () => {
    const d = scenario();
    await expect(validateSourceCasks([source({ revision: "1" })], d)).rejects.toMatchObject({
      code: "source_cask_revision",
    });
    expect(d.fetchPayload).not.toHaveBeenCalled();
  });

  it("also rejects a nonexistent revision on a duplicate cask reference", async () => {
    await expect(
      validateSourceCasks([source(), source({ revision: "3" })], scenario(2)),
    ).rejects.toMatchObject({ code: "source_cask_revision" });
  });

  it("compares against the referenced revision's volume with exact decimals", async () => {
    const d = scenario(2);
    await expect(
      validateSourceCasks([source({ revision: "1", volumeMl: "700.000000000000000001" })], d),
    ).rejects.toMatchObject({ code: "source_cask_overdraw" });
    await expect(
      validateSourceCasks([source({ revision: "1", volumeMl: "700.000" })], d),
    ).resolves.toBeUndefined();
  });

  it("rejects content, schema or binding failures in a predecessor", async () => {
    for (const failure of ["content", "schema", "binding"]) {
      const d = scenario(2);
      d.fetchPayload.mockImplementationOnce(async () => ({
        ok: false,
        reason: `${failure} check failed`,
      }));
      await expect(validateSourceCasks([source()], d)).rejects.toMatchObject({
        code: "source_cask_revision",
      });
    }
  });

  it("rejects a decoy predecessor even though its links, content, schema and binding pass", async () => {
    const d = scenario(1);
    // A recorded tip pointing to an unrecorded revision zero: every payload check passes;
    // the live commitment contains the actually recorded predecessor instead.
    const actualZero = computeCidV1(new TextEncoder().encode("actually recorded revision zero"));
    d.record.historyHash = historyHashOf(TOKEN, [actualZero, d.record.cid]);
    await expect(validateSourceCasks([source()], d)).rejects.toMatchObject({
      code: "source_cask_revision",
      message: expect.stringContaining("decoy"),
    });
    expect(d.fetchPayload).toHaveBeenCalledTimes(2);
  });

  it("accepts tip 20 and fetches at most 21 payloads", async () => {
    const d = scenario(20);
    await validateSourceCasks([source()], d);
    expect(d.fetchPayload).toHaveBeenCalledTimes(21);
  });

  it("refuses tip 21 before any gateway request", async () => {
    const d = scenario(21);
    await expect(validateSourceCasks([source()], d)).rejects.toMatchObject({
      code: "source_cask_revision",
      message: expect.stringContaining(
        "a history above revision 20 is not validated by this demonstrator",
      ),
    });
    expect(d.fetchPayload).not.toHaveBeenCalled();
  });

  it("refuses a gateway timeout as unavailable", async () => {
    const d = scenario();
    d.fetchImpl.mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    await expect(validateSourceCasks([source()], d)).rejects.toMatchObject({
      code: "source_cask_unavailable",
    });
  });

  it("refuses an oversized body without reading it completely", async () => {
    const d = scenario();
    const cancel = vi.fn();
    let pulls = 0;
    d.fetchImpl.mockImplementation(
      async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              pulls++;
              controller.enqueue(new Uint8Array(MAX_PAYLOAD_BYTES + 1));
            },
            cancel,
          }),
        ),
    );
    await expect(validateSourceCasks([source()], d)).rejects.toMatchObject({
      code: "source_cask_unavailable",
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(pulls).toBeLessThanOrEqual(2);
  });

  it("applies one 60 second deadline across the request, including stalled chain reads", async () => {
    vi.useFakeTimers();
    const d = scenario();
    d.locate.mockImplementation(() => new Promise(() => {}));
    const pending = expect(validateSourceCasks([source(), source()], d)).rejects.toMatchObject({
      code: "source_cask_unavailable",
      message: expect.stringContaining("60 second request deadline"),
    });
    await vi.advanceTimersByTimeAsync(SOURCE_CASK_DEADLINE_MS);
    await pending;
    expect(d.locate).toHaveBeenCalledTimes(1);
  });

  it("shares the remaining deadline with a stalled gateway body and cancels it", async () => {
    vi.useFakeTimers();
    const d = scenario(1);
    const cancel = vi.fn();
    d.fetchImpl.mockImplementation(async () => new Response(new ReadableStream({ cancel })));
    const pending = expect(validateSourceCasks([source()], d)).rejects.toMatchObject({
      code: "source_cask_unavailable",
    });
    await vi.advanceTimersByTimeAsync(SOURCE_CASK_DEADLINE_MS);
    await pending;
    expect(cancel).toHaveBeenCalled();
    expect(d.fetchPayload).toHaveBeenCalledTimes(1);
  });

  it("does no work for an empty list", async () => {
    const d = scenario();
    await validateSourceCasks([], d);
    expect(d.locate).not.toHaveBeenCalled();
    expect(d.fetchPayload).not.toHaveBeenCalled();
  });
});
