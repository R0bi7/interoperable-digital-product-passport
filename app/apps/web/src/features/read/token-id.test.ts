import { describe, expect, it } from "vitest";
import {
  extractPassportRef,
  extractTokenId,
  parseTokenId,
  passportPath,
  passportUrl,
} from "./token-id";

describe("token ids above 2^53", () => {
  const big = "11155111000000000001"; // Sepolia-origin id; not representable as a Number
  it("parses without losing precision", () => {
    expect(Number(big).toString()).not.toBe(big);
    expect(parseTokenId(big)).toBe(11155111000000000001n);
    expect(parseTokenId(big)?.toString()).toBe(big);
    expect(passportPath(parseTokenId(big) as bigint)).toBe(`/passport/${big}`);
  });

  it("accepts a plain id, a path and URLs", () => {
    expect(extractTokenId(big)).toBe(11155111000000000001n);
    expect(extractTokenId(`  ${big}\n`)).toBe(11155111000000000001n);
    expect(extractTokenId(`/passport/${big}`)).toBe(11155111000000000001n);
    expect(extractTokenId(`https://idpp.example/passport/${big}`)).toBe(11155111000000000001n);
    expect(extractTokenId(`https://idpp.example/passport/${big}/?utm=1#x`)).toBe(
      11155111000000000001n,
    );
    expect(extractTokenId("97000000000001")).toBe(97000000000001n);
    expect(extractTokenId("0")).toBe(0n);
  });

  it("rejects anything that is not a canonical decimal id", () => {
    for (const bad of [
      "",
      "abc",
      "-1",
      "+1",
      "1.5",
      "1e16",
      "0x10",
      "0123",
      "https://idpp.example/other/123",
      "https://idpp.example/passport/abc",
      "/passport/",
      `${"9".repeat(80)}`,
    ]) {
      expect(extractTokenId(bad), bad).toBeNull();
    }
  });

  it("accepts up to uint256 max and rejects one more", () => {
    const max = (2n ** 256n - 1n).toString();
    expect(parseTokenId(max)).toBe(2n ** 256n - 1n);
    expect(parseTokenId((2n ** 256n).toString())).toBeNull();
  });
});

describe("passportUrl", () => {
  it("round-trips through extractTokenId without losing precision", () => {
    const id = 11155111000000000001n;
    expect(extractTokenId(passportUrl("https://idpp.example/", id))).toBe(id);
    expect(passportUrl("http://localhost:3000", id.toString())).toBe(
      "http://localhost:3000/passport/11155111000000000001",
    );
  });
});

describe("deployment label references", () => {
  it("preserves the generation through the QR, scan and passport path", () => {
    const tokenId = 11155111000000000001n;
    const deploymentId = "whisky-v2-eval3";
    const url = passportUrl("https://idpp.example/", tokenId, deploymentId);
    expect(url).toBe(`https://idpp.example/passport/${tokenId}?deployment=${deploymentId}`);
    expect(extractPassportRef(url)).toEqual({ tokenId, deploymentId });
    expect(extractPassportRef(passportPath(tokenId, deploymentId))).toEqual({
      tokenId,
      deploymentId,
    });
    expect(extractTokenId(url)).toBe(tokenId);
    expect(extractPassportRef(tokenId.toString())).toEqual({ tokenId });
    expect(extractPassportRef(`/passport/${tokenId}`)).toEqual({ tokenId });
    expect(extractPassportRef(passportPath(tokenId, "other generation/1"))).toEqual({
      tokenId,
      deploymentId: "other generation/1",
    });
  });
});

it("normalizes empty origin query/fragment delimiters before building labels", () => {
  for (const base of ["https://idpp.example?", "https://idpp.example/#"]) {
    expect(passportUrl(base, 123n, "eval3")).toBe(
      "https://idpp.example/passport/123?deployment=eval3",
    );
  }
});
