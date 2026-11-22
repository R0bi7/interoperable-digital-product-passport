import { MANIFEST, type PassportEnvelope } from "@idpp/passport-config";
import { describe, expect, it, vi } from "vitest";
import {
  authorizePin,
  type ChainTokenState,
  PinAuthError,
  type ReadTokenState,
} from "@/lib/operator/pin-auth";

const CID_0 = "bafkreibnugdjrt4xfyb4untqebjbktbq7lhbbxbiwtlgcefchoioao6dhm";
const CID_OTHER = "bafkreidgvpkjawlxz6sffxzwgooowe5yt7i6wsyg236mfoks77nywkptdq";
const HOLDER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const ISSUER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const STRANGER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as const;
const TOKEN = "97000000000003";

const [home, ...others] = MANIFEST.chains;
if (!home) throw new Error("manifest has no chains");
const HOME_CHAIN = home.chainId;

const envelope = (over: Partial<PassportEnvelope> = {}): PassportEnvelope =>
  ({
    schema: "idpp-passport/1",
    deploymentId: MANIFEST.deploymentId,
    tokenId: TOKEN,
    revision: "1",
    previousCid: CID_0,
    kind: "cask",
    granularity: "item",
    data: {},
    ...over,
  }) as PassportEnvelope;

const present = (over: Partial<ChainTokenState & { present: true }> = {}): ChainTokenState => ({
  chainId: home.chainId,
  present: true,
  owner: HOLDER,
  issuer: true,
  revision: 0n,
  cid: CID_0,
  ...over,
});

/** Reader whose token lives on `home`; every other chain answers `absent` (or what `elsewhere` says). */
function reader(
  atHome: ChainTokenState | Error,
  elsewhere: (chainId: number) => ChainTokenState | Error = (chainId) => ({
    chainId,
    present: false,
  }),
): ReadTokenState {
  return vi.fn(async (chainId) => {
    const answer = chainId === HOME_CHAIN ? atHome : elsewhere(chainId);
    if (answer instanceof Error) throw answer;
    return answer;
  });
}

const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PinAuthError) return error.code;
    throw error;
  }
  return "ok";
};

describe("authorizePin", () => {
  it("accepts an issuer with the next revision on the current cid", async () => {
    const read = reader(present());
    const state = await authorizePin(envelope(), ISSUER, read);
    expect(state.chainId).toBe(home.chainId);
    // Every chain of the deployment is asked, with the signer for isIssuer.
    expect(read).toHaveBeenCalledTimes(MANIFEST.chains.length);
    expect(read).toHaveBeenCalledWith(home.chainId, BigInt(TOKEN), ISSUER);
  });

  /** The token is on `home`; `isIssuer(signer)` is true only for `issuers` of the chain read. */
  const issuerReader =
    (issuers: Record<number, readonly string[]>): ReadTokenState =>
    async (chainId, _tokenId, signer) =>
      chainId === HOME_CHAIN
        ? present({ issuer: (issuers[chainId] ?? []).includes(signer) })
        : { chainId, present: false };

  it("refuses the holder and a stranger, admits the issuer", async () => {
    const read = issuerReader({ [HOME_CHAIN]: [ISSUER] });
    expect(await code(authorizePin(envelope(), HOLDER, read))).toBe("not_issuer");
    expect(await code(authorizePin(envelope(), STRANGER, read))).toBe("not_issuer");
    expect(await code(authorizePin(envelope(), ISSUER, read))).toBe("ok");
  });

  it("refuses an issuer of another chain than the one holding the token", async () => {
    const other = others[0];
    if (!other) return;
    const read = issuerReader({ [other.chainId]: [ISSUER] });
    expect(await code(authorizePin(envelope(), ISSUER, read))).toBe("not_issuer");
  });

  it("refuses an envelope whose revision is not on-chain revision + 1", async () => {
    const read = reader(present({ revision: 2n, cid: CID_OTHER }));
    // prepared against revision 0 while the chain is already at 2
    expect(await code(authorizePin(envelope({ previousCid: CID_OTHER }), ISSUER, read))).toBe(
      "stale_base",
    );
    expect(
      await code(authorizePin(envelope({ revision: "4", previousCid: CID_OTHER }), ISSUER, read)),
    ).toBe("stale_base");
    expect(
      await code(authorizePin(envelope({ revision: "3", previousCid: CID_OTHER }), ISSUER, read)),
    ).toBe("ok");
  });

  it("refuses a previousCid that is not the on-chain cid", async () => {
    const read = reader(present());
    expect(await code(authorizePin(envelope({ previousCid: CID_OTHER }), ISSUER, read))).toBe(
      "stale_base",
    );
    expect(await code(authorizePin(envelope({ previousCid: null }), ISSUER, read))).toBe(
      "stale_base",
    );
  });

  it("checks authorization before the base, so a stranger learns nothing about revisions", async () => {
    const read = reader(present({ revision: 5n, issuer: false }));
    expect(await code(authorizePin(envelope({ revision: "1" }), STRANGER, read))).toBe(
      "not_issuer",
    );
  });

  it("answers token_not_found when every chain answers absent", async () => {
    const read = reader({ chainId: home.chainId, present: false });
    expect(await code(authorizePin(envelope(), ISSUER, read))).toBe("token_not_found");
  });

  it("finds the token on a non-home chain", async () => {
    const other = others[0];
    if (!other) return;
    const read = reader({ chainId: home.chainId, present: false }, (chainId) =>
      chainId === other.chainId ? present({ chainId }) : { chainId, present: false },
    );
    const state = await authorizePin(envelope(), ISSUER, read);
    expect(state.chainId).toBe(other.chainId);
  });

  it("never reads a failed chain as absent: chain_unavailable", async () => {
    const read = reader({ chainId: home.chainId, present: false }, (chainId) =>
      chainId === others[0]?.chainId ? new Error("RPC down") : { chainId, present: false },
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await code(authorizePin(envelope(), ISSUER, read))).toBe("chain_unavailable");
    spy.mockRestore();
  });

  it("answers chain_unavailable when the chain holding the token fails", async () => {
    const read = reader(new Error("RPC down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await code(authorizePin(envelope(), ISSUER, read))).toBe("chain_unavailable");
    spy.mockRestore();
  });

  it("trusts a chain that holds the token even if another chain failed", async () => {
    const read = reader(present(), (chainId) => new Error(`RPC ${chainId} down`));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await code(authorizePin(envelope(), ISSUER, read))).toBe("ok");
    spy.mockRestore();
  });

  it("refuses a token that appears on two chains", async () => {
    const other = others[0];
    if (!other) return;
    const read = reader(present(), (chainId) => present({ chainId }));
    expect(await code(authorizePin(envelope(), ISSUER, read))).toBe("token_ambiguous");
  });
});
