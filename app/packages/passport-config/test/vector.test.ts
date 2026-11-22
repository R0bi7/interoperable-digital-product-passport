import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalize,
  computeCidV1,
  isProfileCid,
  MAX_PAYLOAD_BYTES,
  PayloadTooLargeError,
  parseCid,
  passportEnvelopeSchema,
} from "../src/index";
import { VECTOR_CANONICAL, VECTOR_CID, VECTOR_ENVELOPE, VECTOR_SHA256 } from "./vector";

describe("shared test vector", () => {
  const envelope = passportEnvelopeSchema.parse(VECTOR_ENVELOPE);
  const bytes = canonicalize(envelope);

  it("canonicalizes to the exact 312 bytes", () => {
    expect(bytes.byteLength).toBe(312);
    expect(new TextDecoder().decode(bytes)).toBe(VECTOR_CANONICAL);
  });

  it("hashes to the exact sha2-256 digest", () => {
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(VECTOR_SHA256);
  });

  it("computes the exact CID", () => {
    expect(computeCidV1(bytes)).toBe(VECTOR_CID);
    const cid = parseCid(VECTOR_CID);
    expect(cid.version).toBe(1);
    expect(cid.code).toBe(0x55);
    expect(cid.multihash.code).toBe(0x12);
    expect(Buffer.from(cid.multihash.digest).toString("hex")).toBe(VECTOR_SHA256);
    expect(isProfileCid(VECTOR_CID)).toBe(true);
  });

  it("does not depend on key order", () => {
    const reordered = JSON.parse(JSON.stringify({ ...VECTOR_ENVELOPE }));
    const shuffled = Object.fromEntries(Object.entries(reordered).reverse());
    expect(computeCidV1(canonicalize(passportEnvelopeSchema.parse(shuffled)))).toBe(VECTOR_CID);
  });
});

describe("CID profile", () => {
  it("rejects other CID shapes", () => {
    expect(isProfileCid("QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG")).toBe(false);
    expect(isProfileCid("bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi")).toBe(false);
    expect(isProfileCid("not-a-cid")).toBe(false);
  });
});

describe("canonicalize size limit", () => {
  it("throws PayloadTooLargeError above MAX_PAYLOAD_BYTES", () => {
    const big = {
      ...VECTOR_ENVELOPE,
      data: { ...VECTOR_ENVELOPE.data, description: "x".repeat(MAX_PAYLOAD_BYTES) },
    };
    expect(() => canonicalize(big)).toThrow(PayloadTooLargeError);
  });
});
