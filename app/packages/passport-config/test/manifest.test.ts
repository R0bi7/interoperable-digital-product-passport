import type { Abi } from "viem";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  getChain,
  getChainByEid,
  ID_SPACE,
  MANIFEST,
  originOf,
  whiskyDistilleryAbi,
} from "../src/index";

describe("manifest", () => {
  it("lists the three evaluation chains with their endpoint ids", () => {
    expect(MANIFEST.chains.map((c) => [c.chainId, c.eid])).toEqual([
      [421614, 40231],
      [84532, 40245],
      [11155111, 40161],
    ]);
    for (const chain of MANIFEST.chains) {
      expect(chain.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(chain.deploymentBlock).toBeGreaterThan(0);
    }
  });

  it("looks chains up by chain id and eid", () => {
    expect(getChain(84532)?.network).toBe("base-sepolia");
    expect(getChainByEid(40161)?.chainId).toBe(11155111);
    expect(getChain(1)).toBeUndefined();
    expect(getChainByEid(1)).toBeUndefined();
  });

  it("derives the issuing chain from the token id", () => {
    expect(originOf(421_614_000_000_000_006n)).toBe(421614n);
    expect(originOf(11_155_111n * ID_SPACE + 5n)).toBe(11_155_111n);
  });

  it("exposes the post-WP-C mint and revise signatures and errors", () => {
    expectTypeOf(whiskyDistilleryAbi).toExtend<Abi>();
    const signature = (name: string) =>
      whiskyDistilleryAbi
        .filter((e) => e.type === "function" && e.name === name)
        .map((e) => ("inputs" in e ? e.inputs.map((i) => i.type).join(",") : ""));
    expect(signature("mint")).toContain("address,uint256,string");
    expect(signature("revise")).toContain("uint256,uint64,string");
    const errors = whiskyDistilleryAbi.filter((e) => e.type === "error").map((e) => e.name);
    expect(errors).toEqual(expect.arrayContaining(["UnexpectedTokenId", "StaleRevision"]));
  });
});
