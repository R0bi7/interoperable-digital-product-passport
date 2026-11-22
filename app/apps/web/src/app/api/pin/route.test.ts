import { MANIFEST } from "@idpp/passport-config";
import { privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const validateLiveSourceCasks = vi.hoisted(() => vi.fn());
vi.mock("@/lib/operator/source-casks-live", () => ({ validateLiveSourceCasks }));

const pinEnvelope = vi.hoisted(() => vi.fn());
vi.mock("@/lib/pinata/pin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pinata/pin")>()),
  pinEnvelope,
}));

// Chain reads: a fake public client per chain, answering from `chainState`.
type Token = {
  owner: `0x${string}`;
  revision: bigint;
  cid: string;
};
const chainState = vi.hoisted(() => ({
  tokens: new Map<number, Token>(),
  /** `isIssuer` per chain (lowercase addresses). */
  issuers: new Map<number, Set<string>>(),
  failing: new Set<number>(),
}));
vi.mock("@/lib/operator/clients", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/operator/clients")>();
  const manifest = await import("@idpp/passport-config");
  const { ContractFunctionRevertedError, encodeErrorResult } = await import("viem");
  return {
    ...original,
    getDistilleryAddress: (chainId: number) => manifest.getChain(chainId)?.address,
    getPublicClient: (chainId: number) => ({
      async readContract({
        functionName,
        args,
      }: {
        functionName: string;
        args: readonly unknown[];
      }) {
        if (chainState.failing.has(chainId)) throw new Error("fetch failed");
        const token = chainState.tokens.get(chainId);
        if (functionName === "ownerOf") {
          if (!token) {
            throw new ContractFunctionRevertedError({
              abi: manifest.whiskyDistilleryAbi,
              functionName: "ownerOf",
              data: encodeErrorResult({
                abi: manifest.whiskyDistilleryAbi,
                errorName: "ERC721NonexistentToken",
                args: [args[0] as bigint],
              }),
            });
          }
          return token.owner;
        }
        if (!token) throw new Error(`unexpected ${functionName} on a chain without the token`);
        if (functionName === "isIssuer") {
          return chainState.issuers.get(chainId)?.has((args[0] as string).toLowerCase()) ?? false;
        }
        if (functionName === "passportOf") return { revision: token.revision, cid: token.cid };
        throw new Error(`unexpected read ${functionName}`);
      },
    }),
  };
});

import { GET as getChallenge } from "@/app/api/pin/challenge/route";
import { POST } from "@/app/api/pin/route";
import { clearChallenges, issueChallenge } from "@/lib/operator/challenge";
import { SourceCaskError } from "@/lib/operator/source-casks";
import { PinError } from "@/lib/pinata/pin";

process.env.OPERATOR_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
process.env.ISSUER_ALLOWLIST = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
process.env.PINATA_JWT = "test-jwt";

const issuer = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const holder = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const stranger = privateKeyToAccount(
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
);

const [home] = MANIFEST.chains;
if (!home) throw new Error("manifest has no chains");
const TOKEN = "97000000000003";
const CID_0 = "bafkreibnugdjrt4xfyb4untqebjbktbq7lhbbxbiwtlgcefchoioao6dhm";
const CID_NEW = "bafkreidgvpkjawlxz6sffxzwgooowe5yt7i6wsyg236mfoks77nywkptdq";

const envelope = (over: Record<string, unknown> = {}) => ({
  schema: "idpp-passport/1",
  deploymentId: MANIFEST.deploymentId,
  tokenId: TOKEN,
  revision: "1",
  previousCid: CID_0,
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
  ...over,
});

let ipCounter = 0;
const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/pin", {
      method: "POST",
      // a distinct client per call, so the per-IP limit does not interfere (see its own test)
      headers: { "x-forwarded-for": `198.51.100.${++ipCounter % 250}` },
      body: JSON.stringify(body),
    }),
  );
