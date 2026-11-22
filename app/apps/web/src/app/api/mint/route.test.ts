import { BaseError } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const issuePassport = vi.hoisted(() => vi.fn());
vi.mock("@/lib/operator/issue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/operator/issue")>()),
  issuePassport,
}));

import { GET as getChallenge } from "@/app/api/mint/challenge/route";
import { POST as postMint } from "@/app/api/mint/route";
import { clearChallenges, issueChallenge } from "@/lib/operator/challenge";

const issuer = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const outsider = privateKeyToAccount(
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
);

process.env.OPERATOR_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
process.env.ISSUER_ALLOWLIST = issuer.address;
process.env.PINATA_JWT = "test-jwt";

const envelopeData = {
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
const RESULT = {
  tokenId: "421614000000000006",
  cid: "bafkreibnugdjrt4xfyb4untqebjbktbq7lhbbxbiwtlgcefchoioao6dhm",
  txHash: `0x${"cd".repeat(32)}`,
};

function mintRequest(body: unknown) {
  return new Request("http://localhost/api/mint", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function signedBody(
  signer: typeof issuer,
  overrides: Record<string, unknown> = {},
  claimed: string = signer.address,
) {
  const { message } = issueChallenge(claimed);
  return {
    chainId: 421614,
    to: signer.address,
    envelopeData,
    address: claimed,
    signature: await signer.signMessage({ message }),
    ...overrides,
  };
}

beforeEach(() => {
  clearChallenges();
  issuePassport.mockReset();
  issuePassport.mockResolvedValue(RESULT);
});

describe("GET /api/mint/challenge", () => {
  const call = (address?: string) =>
    getChallenge(
      new Request(`http://localhost/api/mint/challenge${address ? `?address=${address}` : ""}`),
    );

  it("returns { nonce, message } to an allowlisted issuer", async () => {
    const response = await call(issuer.address);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { nonce: string; message: string };
    expect(body.message).toBe(`IDPP mint challenge: ${body.nonce}`);
  });

  it("refuses an address that is not allowlisted", async () => {
    const response = await call(outsider.address);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "not_allowlisted" } });
  });

  it("rejects a missing or malformed address", async () => {
    expect((await call()).status).toBe(400);
    expect((await call("nope")).status).toBe(400);
  });
});

describe("POST /api/mint", () => {
  it("mints for an allowlisted issuer with a valid signature", async () => {
    const response = await postMint(mintRequest(await signedBody(issuer)));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(RESULT);
    expect(issuePassport).toHaveBeenCalledWith({
      chainId: 421614,
      to: issuer.address,
      envelopeData,
    });
  });

  it("refuses a validly signed request from an address that is not allowlisted", async () => {
    const response = await postMint(mintRequest(await signedBody(outsider)));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "not_allowlisted" } });
    expect(issuePassport).not.toHaveBeenCalled();
  });

  it("refuses an allowlisted address whose signature was made by another key", async () => {
    // outsider signs the challenge issued to the issuer and claims to be the issuer
    const { message } = issueChallenge(issuer.address);
    const forged = await outsider.signMessage({ message });
    const response = await postMint(
      mintRequest({
        chainId: 421614,
        to: issuer.address,
        envelopeData,
        address: issuer.address,
        signature: forged,
      }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "bad_signature" } });
    expect(issuePassport).not.toHaveBeenCalled();
  });

  it("refuses a request without a pending challenge", async () => {
    const body = await signedBody(issuer);
    clearChallenges();
    const response = await postMint(mintRequest(body));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "no_challenge" } });
    expect(issuePassport).not.toHaveBeenCalled();
  });

  it("refuses a replayed request: the challenge is single use", async () => {
    const body = await signedBody(issuer);
    expect((await postMint(mintRequest(body))).status).toBe(200);
    const replay = await postMint(mintRequest(body));
    expect(replay.status).toBe(401);
    expect(issuePassport).toHaveBeenCalledTimes(1);
  });

  it("refuses a missing signature", async () => {
    const { signature: _omitted, ...rest } = await signedBody(issuer);
    const response = await postMint(mintRequest(rest));
    expect(response.status).toBe(400);
    expect(issuePassport).not.toHaveBeenCalled();
  });

  it("rejects an unknown chain and keeps the challenge for a corrected request", async () => {
    const body = await signedBody(issuer, { chainId: 1 });
    const response = await postMint(mintRequest(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "unsupported_chain" } });
    expect((await postMint(mintRequest({ ...body, chainId: 421614 }))).status).toBe(200);
  });

  it("rejects an invalid envelope before consuming the challenge", async () => {
    const body = await signedBody(issuer, {
      envelopeData: { ...envelopeData, data: { distillery: "x" } },
    });
    const response = await postMint(mintRequest(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_envelope" } });
    expect(issuePassport).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const response = await postMint(
      new Request("http://localhost/api/mint", { method: "POST", body: "{" }),
    );
    expect(response.status).toBe(400);
  });

  it("reports an RPC failure as chain_unavailable without echoing the RPC URL", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    issuePassport.mockRejectedValue(new BaseError("fetch failed at https://rpc.example/key-123"));
    const response = await postMint(mintRequest(await signedBody(issuer)));
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).toContain("chain_unavailable");
    expect(text).not.toContain("key-123");
  });

  it("never leaks the operator key or the Pinata JWT in error bodies", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    issuePassport.mockRejectedValue(
      new Error(`boom ${process.env.OPERATOR_PRIVATE_KEY} ${process.env.PINATA_JWT}`),
    );
    const response = await postMint(mintRequest(await signedBody(issuer)));
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain(process.env.OPERATOR_PRIVATE_KEY as string);
    expect(text).not.toContain("test-jwt");
    expect(text).toContain("internal_error");
  });
});
