import "server-only";
import { BaseError } from "viem";
import { getServerEnv, type ServerEnv } from "@/lib/env.server";
import { MintFailedError, UnexpectedTokenIdError, UnsupportedChainError } from "@/lib/operator";
import { PinAuthError, type PinAuthErrorCode } from "@/lib/operator/pin-auth";
import { SourceCaskError, type SourceCaskErrorCode } from "@/lib/operator/source-casks";
import { PinError } from "@/lib/pinata/pin";

export type ApiErrorCode =
  | Exclude<SourceCaskErrorCode, "chain_unavailable">
  | "invalid_request"
  | "rate_limited"
  | "not_allowlisted"
  | "no_challenge"
  | "bad_signature"
  | "unsupported_chain"
  | "not_issuer"
  | "stale_base"
  | "token_not_found"
  | "token_ambiguous"
  | "wrong_deployment"
  | "invalid_envelope"
  | "payload_too_large"
  | "pin_cid_mismatch"
  | "pin_upload_failed"
  | "pin_readback_failed"
  | "pin_readback_mismatch"
  | "token_id_conflict"
  | "mint_failed"
  | "chain_unavailable"
  | "server_misconfigured"
  | "internal_error";

/** An error with a stable code and an HTTP status. Messages are safe to show to the caller. */
export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const PIN_ERRORS: Record<PinError["code"], { code: ApiErrorCode; status: number }> = {
  invalid_envelope: { code: "invalid_envelope", status: 400 },
  payload_too_large: { code: "payload_too_large", status: 413 },
  upload_failed: { code: "pin_upload_failed", status: 502 },
  cid_mismatch: { code: "pin_cid_mismatch", status: 502 },
  readback_failed: { code: "pin_readback_failed", status: 502 },
  readback_mismatch: { code: "pin_readback_mismatch", status: 502 },
};

const PIN_AUTH_ERRORS: Record<PinAuthErrorCode, number> = {
  not_issuer: 403,
  stale_base: 409,
  token_not_found: 404,
  token_ambiguous: 409,
  chain_unavailable: 502,
};

export function errorResponse(error: unknown): Response {
  const body = (code: ApiErrorCode, message: string, status: number) =>
    Response.json({ error: { code, message } }, { status });

  if (error instanceof ApiError) return body(error.code, error.message, error.status);
  if (error instanceof SourceCaskError) {
    const unavailable =
      error.code === "source_cask_unavailable" || error.code === "chain_unavailable";
    return body(error.code, error.message, unavailable ? 503 : 422);
  }
  if (error instanceof PinAuthError) {
    return body(error.code, error.message, PIN_AUTH_ERRORS[error.code]);
  }
  if (error instanceof PinError) {
    const mapped = PIN_ERRORS[error.code];
    return body(mapped.code, error.message, mapped.status);
  }
  if (error instanceof UnsupportedChainError) {
    return body("unsupported_chain", error.message, 400);
  }
  if (error instanceof UnexpectedTokenIdError) {
    return body(
      "token_id_conflict",
      "another passport was issued on this chain at the same time; try again",
      409,
    );
  }
  if (error instanceof MintFailedError) return body("mint_failed", error.message, 502);
  if (error instanceof BaseError) {
    // RPC or transport failure while reading the chain. viem messages can contain RPC URLs.
    console.error("chain request failed", error);
    return body("chain_unavailable", "the chain RPC request failed; try again", 502);
  }
  // Never echo unknown errors: they may carry environment values or RPC URLs with keys.
  console.error("unhandled API error", error);
  return body("internal_error", "unexpected server error", 500);
}

/** `getServerEnv()` that reports a missing or invalid server configuration as an `ApiError`. */
export function requireServerEnv(): ServerEnv {
  try {
    return getServerEnv();
  } catch (error) {
    console.error("server environment is invalid", error);
    throw new ApiError("server_misconfigured", 500, "server environment is not configured");
  }
}

const MAX_BODY_BYTES = 256 * 1024;

/** Parses a JSON request body of at most 256 KiB. */
export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new ApiError("invalid_request", 413, "request body is too large");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError("invalid_request", 400, "request body is not valid JSON");
  }
}
