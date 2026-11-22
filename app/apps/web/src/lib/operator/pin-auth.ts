import "server-only";
import { MANIFEST, type PassportEnvelope, whiskyDistilleryAbi } from "@idpp/passport-config";
import type { Address } from "viem";
import { isRevert } from "@/features/write/lib/revert";
import { getDistilleryAddress, getPublicClient } from "@/lib/operator/clients";

/** What one chain says about a token, as far as `POST /api/pin` needs it. */
export type ChainTokenState =
  | { chainId: number; present: false }
  | {
      chainId: number;
      present: true;
      owner: Address;
      /** `isIssuer(signer)` on this chain: the right to revise. */
      issuer: boolean;
      revision: bigint;
      cid: string;
    };

/** Reads the token on `chainId`. Rejects on any RPC failure; absence is a result, not an error. */
export type ReadTokenState = (
  chainId: number,
  tokenId: bigint,
  signer: Address,
) => Promise<ChainTokenState>;

export type PinAuthErrorCode =
  | "not_issuer"
  | "stale_base"
  | "token_not_found"
  | "token_ambiguous"
  | "chain_unavailable";

/** A refusal of `POST /api/pin` after the signature was verified. */
export class PinAuthError extends Error {
  constructor(
    readonly code: PinAuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PinAuthError";
  }
}

/** Default reader: `ownerOf`, then `isIssuer(signer)` and `passportOf`, over the server RPC. */
export const readTokenState: ReadTokenState = async (chainId, tokenId, signer) => {
  const client = getPublicClient(chainId);
  const address = getDistilleryAddress(chainId);
  let owner: Address;
  try {
    owner = await client.readContract({
      address,
      abi: whiskyDistilleryAbi,
      functionName: "ownerOf",
      args: [tokenId],
    });
  } catch (error) {
    if (isRevert(error, "ERC721NonexistentToken")) return { chainId, present: false };
    throw error;
  }
  const [issuer, passport] = await Promise.all([
    client.readContract({
      address,
      abi: whiskyDistilleryAbi,
      functionName: "isIssuer",
      args: [signer],
    }),
    client.readContract({
      address,
      abi: whiskyDistilleryAbi,
      functionName: "passportOf",
      args: [tokenId],
    }),
  ]);
  return {
    chainId,
    present: true,
    owner,
    issuer,
    revision: BigInt(passport.revision),
    cid: passport.cid,
  };
};

/**
 * Whether `signer` may pin the successor `envelope`: the token is held on exactly one chain of the
 * deployment, `signer` is an issuer on that chain (`isIssuer`, the only accounts that may call
 * `revise`; holding the token gives no right to write its passport), and the envelope
 * extends the on-chain passport (`revision = passportOf.revision + 1`, `previousCid =
 * passportOf.cid`).
 *
 * A failed read is never taken as "absent": it throws `PinAuthError("chain_unavailable")` unless
 * another chain answered that it holds the token. Chain reads use the server RPC URLs.
 */
export async function authorizePin(
  envelope: PassportEnvelope,
  signer: Address,
  read: ReadTokenState = readTokenState,
): Promise<ChainTokenState & { present: true }> {
  const tokenId = BigInt(envelope.tokenId);
  const settled = await Promise.allSettled(
    MANIFEST.chains.map((chain) => read(chain.chainId, tokenId, signer)),
  );
  const present: (ChainTokenState & { present: true })[] = [];
  let failed = false;
  for (const result of settled) {
    if (result.status === "rejected") {
      failed = true;
      console.error("pin auth: chain read failed", result.reason);
    } else if (result.value.present) {
      present.push(result.value);
    }
  }
  if (present.length > 1) {
    throw new PinAuthError(
      "token_ambiguous",
      `token ${tokenId} is present on ${present.length} chains at once`,
    );
  }
  const state = present[0];
  if (!state) {
    if (failed) {
      throw new PinAuthError(
        "chain_unavailable",
        "could not read every chain of the deployment; try again",
      );
    }
    throw new PinAuthError("token_not_found", `token ${tokenId} is not held on any chain`);
  }

  if (!state.issuer) {
    throw new PinAuthError(
      "not_issuer",
      `signer is not an issuer on chain ${state.chainId}, where the token is; only issuers revise`,
    );
  }
  const expectedRevision = state.revision + 1n;
  if (BigInt(envelope.revision) !== expectedRevision) {
    throw new PinAuthError(
      "stale_base",
      `envelope revision is ${envelope.revision}; the chain is at revision ${state.revision}, so the next is ${expectedRevision}`,
    );
  }
  if (envelope.previousCid !== state.cid) {
    throw new PinAuthError(
      "stale_base",
      `envelope previousCid is ${envelope.previousCid}; the chain holds ${state.cid}`,
    );
  }
  return state;
}
