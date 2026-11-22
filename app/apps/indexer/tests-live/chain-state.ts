import { BaseError, ContractFunctionRevertedError } from "viem";

type Readers = {
  ownerOf: () => Promise<string>;
  passportOf: () => Promise<{ revision: bigint; cid: string }>;
};

/** A failed RPC is not evidence of absence. Only ownerOf's decoded, matching missing-token error is. */
export async function readPassportState(tokenId: bigint, readers: Readers) {
  let owner: string;
  try {
    owner = await readers.ownerOf();
  } catch (error) {
    const revert =
      error instanceof BaseError
        ? error.walk((cause) => cause instanceof ContractFunctionRevertedError)
        : undefined;
    if (
      revert instanceof ContractFunctionRevertedError &&
      revert.data?.errorName === "ERC721NonexistentToken" &&
      revert.data.args?.length === 1 &&
      revert.data.args[0] === tokenId
    ) {
      return { present: false as const };
    }
    throw error;
  }
  // A failure here contradicts the successful owner read; it must fail the check, never become absence.
  const passport = await readers.passportOf();
  return { present: true as const, owner, revision: passport.revision, cid: passport.cid };
}
