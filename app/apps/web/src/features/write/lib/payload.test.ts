import {
  canonicalBytes,
  computeCidV1,
  MANIFEST,
  MAX_PAYLOAD_BYTES,
  type PassportEnvelope,
} from "@idpp/passport-config";
import { describe, expect, it, vi } from "vitest";
import { fetchVerifiedPayload } from "@/features/write/lib/payload";

const envelope: PassportEnvelope = {
  schema: "idpp-passport/1",
  deploymentId: MANIFEST.deploymentId,
  tokenId: "12",
  revision: "0",
  previousCid: null,
  kind: "cask",
  granularity: "item",
  data: {
    distillery: "Demo",
    caskType: "Bourbon",
    caskNumber: "1",
    volumeLiters: "200",
    alcoholByVolume: "63.5",
    fillDate: "2026-10-01",
  },
};
const bytes = canonicalBytes(envelope);
const cid = computeCidV1(bytes);
const record = { deploymentId: MANIFEST.deploymentId, tokenId: 12n, revision: 0n };
const response = (body = bytes) => new Response(body.slice().buffer);

describe("fetchVerifiedPayload", () => {
  it("verifies content, schema and binding through the bounded fetch path", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response());
    expect(await fetchVerifiedPayload("gateway.test", cid, record, fetchImpl)).toEqual({
      ok: true,
      envelope,
    });
    expect(fetchImpl).toHaveBeenCalledWith(`https://gateway.test/ipfs/${cid}`, {
      signal: expect.any(AbortSignal),
      cache: "no-store",
    });
  });

  it("rejects a non-profile CID before making a gateway request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    expect(
      await fetchVerifiedPayload("gateway.test", "../../other", record, fetchImpl),
    ).toMatchObject({ ok: false, reason: expect.stringContaining("CID") });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("checks content before parsing and treats invalid data as a revision failure", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      response(new TextEncoder().encode("not JSON")),
    );
    expect(await fetchVerifiedPayload("gateway.test", cid, record, fetchImpl)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("content check failed"),
    });
  });

  it("refuses a correctly hashed payload for another token", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response());
    const result = await fetchVerifiedPayload(
      "gateway.test",
      cid,
      { ...record, tokenId: 13n },
      fetchImpl,
    );
    expect(result).toMatchObject({
      ok: false,
      reason: expect.stringContaining("binding check failed"),
    });
  });

  it("refuses a correctly hashed invalid envelope", async () => {
    const invalid = new TextEncoder().encode('{"kind":"cask"}');
    const fetchImpl = vi.fn<typeof fetch>(async () => response(invalid));
    expect(
      await fetchVerifiedPayload("gateway.test", computeCidV1(invalid), record, fetchImpl),
    ).toMatchObject({
      ok: false,
      reason: expect.stringContaining("not an idpp-passport/1 envelope"),
    });
  });

  it("refuses oversized content-length without consuming the body", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(body, { headers: { "content-length": String(MAX_PAYLOAD_BYTES + 1) } }),
    );
    expect(await fetchVerifiedPayload("gateway.test", cid, record, fetchImpl)).toMatchObject({
      ok: false,
      unavailable: true,
      reason: expect.stringContaining("byte limit"),
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("enforces the byte limit across chunks even when content-length lies", async () => {
    const cancel = vi.fn();
    let chunks = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunks++;
        controller.enqueue(new Uint8Array(MAX_PAYLOAD_BYTES / 2 + 1));
      },
      cancel,
    });
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(body, { headers: { "content-length": "1" } }),
    );
    expect(await fetchVerifiedPayload("gateway.test", cid, record, fetchImpl)).toMatchObject({
      ok: false,
      unavailable: true,
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(chunks).toBeLessThanOrEqual(3);
  });

  it("accepts an envelope exactly at the byte limit", async () => {
    const base = { ...envelope, data: { ...envelope.data, description: "" } };
    base.data.description = "x".repeat(MAX_PAYLOAD_BYTES - canonicalBytes(base).byteLength);
    const full = canonicalBytes(base);
    expect(full.byteLength).toBe(MAX_PAYLOAD_BYTES);
    const fetchImpl = vi.fn<typeof fetch>(async () => response(full));
    expect(
      await fetchVerifiedPayload("gateway.test", computeCidV1(full), record, fetchImpl),
    ).toMatchObject({ ok: true });
  });

  it("cancels a stalled body when the caller's request deadline expires", async () => {
    const cancel = vi.fn();
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ cancel })));
    const pending = fetchVerifiedPayload("gateway.test", cid, record, fetchImpl, controller.signal);
    // Allow the response to be attached, then abort a body read that never finishes.
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort(new DOMException("deadline reached", "TimeoutError"));
    expect(await pending).toMatchObject({
      ok: false,
      unavailable: true,
      reason: expect.stringContaining("deadline reached"),
    });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
