import { BaseError, ContractFunctionRevertedError } from "viem";

export type DecodedRevert = {
  /** Custom error or revert name from the contract ABI, e.g. `StaleRevision`. */
  name: string;
  args: readonly unknown[];
};

/**
 * Walks a viem error to the contract revert it wraps and returns the decoded custom error.
 * `undefined` for anything else (RPC failure, user rejection, unknown revert), which callers
 * must not treat as a contract-level answer.
 */
export function decodeRevert(error: unknown): DecodedRevert | undefined {
  if (!(error instanceof BaseError)) return undefined;
  const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
  if (!(reverted instanceof ContractFunctionRevertedError)) return undefined;
  const name = reverted.data?.errorName;
  if (name === undefined) return undefined;
  return { name, args: reverted.data?.args ?? [] };
}

export function isRevert(error: unknown, name: string): boolean {
  return decodeRevert(error)?.name === name;
}
