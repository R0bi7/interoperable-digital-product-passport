import "server-only";
import { whiskyDistilleryAbi } from "@idpp/passport-config";
import { type Hash, parseEventLogs, type TransactionReceipt } from "viem";
import { decodeRevert } from "@/features/write/lib/revert";
import {
  getDistilleryAddress,
  getOperatorAccount,
  getOperatorWalletClient,
  getPublicClient,
} from "@/lib/operator/clients";

export { UnsupportedChainError } from "@/lib/operator/clients";

/** `UnexpectedTokenId(expected, actual)`: another mint advanced `nextTokenId()` first. */
export class UnexpectedTokenIdError extends Error {
  constructor(
    readonly expected: bigint,
    readonly actual: bigint,
  ) {
    super(`mint expected token id ${expected} but the contract is at ${actual}`);
    this.name = "UnexpectedTokenIdError";
  }
}

export class MintFailedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MintFailedError";
  }
}

export type IssuedEvent = { tokenId: bigint; cid: string };

export type MintResult = {
  txHash: Hash;
  receipt: TransactionReceipt;
  /** Arguments of the `PassportIssued` event in the receipt. */
  issued: IssuedEvent;
};

/** Current `nextTokenId()` of the contract on `chainId`. */
export async function readNextTokenId(chainId: number): Promise<bigint> {
  return getPublicClient(chainId).readContract({
    address: getDistilleryAddress(chainId),
    abi: whiskyDistilleryAbi,
    functionName: "nextTokenId",
  });
}

// One in-flight mint per chain and process: the operator account has a single nonce stream, and
// two concurrent mints would race on `nextTokenId()` anyway. Other instances are still covered by
// the contract's `UnexpectedTokenId` check.
const chainLocks = new Map<number, Promise<unknown>>();

async function withChainLock<T>(chainId: number, task: () => Promise<T>): Promise<T> {
  const previous = chainLocks.get(chainId) ?? Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.catch(() => undefined);
  chainLocks.set(chainId, tail);
  try {
    return await run;
  } finally {
    if (chainLocks.get(chainId) === tail) chainLocks.delete(chainId);
  }
}

/**
 * `mint(to, expectedTokenId, cid)` signed with the operator key. The call is simulated first so a
 * `UnexpectedTokenId` revert surfaces as `UnexpectedTokenIdError` (callers retry with a fresh id).
 */
export async function mint(
  chainId: number,
  to: `0x${string}`,
  expectedTokenId: bigint,
  cid: string,
): Promise<MintResult> {
  return withChainLock(chainId, async () => {
    const publicClient = getPublicClient(chainId);
    const wallet = getOperatorWalletClient(chainId);
    const address = getDistilleryAddress(chainId);

    let txHash: Hash;
    try {
      const { request } = await publicClient.simulateContract({
        account: getOperatorAccount(),
        address,
        abi: whiskyDistilleryAbi,
        functionName: "mint",
        args: [to, expectedTokenId, cid],
      });
      txHash = await wallet.writeContract(request);
    } catch (error) {
      const revert = decodeRevert(error);
      if (revert?.name === "UnexpectedTokenId") {
        throw new UnexpectedTokenIdError(
          BigInt(revert.args[0] as bigint),
          BigInt(revert.args[1] as bigint),
        );
      }
      throw new MintFailedError(
        revert ? `mint reverted: ${revert.name}` : "mint transaction failed",
        {
          cause: error,
        },
      );
    }

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new MintFailedError(`mint transaction ${txHash} reverted on chain`);
    }
    const [event] = parseEventLogs({
      abi: whiskyDistilleryAbi,
      eventName: "PassportIssued",
      logs: receipt.logs.filter((log) => log.address.toLowerCase() === address.toLowerCase()),
    });
    if (!event) throw new MintFailedError(`mint transaction ${txHash} emitted no PassportIssued`);
    return { txHash, receipt, issued: { tokenId: event.args.tokenId, cid: event.args.cid } };
  });
}
