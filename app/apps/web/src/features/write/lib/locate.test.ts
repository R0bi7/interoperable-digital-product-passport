import { MANIFEST, whiskyDistilleryAbi } from "@idpp/passport-config";
import {
  BaseError,
  ContractFunctionRevertedError,
  encodeErrorResult,
  type PublicClient,
} from "viem";
import { describe, expect, it, vi } from "vitest";
import { canRevise, isHolder, locatePassport } from "@/features/write/lib/locate";

const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const OTHER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const CID = "bafkreibnugdjrt4xfyb4untqebjbktbq7lhbbxbiwtlgcefchoioao6dhm";
const HISTORY_HASH = `0x${"12".repeat(32)}` as const;
const TOKEN = 97000000000006n;

function nonexistent() {
  const data = encodeErrorResult({
    abi: whiskyDistilleryAbi,
    errorName: "ERC721NonexistentToken",
    args: [TOKEN],
  });
  return new BaseError("reverted", {
    cause: new ContractFunctionRevertedError({
      abi: whiskyDistilleryAbi,
      data,
      functionName: "ownerOf",
    }),
  });
}

/** Holds the token; `issuers` answer `isIssuer` with true. */
function holdingClient(issuers: readonly string[] = []) {
  return {
    getBlockNumber: vi.fn(async () => 123n),
    readContract: vi.fn(
      async ({ functionName, args }: { functionName: string; args: readonly unknown[] }) => {
        if (functionName === "ownerOf") return OWNER;
        if (functionName === "passportOf")
          return { revision: 2n, cid: CID, historyHash: HISTORY_HASH };
        if (functionName === "isIssuer") {
          return issuers.some((a) => a.toLowerCase() === (args[0] as string).toLowerCase());
        }
        throw new Error(`unexpected ${functionName}`);
      },
    ),
  } as unknown as PublicClient;
}

const absentClient = () =>
  ({
    getBlockNumber: vi.fn(async () => 5n),
    readContract: vi.fn(async () => {
      throw nonexistent();
    }),
  }) as unknown as PublicClient;

const brokenClient = () =>
  ({
    getBlockNumber: vi.fn(async () => {
      throw new Error("rpc timeout");
    }),
    readContract: vi.fn(),
  }) as unknown as PublicClient;

const holderChain = MANIFEST.chains[0]?.chainId as number;

describe("locatePassport", () => {
  it("finds the single chain that holds the token and reads everything at one block", async () => {
    const holder = holdingClient();
    const location = await locatePassport(
      (chainId) => (chainId === holderChain ? holder : absentClient()),
      TOKEN,
    );
    expect(location.kind).toBe("held");
    if (location.kind !== "held") return;
    expect(location.record).toMatchObject({
      chainId: holderChain,
      blockNumber: 123n,
      owner: OWNER,
      revision: 2n,
      cid: CID,
      historyHash: HISTORY_HASH,
    });
    const blocks = vi
      .mocked(holder.readContract)
      .mock.calls.map(([args]) => (args as { blockNumber: bigint }).blockNumber);
    expect(new Set(blocks)).toEqual(new Set([123n]));
  });

  it("reports not_held when every chain answers that the token does not exist", async () => {
    expect((await locatePassport(() => absentClient(), TOKEN)).kind).toBe("not_held");
  });

  it("never treats a failed read as absent", async () => {
    const location = await locatePassport(
      (chainId) => (chainId === holderChain ? brokenClient() : absentClient()),
      TOKEN,
    );
    expect(location.kind).toBe("unknown");
  });

  it("flags a token present on two chains", async () => {
    const location = await locatePassport(() => holdingClient(), TOKEN);
    expect(location.kind).toBe("unknown");
  });
});

describe("authorization helpers", () => {
  const record = {
    chainId: holderChain,
    blockNumber: 1n,
    owner: OWNER,
    revision: 0n,
    cid: CID,
    historyHash: HISTORY_HASH,
  } as const;

  it("isHolder compares case-insensitively and rejects no account", () => {
    expect(isHolder(record, OWNER.toLowerCase() as `0x${string}`)).toBe(true);
    expect(isHolder(record, OTHER)).toBe(false);
    expect(isHolder(record, undefined)).toBe(false);
  });

  it("canRevise accepts an issuer and refuses the holder who is not one", async () => {
    expect(await canRevise(holdingClient([OTHER]), record, OTHER)).toBe(true);
    expect(await canRevise(holdingClient([OTHER]), record, OWNER)).toBe(false);
    expect(await canRevise(holdingClient([OWNER]), record, OWNER)).toBe(true);
    expect(await canRevise(holdingClient([OTHER]), record, undefined)).toBe(false);
  });

  it("canRevise reads isIssuer on the record's chain at the record's block", async () => {
    const client = holdingClient([OTHER]);
    await canRevise(client, record, OTHER);
    expect(vi.mocked(client.readContract).mock.calls[0]?.[0]).toMatchObject({
      address: MANIFEST.chains[0]?.address,
      functionName: "isIssuer",
      args: [OTHER],
      blockNumber: 1n,
    });
  });
});
