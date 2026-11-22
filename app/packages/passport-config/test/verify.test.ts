import { describe, expect, it } from "vitest";
import {
  canonicalize,
  computeCidV1,
  type PassportEnvelope,
  passportEnvelopeSchema,
  verifyBinding,
  verifyContent,
  verifyHistory,
} from "../src/index";
import { VECTOR_CID, VECTOR_ENVELOPE } from "./vector";

const rev0 = passportEnvelopeSchema.parse(VECTOR_ENVELOPE);
const bytes0 = canonicalize(rev0);
const record = { deploymentId: "whisky-v2-final", tokenId: 97000000000000n, revision: 0n };

function next(previous: PassportEnvelope, previousCid: string): PassportEnvelope {
  return passportEnvelopeSchema.parse({
    ...previous,
    revision: String(BigInt(previous.revision) + 1n),
    previousCid,
    data: { ...previous.data, description: `revision ${BigInt(previous.revision) + 1n}` },
  });
}

describe("verifyContent", () => {
  it("accepts the vector bytes", () => {
    expect(verifyContent(bytes0, VECTOR_CID)).toEqual({ ok: true });
  });

  it("rejects altered bytes", () => {
    const altered = bytes0.slice();
    altered[10] = (altered[10] as number) ^ 1;
    const result = verifyContent(altered, VECTOR_CID);
    expect(result.ok).toBe(false);
  });

  it("never throws on bad input", () => {
    expect(verifyContent(bytes0, "garbage").ok).toBe(false);
    expect(verifyContent(undefined as unknown as Uint8Array, VECTOR_CID).ok).toBe(false);
    expect(verifyContent(bytes0, 42 as unknown as string).ok).toBe(false);
  });
});

describe("verifyBinding", () => {
  it("accepts the matching record", () => {
    expect(verifyBinding(rev0, record)).toEqual({ ok: true });
    expect(verifyBinding(rev0, { ...record, tokenId: "97000000000000", revision: "0" })).toEqual({
      ok: true,
    });
  });

  it("rejects a valid CID whose envelope carries another tokenId", () => {
    const other = passportEnvelopeSchema.parse({ ...VECTOR_ENVELOPE, tokenId: "97000000000001" });
    const otherCid = computeCidV1(canonicalize(other));
    // The content is genuine for its CID, but the CID was read from token ...000.
    expect(verifyContent(canonicalize(other), otherCid)).toEqual({ ok: true });
    const result = verifyBinding(other, record);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/tokenId/);
  });

  it("rejects another deployment or revision", () => {
    expect(verifyBinding(rev0, { ...record, deploymentId: "whisky-v2-provisional" }).ok).toBe(
      false,
    );
    expect(verifyBinding(rev0, { ...record, revision: 1n }).ok).toBe(false);
  });

  it("never throws on bad input", () => {
    expect(verifyBinding(null, record).ok).toBe(false);
    expect(verifyBinding({ ...VECTOR_ENVELOPE, tokenId: 1 }, record).ok).toBe(false);
    expect(verifyBinding(rev0, undefined as unknown as typeof record).ok).toBe(false);
  });
});

describe("verifyHistory", () => {
  const cid0 = computeCidV1(bytes0);
  const rev1 = next(rev0, cid0);
  const cid1 = computeCidV1(canonicalize(rev1));
  const rev2 = next(rev1, cid1);
  const cid2 = computeCidV1(canonicalize(rev2));
  const indexed = [
    { revision: "0", cid: cid0 },
    { revision: "1", cid: cid1 },
    { revision: 2n, cid: cid2 },
  ];

  it("accepts an unbroken chain back to revision 0", () => {
    expect(verifyHistory([rev0, rev1, rev2], indexed)).toEqual({ ok: true });
  });

  it("rejects a broken previousCid", () => {
    const broken = { ...rev2, previousCid: cid0 };
    const result = verifyHistory([rev0, rev1, broken], indexed);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/previousCid/);
    // Revisions 0 and 1 verified, revision 2 failed.
    expect(!result.ok && result.index).toBe(2);
    expect(verifyHistory([rev0, rev1], indexed.slice(0, 2))).toEqual({ ok: true });
  });

  it("rejects gaps, mismatched lengths and foreign tokens", () => {
    expect(verifyHistory([rev0, rev2], [indexed[0], indexed[2]] as typeof indexed).ok).toBe(false);
    expect(verifyHistory([rev0, rev1], indexed).ok).toBe(false);
    expect(verifyHistory([], []).ok).toBe(false);
    expect(verifyHistory([rev0, rev1], indexed)).not.toHaveProperty("index");
    const foreign = { ...rev1, tokenId: "97000000000001" };
    expect(verifyHistory([rev0, foreign], indexed.slice(0, 2)).ok).toBe(false);
  });

  it("never throws on bad input", () => {
    expect(verifyHistory(null as unknown as unknown[], indexed).ok).toBe(false);
    expect(verifyHistory([rev0], [null as unknown as (typeof indexed)[0]]).ok).toBe(false);
  });
});
