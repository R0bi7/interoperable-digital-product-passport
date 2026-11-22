import { isAddress } from "viem";
import { ApiError, errorResponse, requireServerEnv } from "@/app/api/_lib/respond";
import { isAllowlistedIssuer } from "@/lib/operator/allowlist";
import { issueChallenge } from "@/lib/operator/challenge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `GET /api/mint/challenge?address=0x…` → `{ nonce, message }`. Only issuers get a challenge. */
export async function GET(request: Request): Promise<Response> {
  try {
    const address = new URL(request.url).searchParams.get("address");
    if (!address || !isAddress(address)) {
      throw new ApiError("invalid_request", 400, "address must be a 0x address");
    }
    requireServerEnv();
    if (!isAllowlistedIssuer(address)) {
      throw new ApiError("not_allowlisted", 403, "address is not an allowlisted issuer");
    }
    return Response.json(issueChallenge(address), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
