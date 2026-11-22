import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/features/write/lib/api";
import {
  isChallengeLost,
  isUserRejection,
  pinWithSignature,
  SignatureRejectedError,
} from "@/features/write/lib/pin-client";

const ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const SIGNATURE = `0x${"ab".repeat(65)}` as const;
const envelope = { schema: "idpp-passport/1", tokenId: "97000000000003", revision: "1" };

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("pinWithSignature", () => {
  it("fetches the challenge, signs its message and posts { envelope, address, signature }", async () => {
    const fetchMock = mockFetch((url) =>
      url.startsWith("/api/pin/challenge")
        ? json({ nonce: "n1", message: "IDPP pin challenge: n1" })
        : json({ cid: "bafy" }),
    );
    const sign = vi.fn(async (_message: string) => SIGNATURE);

    expect(await pinWithSignature(envelope, ADDRESS, sign)).toEqual({ cid: "bafy" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/pin/challenge?address=${ADDRESS}`);
    expect(sign).toHaveBeenCalledWith("IDPP pin challenge: n1");
    const [url, init] = fetchMock.mock.calls[1] ?? [];
    expect(url).toBe("/api/pin");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      envelope,
      address: ADDRESS,
      signature: SIGNATURE,
    });
  });

  it("turns a declined signature into SignatureRejectedError and posts nothing", async () => {
    const fetchMock = mockFetch(() => json({ nonce: "n1", message: "IDPP pin challenge: n1" }));
    const rejected = Object.assign(new Error("User rejected the request."), { code: 4001 });
    await expect(
      pinWithSignature(envelope, ADDRESS, async () => {
        throw rejected;
      }),
    ).rejects.toBeInstanceOf(SignatureRejectedError);
    expect(fetchMock).toHaveBeenCalledTimes(1); // the challenge only
  });

  it("passes other signing failures through unchanged", async () => {
    mockFetch(() => json({ nonce: "n1", message: "m" }));
    const boom = new Error("wallet locked");
    await expect(
      pinWithSignature(envelope, ADDRESS, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });

  it("keeps the server's structured refusal", async () => {
    mockFetch((url) =>
      url.startsWith("/api/pin/challenge")
        ? json({ nonce: "n1", message: "m" })
        : json({ error: { code: "not_issuer", message: "signer is not an issuer" } }, 403),
    );
    const error = await pinWithSignature(envelope, ADDRESS, async () => SIGNATURE).catch((e) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ code: "not_issuer", status: 403 });
  });
});

describe("isUserRejection", () => {
  it("recognises code 4001 and viem's UserRejectedRequestError, also nested", () => {
    expect(isUserRejection({ code: 4001 })).toBe(true);
    expect(isUserRejection({ name: "UserRejectedRequestError" })).toBe(true);
    expect(isUserRejection(new Error("outer", { cause: { code: 4001 } }))).toBe(true);
    expect(isUserRejection(new Error("wallet locked"))).toBe(false);
    expect(isUserRejection(undefined)).toBe(false);
  });
});

describe("isChallengeLost", () => {
  it("is true for a 401 no_challenge or bad_signature, false for anything else", () => {
    expect(isChallengeLost(new ApiClientError("no_challenge", "x", 401))).toBe(true);
    expect(isChallengeLost(new ApiClientError("bad_signature", "x", 401))).toBe(true);
    expect(isChallengeLost(new ApiClientError("not_issuer", "x", 403))).toBe(false);
    expect(isChallengeLost(new ApiClientError("rate_limited", "x", 429))).toBe(false);
    expect(isChallengeLost(new Error("no_challenge"))).toBe(false);
  });
});
