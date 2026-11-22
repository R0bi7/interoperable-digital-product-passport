import { whiskyDistilleryAbi } from "@idpp/passport-config";
import {
  BaseError,
  ContractFunctionRevertedError,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
} from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const publicClient = vi.hoisted(() => ({
  simulateContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  readContract: vi.fn(),
}));
const walletClient = vi.hoisted(() => ({ writeContract: vi.fn() }));

vi.mock("@/lib/operator/clients", () => ({
  UnsupportedChainError: class extends Error {},
  getPublicClient: () => publicClient,
  getOperatorWalletClient: () => walletClient,
  getOperatorAccount: () => ({ address: "0x0000000000000000000000000000000000000001" }),
  getDistilleryAddress: () => "0x000000000000000000000000000000000000dEaD",
}));

import { mint, readNextTokenId, UnexpectedTokenIdError } from "@/lib/operator";

const DISTILLERY = "0x000000000000000000000000000000000000dEaD";
const TO = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const CID = "bafkreibnugdjrt4xfyb4untqebjbktbq7lhbbxbiwtlgcefchoioao6dhm";
const TX = `0x${"ab".repeat(32)}`;

function issuedLog(tokenId: bigint, cid: string) {
  return {
    address: DISTILLERY,
    topics: encodeEventTopics({
      abi: whiskyDistilleryAbi,
      eventName: "PassportIssued",
      args: { tokenId },
    }),
    data: encodeAbiParameters([{ type: "string" }], [cid]),
  };
}

function unexpectedTokenIdError(expected: bigint, actual: bigint) {
  const data = encodeErrorResult({
    abi: whiskyDistilleryAbi,
    errorName: "UnexpectedTokenId",
    args: [expected, actual],
  });
  const reverted = new ContractFunctionRevertedError({
    abi: whiskyDistilleryAbi,
    data,
    functionName: "mint",
  });
  return new BaseError("simulation failed", { cause: reverted });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("operator mint", () => {
  it("simulates, sends with the operator wallet and returns the PassportIssued args", async () => {
    publicClient.simulateContract.mockResolvedValue({ request: { marker: "request" } });
    walletClient.writeContract.mockResolvedValue(TX);
    const receipt = { status: "success", logs: [issuedLog(421614000000000006n, CID)] };
    publicClient.waitForTransactionReceipt.mockResolvedValue(receipt);

    const result = await mint(421614, TO, 421614000000000006n, CID);
    expect(result.txHash).toBe(TX);
    expect(result.receipt).toBe(receipt);
    expect(result.issued).toEqual({ tokenId: 421614000000000006n, cid: CID });
    expect(publicClient.simulateContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "mint", args: [TO, 421614000000000006n, CID] }),
    );
    expect(walletClient.writeContract).toHaveBeenCalledWith({ marker: "request" });
  });

  it("decodes UnexpectedTokenId from the simulation and never sends a transaction", async () => {
    publicClient.simulateContract.mockRejectedValue(
      unexpectedTokenIdError(421614000000000006n, 421614000000000007n),
    );
    const failure = await mint(421614, TO, 421614000000000006n, CID).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(UnexpectedTokenIdError);
    expect(failure).toMatchObject({ expected: 421614000000000006n, actual: 421614000000000007n });
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  it("fails when the receipt reports a revert", async () => {
    publicClient.simulateContract.mockResolvedValue({ request: {} });
    walletClient.writeContract.mockResolvedValue(TX);
    publicClient.waitForTransactionReceipt.mockResolvedValue({ status: "reverted", logs: [] });
    await expect(mint(421614, TO, 1n, CID)).rejects.toThrow(/reverted on chain/);
  });

  it("fails when no PassportIssued event is present", async () => {
    publicClient.simulateContract.mockResolvedValue({ request: {} });
    walletClient.writeContract.mockResolvedValue(TX);
    publicClient.waitForTransactionReceipt.mockResolvedValue({ status: "success", logs: [] });
    await expect(mint(421614, TO, 1n, CID)).rejects.toThrow(/no PassportIssued/);
  });

  it("serializes concurrent mints on one chain", async () => {
    const order: string[] = [];
    publicClient.simulateContract.mockImplementation(async () => {
      order.push("simulate");
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { request: {} };
    });
    walletClient.writeContract.mockImplementation(async () => {
      order.push("write");
      return TX;
    });
    publicClient.waitForTransactionReceipt.mockImplementation(async () => {
      order.push("receipt");
      return { status: "success", logs: [issuedLog(1n, CID)] };
    });
    await Promise.all([mint(421614, TO, 1n, CID), mint(421614, TO, 1n, CID)]);
    expect(order).toEqual(["simulate", "write", "receipt", "simulate", "write", "receipt"]);
  });
});

describe("readNextTokenId", () => {
  it("reads nextTokenId() from the contract", async () => {
    publicClient.readContract.mockResolvedValue(421614000000000006n);
    expect(await readNextTokenId(421614)).toBe(421614000000000006n);
    expect(publicClient.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "nextTokenId", address: DISTILLERY }),
    );
  });
});
