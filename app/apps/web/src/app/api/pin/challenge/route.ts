import { isAddress } from "viem";
import { clientIp, createRateLimiter, positiveIntFromEnv } from "@/app/api/_lib/rate-limit";
import { ApiError, errorResponse } from "@/app/api/_lib/respond";
import { issuePinChallenge } from "@/lib/operator/challenge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Issuing is cheap, but the pending-challenge store is bounded: without a limit, one client could
// evict a holder's challenge by asking for many addresses.
const limiter = createRateLimiter({
  limit: positiveIntFromEnv(process.env.PIN_RATE_LIMIT_PER_MINUTE, 20),
  windowMs: 60_000,
});

/**
 * `GET /api/pin/challenge?address=0x…` → `{ nonce, message }` with
 * `message = "IDPP pin challenge: <nonce>"`. Open to any address: the challenge proves control of
 * the address, and `POST /api/pin` then checks that this address may revise the token. The pin
 * challenge has its own prefix and its own store, so a mint signature is not a pin signature.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const hit = limiter.hit(clientIp(request));
    if (!hit.ok) {
      const response = errorResponse(
        new ApiError("rate_limited", 429, "too many requests; try again later"),
      );
      response.headers.set("Retry-After", String(hit.retryAfterSeconds));
      return response;
    }
    const address = new URL(request.url).searchParams.get("address");
    if (!address || !isAddress(address)) {
      throw new ApiError("invalid_request", 400, "address must be a 0x address");
    }
    return Response.json(issuePinChallenge(address), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
