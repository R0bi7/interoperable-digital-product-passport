import { MANIFEST } from "@idpp/passport-config";
import { describe, expect, it, vi } from "vitest";
import { UnexpectedTokenIdError } from "@/lib/operator";
import {
  buildIssueEnvelope,
  type EnvelopeData,
  type IssueDeps,
  issuePassport,
  validateEnvelopeData,
} from "@/lib/operator/issue";

import { SourceCaskError } from "@/lib/operator/source-casks";

const CID_A = "bafkreibnugdjrt4xfyb4untqebjbktbq7lhbbxbiwtlgcefchoioao6dhm";
const CID_B = "bafkreidgvpkjawlxz6sffxzwgooowe5yt7i6wsyg236mfoks77nywkptdq";
const TX = `0x${"ab".repeat(32)}` as const;
const TO = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;

const envelopeData: EnvelopeData = {
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

function deps(overrides: Partial<IssueDeps> = {}) {
  const pin = vi.fn(async (envelope: unknown) => ({
    cid: (envelope as { tokenId: string }).tokenId === "421614000000000007" ? CID_B : CID_A,
    bytes: new Uint8Array(),
  }));
  const readNextTokenId = vi.fn(async () => 421614000000000006n);
  const mint = vi.fn(async (_chain: number, _to: `0x${string}`, id: bigint, cid: string) => ({
    txHash: TX,
    receipt: {} as never,
    issued: { tokenId: id, cid },
  }));
  return {
    readNextTokenId,
    pin,
    mint,
    validateSourceCasks: vi.fn(async () => {}),
    ...overrides,
  } as IssueDeps & {
    readNextTokenId: typeof readNextTokenId;
    pin: typeof pin;
    mint: typeof mint;
  };
}

describe("buildIssueEnvelope", () => {
  it("builds revision 0 with decimal-string token id and null previousCid", () => {
    expect(buildIssueEnvelope(envelopeData, 421614000000000006n)).toMatchObject({
      schema: "idpp-passport/1",
      deploymentId: MANIFEST.deploymentId,
      tokenId: "421614000000000006",
      revision: "0",
      previousCid: null,
      kind: "cask",
      granularity: "item",
    });
  });
});

describe("validateEnvelopeData", () => {
  it("accepts a valid cask and rejects unknown or missing fields", () => {
    expect(validateEnvelopeData(envelopeData)).toEqual({ ok: true });
    const missing = { ...envelopeData, data: { distillery: "x" } };
    expect(validateEnvelopeData(missing)).toMatchObject({ ok: false });
    const extra = { ...envelopeData, data: { ...envelopeData.data, chainId: "421614" } };
    expect(validateEnvelopeData(extra)).toMatchObject({ ok: false });
  });
});

describe("issuePassport", () => {
  const sourceCasks = [{ tokenId: "12", revision: "0", volumeMl: "700" }];
  const bottle: EnvelopeData = {
    kind: "bottle",
    granularity: "item",
    data: {
      brand: "Demo",
      bottleType: "Glass",
      bottledDate: "2026-10-20",
      volumeMl: "700",
      alcoholByVolume: "40",
      sourceCasks,
    },
  };

  it("refuses an invalid source cask before pinning or minting", async () => {
    const validateSourceCasks = vi.fn(async () => {
      throw new SourceCaskError("source_cask_missing", "source cask 12: not held on any chain");
    });
    const d = deps({ validateSourceCasks });
    await expect(
      issuePassport({ chainId: 421614, to: TO, envelopeData: bottle }, d),
    ).rejects.toMatchObject({ code: "source_cask_missing" });
    expect(validateSourceCasks).toHaveBeenCalledWith(sourceCasks);
    expect(d.readNextTokenId).not.toHaveBeenCalled();
    expect(d.pin).not.toHaveBeenCalled();
    expect(d.mint).not.toHaveBeenCalled();
  });

  it("validates bottle sources once before pinning, including when the mint is retried", async () => {
    const validateSourceCasks = vi.fn(async () => {});
    const d = deps({ validateSourceCasks });
    d.mint.mockRejectedValueOnce(new UnexpectedTokenIdError(1n, 2n));
    await issuePassport({ chainId: 421614, to: TO, envelopeData: bottle }, d);
    expect(validateSourceCasks).toHaveBeenCalledTimes(1);
    expect(validateSourceCasks.mock.invocationCallOrder[0]).toBeLessThan(
      d.pin.mock.invocationCallOrder[0] as number,
    );
  });

  it("pins the envelope for nextTokenId, mints with the expected id and returns the result", async () => {
    const d = deps();
    const result = await issuePassport({ chainId: 421614, to: TO, envelopeData }, d);
    expect(result).toEqual({ tokenId: "421614000000000006", cid: CID_A, txHash: TX });
    expect(d.mint).toHaveBeenCalledWith(421614, TO, 421614000000000006n, CID_A);
    expect(d.pin).toHaveBeenCalledWith(expect.objectContaining({ tokenId: "421614000000000006" }));
  });

  it("retries once with a fresh nextTokenId and a re-pinned envelope on UnexpectedTokenId", async () => {
    const d = deps();
    d.readNextTokenId
      .mockResolvedValueOnce(421614000000000006n)
      .mockResolvedValueOnce(421614000000000007n);
    d.mint.mockRejectedValueOnce(
      new UnexpectedTokenIdError(421614000000000006n, 421614000000000007n),
    );
    const result = await issuePassport({ chainId: 421614, to: TO, envelopeData }, d);
    expect(result).toEqual({ tokenId: "421614000000000007", cid: CID_B, txHash: TX });
    expect(d.pin).toHaveBeenCalledTimes(2);
    expect(d.mint).toHaveBeenCalledTimes(2);
    expect(d.mint).toHaveBeenLastCalledWith(421614, TO, 421614000000000007n, CID_B);
  });

  it("gives up after the second UnexpectedTokenId", async () => {
    const d = deps();
    d.mint.mockRejectedValue(new UnexpectedTokenIdError(1n, 2n));
    await expect(
      issuePassport({ chainId: 421614, to: TO, envelopeData }, d),
    ).rejects.toBeInstanceOf(UnexpectedTokenIdError);
    expect(d.mint).toHaveBeenCalledTimes(2);
  });

  it("does not retry other failures", async () => {
    const d = deps();
    d.mint.mockRejectedValue(new Error("rpc down"));
    await expect(issuePassport({ chainId: 421614, to: TO, envelopeData }, d)).rejects.toThrow(
      "rpc down",
    );
    expect(d.mint).toHaveBeenCalledTimes(1);
  });

  it("does not mint when pinning fails", async () => {
    const d = deps();
    d.pin.mockRejectedValue(new Error("cid mismatch"));
    await expect(issuePassport({ chainId: 421614, to: TO, envelopeData }, d)).rejects.toThrow();
    expect(d.mint).not.toHaveBeenCalled();
  });

  it("fails when the emitted event disagrees with the request", async () => {
    const d = deps();
    d.mint.mockResolvedValue({
      txHash: TX,
      receipt: {} as never,
      issued: { tokenId: 1n, cid: CID_A },
    });
    await expect(issuePassport({ chainId: 421614, to: TO, envelopeData }, d)).rejects.toThrow(
      /differs/,
    );
  });
});
