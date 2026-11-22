import { describe, expect, it } from "vitest";
import { DEFAULT_LIMIT, MAX_LIMIT, parseListQuery, parseTokenId } from "../src/api/params";

describe("parseTokenId", () => {
  it("keeps ids beyond 2^53 exact", () => {
    expect(parseTokenId("11155111000000000001")).toEqual({
      ok: true,
      value: 11_155_111_000_000_000_001n,
    });
  });

  it.each(["", "abc", "-1", "1.5", "0x10", "007", " 1"])("rejects %j", (raw) => {
    expect(parseTokenId(raw).ok).toBe(false);
  });
});

describe("parseListQuery", () => {
  it("defaults", () => {
    expect(parseListQuery({})).toEqual({
      ok: true,
      value: { chainId: undefined, status: undefined, limit: DEFAULT_LIMIT, cursor: undefined },
    });
  });

  it("parses every filter", () => {
    expect(
      parseListQuery({
        chainId: "84532",
        status: "held",
        limit: "5",
        cursor: "421614000000000006",
      }),
    ).toEqual({
      ok: true,
      value: { chainId: 84532, status: "held", limit: 5, cursor: 421_614_000_000_000_006n },
    });
  });

  it("caps the limit", () => {
    const parsed = parseListQuery({ limit: "100000" });
    expect(parsed.ok && parsed.value.limit).toBe(MAX_LIMIT);
  });

  it.each([
    { chainId: "x" },
    { status: "lost" },
    { limit: "0" },
    { limit: "-3" },
    { cursor: "1e3" },
  ])("rejects %j", (query) => {
    expect(parseListQuery(query).ok).toBe(false);
  });
});
