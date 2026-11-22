import { whiskyDistilleryAbi } from "@idpp/passport-config";
import { BaseError, ContractFunctionRevertedError, encodeErrorResult } from "viem";
import { describe, expect, it, vi } from "vitest";
import { readPassportState } from "../tests-live/chain-state";

const id = 421614000000000000n;
const missing = (tokenId = id) =>
  new BaseError("execution failed", {
    cause: new ContractFunctionRevertedError({
      abi: whiskyDistilleryAbi,
      functionName: "ownerOf",
      data: encodeErrorResult({
        abi: whiskyDistilleryAbi,
        errorName: "ERC721NonexistentToken",
        args: [tokenId],
      }),
    }),
  });

describe("live chain-state checks", () => {
  it("accepts only a decoded missing-token owner read and does not read the passport", async () => {
    const passportOf = vi.fn();
    await expect(
      readPassportState(id, {
        ownerOf: async () => {
          throw missing();
        },
        passportOf,
      }),
    ).resolves.toEqual({ present: false });
    expect(passportOf).not.toHaveBeenCalled();
  });
  it.each([
    new Error("RPC timeout"),
    new Error("ERC721NonexistentToken is mentioned by an untrusted RPC message"),
    missing(id + 1n),
    new ContractFunctionRevertedError({
      abi: whiskyDistilleryAbi,
      functionName: "ownerOf",
      data: "0xdeadbeef",
    }),
    new ContractFunctionRevertedError({
      abi: whiskyDistilleryAbi,
      functionName: "ownerOf",
      data: encodeErrorResult({
        abi: whiskyDistilleryAbi,
        errorName: "NotIssuer",
        args: ["0x1111111111111111111111111111111111111111"],
      }),
    }),
  ])("propagates other owner-read failures instead of proving absence (%#)", async (error) => {
    const passportOf = vi.fn();
    await expect(
      readPassportState(id, {
        ownerOf: async () => {
          throw error;
        },
        passportOf,
      }),
    ).rejects.toBe(error);
    expect(passportOf).not.toHaveBeenCalled();
  });
  it.each([new Error("passport RPC timeout"), missing()])(
    "propagates a passport failure after ownerOf succeeded (%#)",
    async (error) => {
      await expect(
        readPassportState(id, {
          ownerOf: async () => "0xowner",
          passportOf: async () => {
            throw error;
          },
        }),
      ).rejects.toBe(error);
    },
  );
  it("keeps the owner, revision and CID from successful reads", async () => {
    await expect(
      readPassportState(id, {
        ownerOf: async () => "0xowner",
        passportOf: async () => ({ revision: 2n, cid: "cid" }),
      }),
    ).resolves.toEqual({ present: true, owner: "0xowner", revision: 2n, cid: "cid" });
  });
});
