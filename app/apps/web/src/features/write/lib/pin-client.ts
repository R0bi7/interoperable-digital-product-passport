import { ApiClientError, getJson, postJson } from "@/features/write/lib/api";

export type PinChallenge = { nonce: string; message: string };

/** Thrown when the wallet user declines the signature request; nothing was sent to `/api/pin`. */
export class SignatureRejectedError extends Error {
  constructor() {
    super("The signature request was rejected in the wallet, so nothing was pinned.");
    this.name = "SignatureRejectedError";
  }
}

/** EIP-1193 `4001` / viem `UserRejectedRequestError`, anywhere in the cause chain. */
export function isUserRejection(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current; depth++) {
    const candidate = current as { code?: unknown; name?: unknown; cause?: unknown };
    if (candidate.code === 4001 || candidate.name === "UserRejectedRequestError") return true;
    current = candidate.cause;
  }
  return false;
}

/** The server no longer accepts this signature (challenge expired, replaced, or the server restarted): 401 `no_challenge` or `bad_signature`. */
export function isChallengeLost(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    error.status === 401 &&
    (error.code === "no_challenge" || error.code === "bad_signature")
  );
}

/**
 * `POST /api/pin` as the revise page calls it: fetch the pin challenge for `address`, have the
 * wallet sign its message, then post `{ envelope, address, signature }`. A declined signature
 * becomes `SignatureRejectedError`; server refusals stay `ApiClientError` with their code.
 */
export async function pinWithSignature(
  envelope: unknown,
  address: `0x${string}`,
  signMessage: (message: string) => Promise<`0x${string}`>,
): Promise<{ cid: string }> {
  const challenge = await getJson<PinChallenge>(
    `/api/pin/challenge?address=${encodeURIComponent(address)}`,
  );
  let signature: `0x${string}`;
  try {
    signature = await signMessage(challenge.message);
  } catch (error) {
    if (isUserRejection(error)) throw new SignatureRejectedError();
    throw error;
  }
  return postJson<{ cid: string }>("/api/pin", { envelope, address, signature });
}
