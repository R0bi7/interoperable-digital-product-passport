import { describe, expect, it, vi } from "vitest";
import { PinError, pinEnvelope } from "@/lib/pinata/pin";
import { createLegacyUploader, type PinUploader, resolveUploadPath } from "@/lib/pinata/uploaders";

// Shared test vector (docs/TECHNICAL-REFERENCE.md, "Canonical bytes and CID profile").
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
const VECTOR_BYTES = new TextEncoder().encode(
  '{"data":{"alcoholByVolume":"63.5","caskNumber":"1","caskType":"Bourbon barrel","distillery":"Demo Distillery","fillDate":"2026-10-01","volumeLiters":"200"},"deploymentId":"whisky-v2-final","granularity":"item","kind":"cask","previousCid":null,"revision":"0","schema":"idpp-passport/1","tokenId":"97000000000000"}',
);
const OTHER_CID = "bafkreidgvpkjawlxz6sffxzwgooowe5yt7i6wsyg236mfoks77nywkptdq";

const noSleep = async () => {};
const fastReadBack = { attempts: 3, delayMs: 0 };

function uploaderReturning(cid: string) {
  const upload = vi.fn(async (_bytes: Uint8Array, _name: string) => cid);
  const uploader: PinUploader = { path: "sdk", upload };
  return { uploader, upload };
}

