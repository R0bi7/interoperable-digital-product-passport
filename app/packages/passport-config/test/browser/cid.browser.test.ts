import { sha256 } from "multiformats/hashes/sha2";
import { describe, expect, it } from "vitest";
import {
  canonicalize,
  computeCidV1,
  parseCid,
  passportEnvelopeSchema,
  verifyContent,
} from "../../src/index";
import { VECTOR_CID, VECTOR_ENVELOPE, VECTOR_SHA256 } from "../vector";

// Runs under the `browser` export condition (see vitest.config.ts). Regression test: there the
// multiformats sha256 resolves to an async WebCrypto hasher, which made the previous
// `computeCidV1` throw "sha256 digest must be synchronous" in every browser.
describe("CID hashing under browser export conditions", () => {
  const bytes = canonicalize(passportEnvelopeSchema.parse(VECTOR_ENVELOPE));

  it("resolves the browser (async) multiformats hasher, so this suite is meaningful", () => {
    expect(sha256.digest(bytes)).toBeInstanceOf(Promise);
  });

  it("computeCidV1 stays synchronous and returns the shared-vector CID", () => {
    expect(bytes.byteLength).toBe(312);
    const cid = computeCidV1(bytes);
    expect(typeof cid).toBe("string");
    expect(cid).toBe(VECTOR_CID);
    expect(Buffer.from(parseCid(cid).multihash.digest).toString("hex")).toBe(VECTOR_SHA256);
  });

  it("verifyContent stays synchronous and verifies the shared vector", () => {
    expect(verifyContent(bytes, VECTOR_CID).ok).toBe(true);
    expect(verifyContent(new Uint8Array([1, 2, 3]), VECTOR_CID).ok).toBe(false);
  });
});
