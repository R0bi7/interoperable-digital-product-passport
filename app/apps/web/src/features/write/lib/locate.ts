import { MANIFEST, whiskyDistilleryAbi } from "@idpp/passport-config";
import type { Address, PublicClient } from "viem";
import { isRevert } from "@/features/write/lib/revert";

export type PassportRecord = {
  chainId: number;
  /** Block at which owner and passport were both read. */
  blockNumber: bigint;
  owner: Address;
  revision: bigint;
  cid: string;
  historyHash: `0x${string}`;
};

export type ChainProbe =
  | { chainId: number; status: "present"; record: PassportRecord }
  | { chainId: number; status: "absent" }
  | { chainId: number; status: "error"; message: string };

export type Location =
  | { kind: "held"; record: PassportRecord; probes: ChainProbe[] }
  | { kind: "not_held"; probes: ChainProbe[] }
  | { kind: "unknown"; reason: string; probes: ChainProbe[] };

async function probeChain(
  client: PublicClient,
  chainId: number,
  address: Address,
  tokenId: bigint,
): Promise<ChainProbe> {
  try {
    // One block for every read, so owner and passport describe the same state.
    const blockNumber = await client.getBlockNumber();
    const read = <N extends "ownerOf" | "passportOf">(functionName: N, args: readonly [bigint]) =>
      client.readContract({
        address,
        abi: whiskyDistilleryAbi,
        functionName,
        args,
        blockNumber,
      } as never) as Promise<unknown>;

    let owner: Address;
    try {
      owner = (await read("ownerOf", [tokenId])) as Address;
    } catch (error) {
      if (isRevert(error, "ERC721NonexistentToken")) return { chainId, status: "absent" };
      throw error;
    }
    const passport = (await read("passportOf", [tokenId])) as {
      revision: bigint;
      cid: string;
      historyHash: `0x${string}`;
    };
    return {
      chainId,
      status: "present",
      record: {
        chainId,
        blockNumber,
        owner,
        revision: BigInt(passport.revision),
        cid: passport.cid,
        historyHash: passport.historyHash,
      },
    };
  } catch (error) {
    return {
      chainId,
      status: "error",
      message: (error as Error).message.split("\n")[0] ?? "read failed",
    };
  }
}

/**
 * Finds the chain that currently holds `tokenId` by asking every chain of the deployment.
 * A read error on any chain is reported, never treated as "absent": a failed read must not let
 * the UI conclude that the token is in flight or missing.
 */
export async function locatePassport(
  getClient: (chainId: number) => PublicClient,
  tokenId: bigint,
): Promise<Location> {
  const probes = await Promise.all(
    MANIFEST.chains.map((chain) =>
      probeChain(getClient(chain.chainId), chain.chainId, chain.address, tokenId),
    ),
  );
  const present = probes.filter((p) => p.status === "present");
  if (present.length > 1) {
    return {
      kind: "unknown",
      reason: `token ${tokenId} is present on ${present.length} chains at once`,
      probes,
    };
  }
  const only = present[0];
  if (only?.status === "present") return { kind: "held", record: only.record, probes };
  const failed = probes.filter((p) => p.status === "error");
  if (failed.length > 0) {
    return {
      kind: "unknown",
      reason: `could not read chain ${failed.map((p) => p.chainId).join(", ")}; the token may be there`,
      probes,
    };
  }
  return { kind: "not_held", probes };
}

/** The current holder: the only account that may `send`. */
export function isHolder(record: PassportRecord, account: Address | undefined): boolean {
  return account !== undefined && record.owner.toLowerCase() === account.toLowerCase();
}

/**
 * An issuer on the chain that holds the token (`isIssuer`, read at the record's block): the only
 * accounts that may `revise`. Holding the token gives no right to write its passport.
 */
export async function canRevise(
  client: PublicClient,
  record: PassportRecord,
  account: Address | undefined,
): Promise<boolean> {
  if (account === undefined) return false;
  const address = MANIFEST.chains.find((chain) => chain.chainId === record.chainId)?.address;
  if (!address) return false;
  return client.readContract({
    address,
    abi: whiskyDistilleryAbi,
    functionName: "isIssuer",
    args: [account],
    blockNumber: record.blockNumber,
  });
}