function gatewayServing(body: Uint8Array | null, status = 200) {
  return vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(body === null ? null : (body as Uint8Array<ArrayBuffer>), { status }),
  ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

const base = { gatewayHost: "gw.test", readBack: fastReadBack, sleep: noSleep };

describe("pinEnvelope", () => {
  it("uploads the exact canonical bytes and returns the predicted CID", async () => {
    const { uploader, upload } = uploaderReturning(VECTOR_CID);
    const fetchImpl = gatewayServing(VECTOR_BYTES);
    const result = await pinEnvelope(VECTOR_ENVELOPE, { ...base, uploader, fetchImpl });
    expect(result.cid).toBe(VECTOR_CID);
    expect(Buffer.from(result.bytes).equals(Buffer.from(VECTOR_BYTES))).toBe(true);
    expect(upload).toHaveBeenCalledTimes(1);
    const uploaded = upload.mock.calls[0]?.[0] as Uint8Array;
    expect(Buffer.from(uploaded).equals(Buffer.from(VECTOR_BYTES))).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(`https://gw.test/ipfs/${VECTOR_CID}`, {
      cache: "no-store",
    });
  });

  it("throws cid_mismatch when Pinata returns another CID, and does not read back", async () => {
    const { uploader } = uploaderReturning(OTHER_CID);
    const fetchImpl = gatewayServing(VECTOR_BYTES);
    const failure = await pinEnvelope(VECTOR_ENVELOPE, { ...base, uploader, fetchImpl }).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(PinError);
    expect((failure as PinError).code).toBe("cid_mismatch");
    expect((failure as PinError).message).toContain(OTHER_CID);
    expect((failure as PinError).message).toContain(VECTOR_CID);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws readback_mismatch when the gateway serves different bytes", async () => {
    const { uploader } = uploaderReturning(VECTOR_CID);
    const corrupt = Uint8Array.from(VECTOR_BYTES);
    corrupt[10] = (corrupt[10] ?? 0) ^ 0xff;
    const fetchImpl = gatewayServing(corrupt);
    await expect(
      pinEnvelope(VECTOR_ENVELOPE, { ...base, uploader, fetchImpl }),
    ).rejects.toMatchObject({
      code: "readback_mismatch",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws readback_mismatch for truncated bytes", async () => {
    const { uploader } = uploaderReturning(VECTOR_CID);
    const fetchImpl = gatewayServing(VECTOR_BYTES.slice(0, 100));
    await expect(
      pinEnvelope(VECTOR_ENVELOPE, { ...base, uploader, fetchImpl }),
    ).rejects.toMatchObject({
      code: "readback_mismatch",
    });
  });

  it("retries a gateway 404 and succeeds once the pin appears", async () => {
    const { uploader } = uploaderReturning(VECTOR_CID);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(
        new Response(VECTOR_BYTES as Uint8Array<ArrayBuffer>),
      ) as unknown as typeof fetch;
    const result = await pinEnvelope(VECTOR_ENVELOPE, { ...base, uploader, fetchImpl });
    expect(result.cid).toBe(VECTOR_CID);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("throws readback_failed when the gateway never serves the pin", async () => {
    const { uploader } = uploaderReturning(VECTOR_CID);
    const fetchImpl = gatewayServing(null, 404);
    await expect(
      pinEnvelope(VECTOR_ENVELOPE, { ...base, uploader, fetchImpl }),
    ).rejects.toMatchObject({
      code: "readback_failed",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(fastReadBack.attempts);
  });

  it("wraps uploader errors as upload_failed", async () => {
    const uploader: PinUploader = {
      path: "legacy",
      upload: async () => {
        throw new Error("401 unauthorized");
      },
    };
    await expect(pinEnvelope(VECTOR_ENVELOPE, { ...base, uploader })).rejects.toMatchObject({
      code: "upload_failed",
    });
  });

  it("rejects an invalid envelope before any network call", async () => {
    const { uploader, upload } = uploaderReturning(VECTOR_CID);
    const fetchImpl = gatewayServing(VECTOR_BYTES);
    const invalid = { ...VECTOR_ENVELOPE, chainId: 421614 };
    await expect(pinEnvelope(invalid, { ...base, uploader, fetchImpl })).rejects.toMatchObject({
      code: "invalid_envelope",
    });
    expect(upload).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a payload above 64 KiB", async () => {
    const { uploader, upload } = uploaderReturning(VECTOR_CID);
    const big = {
      ...VECTOR_ENVELOPE,
      data: { ...VECTOR_ENVELOPE.data, description: "x".repeat(70_000) },
    };
    await expect(pinEnvelope(big, { ...base, uploader })).rejects.toBeInstanceOf(PinError);
    expect(upload).not.toHaveBeenCalled();
  });
});

describe("upload path selection", () => {
  it("defaults to the SDK path and accepts legacy", () => {
    expect(resolveUploadPath(undefined)).toBe("sdk");
    expect(resolveUploadPath("")).toBe("sdk");
    expect(resolveUploadPath("legacy")).toBe("legacy");
  });

  it("rejects unknown values, including both", () => {
    expect(() => resolveUploadPath("both")).toThrow(/PINATA_UPLOAD_PATH/);
    expect(() => resolveUploadPath("ipfs")).toThrow(/PINATA_UPLOAD_PATH/);
  });
});

describe("legacy uploader", () => {
  it("posts cidVersion 1 with the bearer token and returns IpfsHash", async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ IpfsHash: VECTOR_CID })),
    );
    const cid = await createLegacyUploader(
      "jwt-secret",
      fetchImpl as unknown as typeof fetch,
    ).upload(VECTOR_BYTES, "x.json");
    expect(cid).toBe(VECTOR_CID);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.pinata.cloud/pinning/pinFileToIPFS");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt-secret");
    const form = init.body as FormData;
    expect(JSON.parse(form.get("pinataOptions") as string)).toEqual({ cidVersion: 1 });
    const file = form.get("file") as File;
    expect(Buffer.from(await file.arrayBuffer()).equals(Buffer.from(VECTOR_BYTES))).toBe(true);
  });

  it("fails on HTTP errors and a missing hash", async () => {
    const failing = vi.fn(
      async () => new Response("nope", { status: 403 }),
    ) as unknown as typeof fetch;
    await expect(createLegacyUploader("j", failing).upload(VECTOR_BYTES, "x")).rejects.toThrow(
      /403/,
    );
    const empty = vi.fn(async () => new Response("{}")) as unknown as typeof fetch;
    await expect(createLegacyUploader("j", empty).upload(VECTOR_BYTES, "x")).rejects.toThrow(
      /IpfsHash/,
    );
  });
});