const challengeFor = async (address: string) => {
  const response = await getChallenge(
    new Request(`http://localhost/api/pin/challenge?address=${address}`, {
      headers: { "x-forwarded-for": `192.0.2.${++ipCounter % 250}` },
    }),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as { nonce: string; message: string };
};
/** Challenge, signature, POST: the flow of the revise page. */
async function signedPost(
  account: typeof holder,
  env: unknown = envelope(),
  signWith?: (challenge: { message: string }) => Promise<`0x${string}`>,
) {
  const challenge = await challengeFor(account.address);
  const signature = signWith
    ? await signWith(challenge)
    : await account.signMessage({ message: challenge.message });
  return post({ envelope: env, address: account.address, signature });
}
const errorCode = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

beforeEach(() => {
  validateLiveSourceCasks.mockReset();
  validateLiveSourceCasks.mockResolvedValue(undefined);
  pinEnvelope.mockReset();
  pinEnvelope.mockResolvedValue({ cid: CID_NEW, bytes: new Uint8Array() });
  clearChallenges();
  chainState.tokens.clear();
  chainState.failing.clear();
  chainState.tokens.set(home.chainId, { owner: holder.address, revision: 0n, cid: CID_0 });
  chainState.issuers.clear();
  for (const chain of MANIFEST.chains) {
    chainState.issuers.set(chain.chainId, new Set([issuer.address.toLowerCase()]));
  }
});

describe("GET /api/pin/challenge", () => {
  it("answers { nonce, message } with the pin prefix", async () => {
    const { nonce, message } = await challengeFor(holder.address);
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(message).toBe(`IDPP pin challenge: ${nonce}`);
  });

  it("rejects a missing or malformed address", async () => {
    for (const query of ["", "?address=nope"]) {
      const response = await getChallenge(
        new Request(`http://localhost/api/pin/challenge${query}`),
      );
      expect(response.status).toBe(400);
    }
  });

  it("is rate limited per client", async () => {
    const ask = () =>
      getChallenge(
        new Request(`http://localhost/api/pin/challenge?address=${holder.address}`, {
          headers: { "x-forwarded-for": "203.0.113.50" },
        }),
      );
    for (let i = 0; i < 20; i++) expect((await ask()).status).toBe(200);
    const limited = await ask();
    expect(limited.status).toBe(429);
    expect(await errorCode(limited)).toBe("rate_limited");
  });
});

describe("POST /api/pin", () => {
  const sourceCasks = [{ tokenId: "12", revision: "0", volumeMl: "700" }];
  const bottle = () =>
    envelope({
      kind: "bottle",
      data: {
        brand: "Demo",
        bottleType: "Glass",
        bottledDate: "2026-10-20",
        volumeMl: "700",
        alcoholByVolume: "40",
        sourceCasks,
      },
    });

  it.each([
    ["source_cask_missing", 422],
    ["source_cask_not_cask", 422],
    ["source_cask_revision", 422],
    ["source_cask_overdraw", 422],
    ["source_cask_unavailable", 503],
    ["chain_unavailable", 503],
  ] as const)("refuses %s before pinning (%s)", async (code, status) => {
    validateLiveSourceCasks.mockRejectedValue(
      new SourceCaskError(code, "source cask 12: failed rule"),
    );
    const response = await signedPost(issuer, bottle());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({
      error: { code, message: "source cask 12: failed rule" },
    });
    expect(validateLiveSourceCasks).toHaveBeenCalledWith(sourceCasks);
    expect(pinEnvelope).not.toHaveBeenCalled();
  });

  it("authenticates and authorizes before checking bottle sources", async () => {
    const response = await signedPost(holder, bottle());
    expect(response.status).toBe(403);
    expect(validateLiveSourceCasks).not.toHaveBeenCalled();
    expect(pinEnvelope).not.toHaveBeenCalled();
  });

  it("checks valid bottle sources before pinning", async () => {
    expect((await signedPost(issuer, bottle())).status).toBe(200);
    expect(validateLiveSourceCasks).toHaveBeenCalledWith(sourceCasks);
    expect(validateLiveSourceCasks.mock.invocationCallOrder[0]).toBeLessThan(
      pinEnvelope.mock.invocationCallOrder[0] as number,
    );
  });

  it("pins for an issuer and returns the predicted CID", async () => {
    const response = await signedPost(issuer);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cid: CID_NEW });
    expect(pinEnvelope).toHaveBeenCalledTimes(1);
    expect(pinEnvelope.mock.calls[0]?.[0]).toMatchObject({ tokenId: TOKEN, revision: "1" });
  });

  it("refuses the holder, who is not an issuer", async () => {
    const response = await signedPost(holder);
    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("not_issuer");
    expect(pinEnvelope).not.toHaveBeenCalled();
  });

  it("refuses a stranger", async () => {
    const response = await signedPost(stranger);
    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("not_issuer");
    expect(pinEnvelope).not.toHaveBeenCalled();
  });

  it("refuses an issuer whose role was revoked on the chain that holds the token", async () => {
    chainState.issuers.set(home.chainId, new Set());
    const response = await signedPost(issuer);
    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("not_issuer");
  });

  it("refuses a revision that is not on-chain revision + 1", async () => {
    chainState.tokens.set(home.chainId, { owner: holder.address, revision: 2n, cid: CID_NEW });
    const response = await signedPost(issuer, envelope({ revision: "1", previousCid: CID_NEW }));
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("stale_base");
    expect(pinEnvelope).not.toHaveBeenCalled();
  });

  it("refuses a previousCid that is not the on-chain cid", async () => {
    const response = await signedPost(issuer, envelope({ previousCid: CID_NEW }));
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("stale_base");
    expect(pinEnvelope).not.toHaveBeenCalled();
  });

  it("refuses revision 0 without consuming the challenge", async () => {
    const challenge = await challengeFor(issuer.address);
    const signature = await issuer.signMessage({ message: challenge.message });
    const zero = envelope({ revision: "0", previousCid: null });
    const refused = await post({ envelope: zero, address: issuer.address, signature });
    expect(refused.status).toBe(400);
    expect(await errorCode(refused)).toBe("invalid_request");
    // the same signature still works for a legitimate request
    const ok = await post({ envelope: envelope(), address: issuer.address, signature });
    expect(ok.status).toBe(200);
  });

  it("refuses a replayed signature: the nonce is single use", async () => {
    const challenge = await challengeFor(issuer.address);
    const signature = await issuer.signMessage({ message: challenge.message });
    expect((await post({ envelope: envelope(), address: issuer.address, signature })).status).toBe(
      200,
    );
    const replay = await post({ envelope: envelope(), address: issuer.address, signature });
    expect(replay.status).toBe(401);
    expect(await errorCode(replay)).toBe("no_challenge");
    expect(pinEnvelope).toHaveBeenCalledTimes(1);
  });

  it("does not accept a signature over a mint challenge", async () => {
    const mint = issueChallenge(issuer.address);
    const pin = await challengeFor(issuer.address);
    const mintSignature = await issuer.signMessage({ message: mint.message });
    const response = await post({
      envelope: envelope(),
      address: issuer.address,
      signature: mintSignature,
    });
    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("bad_signature");
    expect(pinEnvelope).not.toHaveBeenCalled();
    // the pending pin challenge was not burned by the wrong signature
    const good = await issuer.signMessage({ message: pin.message });
    expect(
      (await post({ envelope: envelope(), address: issuer.address, signature: good })).status,
    ).toBe(200);
  });

  it("does not accept a pin signature at the mint route's challenge either (namespaces differ)", async () => {
    // a mint-only challenge exists; no pin challenge was issued
    const mint = issueChallenge(issuer.address);
    const signature = await issuer.signMessage({ message: mint.message });
    const response = await post({ envelope: envelope(), address: issuer.address, signature });
    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("no_challenge");
  });

  it("refuses a request without a prior challenge", async () => {
    const signature = await issuer.signMessage({ message: "IDPP pin challenge: 00" });
    const response = await post({ envelope: envelope(), address: issuer.address, signature });
    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("no_challenge");
  });

  it("refuses a signature by another key", async () => {
    const challenge = await challengeFor(issuer.address);
    const forged = await stranger.signMessage({ message: challenge.message });
    const response = await post({
      envelope: envelope(),
      address: issuer.address,
      signature: forged,
    });
    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("bad_signature");
  });

  it("answers token_not_found when no chain holds the token", async () => {
    chainState.tokens.clear();
    const response = await signedPost(issuer);
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe("token_not_found");
    expect(pinEnvelope).not.toHaveBeenCalled();
  });

  it("answers chain_unavailable, never token_not_found, when a chain read fails", async () => {
    chainState.tokens.clear();
    const [, other] = MANIFEST.chains;
    chainState.failing.add(other?.chainId ?? home.chainId);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await signedPost(issuer);
    spy.mockRestore();
    expect(response.status).toBe(502);
    expect(await errorCode(response)).toBe("chain_unavailable");
    expect(pinEnvelope).not.toHaveBeenCalled();
  });

  it("rejects bodies without envelope, address or signature", async () => {
    const signature = `0x${"11".repeat(65)}`;
    for (const body of [
      {},
      { envelope: envelope() },
      { envelope: envelope(), address: issuer.address },
      { address: issuer.address, signature },
      { envelope: envelope(), address: "nope", signature },
      { envelope: envelope(), address: issuer.address, signature: "nope" },
    ]) {
      const response = await post(body);
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe("invalid_request");
    }
    expect(pinEnvelope).not.toHaveBeenCalled();
  });

  it("rejects an envelope of another deployment and an invalid one", async () => {
    const signature = `0x${"11".repeat(65)}`;
    const wrong = await post({
      envelope: envelope({ deploymentId: "other" }),
      address: issuer.address,
      signature,
    });
    expect(wrong.status).toBe(400);
    expect(await errorCode(wrong)).toBe("wrong_deployment");
    const invalid = await post({
      envelope: envelope({ data: { nope: true } }),
      address: issuer.address,
      signature,
    });
    expect(invalid.status).toBe(400);
    expect(await errorCode(invalid)).toBe("invalid_envelope");
  });

  it("reports a CID mismatch as a structured 502, never as success", async () => {
    pinEnvelope.mockRejectedValue(new PinError("cid_mismatch", "Pinata returned X, predicted Y"));
    const response = await signedPost(issuer);
    expect(response.status).toBe(502);
    expect(await errorCode(response)).toBe("pin_cid_mismatch");
  });

  it("reports a read-back mismatch as a structured 502", async () => {
    pinEnvelope.mockRejectedValue(new PinError("readback_mismatch", "bytes differ"));
    const response = await signedPost(issuer);
    expect(response.status).toBe(502);
    expect(await errorCode(response)).toBe("pin_readback_mismatch");
  });

  it("maps a pin-level oversize envelope to 413", async () => {
    pinEnvelope.mockRejectedValueOnce(new PinError("payload_too_large", "big"));
    expect((await signedPost(issuer)).status).toBe(413);
  });

  it("answers 429 rate_limited per client address once the limit is spent", async () => {
    const fromIp = (ip: string) =>
      POST(
        new Request("http://localhost/api/pin", {
          method: "POST",
          headers: { "x-forwarded-for": `${ip}, 10.0.0.1` },
          body: JSON.stringify({}),
        }),
      );
    for (let i = 0; i < 20; i++) expect((await fromIp("203.0.113.7")).status).toBe(400);
    const limited = await fromIp("203.0.113.7");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await errorCode(limited)).toBe("rate_limited");
    // Another client is unaffected.
    expect((await fromIp("203.0.113.8")).status).toBe(400);
  });
});
