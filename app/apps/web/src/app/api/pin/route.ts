import { MANIFEST, passportEnvelopeSchema } from "@idpp/passport-config";
import { isAddress } from "viem";
import { z } from "zod";
import { clientIp, createRateLimiter, positiveIntFromEnv } from "@/app/api/_lib/rate-limit";
import { ApiError, errorResponse, readJson, requireServerEnv } from "@/app/api/_lib/respond";
import { consumePinChallenge } from "@/lib/operator/challenge";
import { authorizePin } from "@/lib/operator/pin-auth";
import { validateLiveSourceCasks } from "@/lib/operator/source-casks-live";
import { pinEnvelope } from "@/lib/pinata/pin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pinRequestSchema = z.object({
  envelope: z.unknown().refine((value) => value !== undefined, "envelope is required"),
  address: z.string().refine((value) => isAddress(value), "expected a 0x address"),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/, "expected a hex signature"),
});

/**
 * `POST /api/pin { envelope, address, signature }` → `{ cid }`. Pins a revise-flow successor
 * envelope after predicting its CID, asserting Pinata's CID equals it and comparing the gateway
 * read-back byte for byte. The issuer then signs `revise(tokenId, expectedRevision, cid)` in the
 * browser.
 *
 * Authentication: `signature` is the EIP-191 signature of `address` over the
 * message of `GET /api/pin/challenge?address=…`. After the signature verifies (and only then is
 * the single-use nonce consumed), the server reads the token on every chain of the deployment and
 * requires `address` to be an issuer (`isIssuer`) on the chain that holds it, and the envelope to extend the
 * on-chain passport: `revision = passportOf.revision + 1`, `previousCid = passportOf.cid`.
 * Revision 0 is only created by `/api/mint`.
 *
 * Order: rate limit, request shape, deployment, envelope validity, revision >= 1, signature,
 * chain reads, authorization, base check, pin. Cheap checks come first so unauthenticated callers
 * cost no RPC calls and no Pinata quota.
 *
 * The in-memory per-IP limit stays: `PIN_RATE_LIMIT_PER_MINUTE` requests per minute (default 20;
 * every POST counts, valid or not), answered with 429 `rate_limited` and a `Retry-After` header.
 * It is per server process and trusts the proxy's `X-Forwarded-For`.
 */
const DEFAULT_PIN_RATE_LIMIT_PER_MINUTE = 20;
const limiter = createRateLimiter({
  limit: positiveIntFromEnv(
    process.env.PIN_RATE_LIMIT_PER_MINUTE,
    DEFAULT_PIN_RATE_LIMIT_PER_MINUTE,
  ),
  windowMs: 60_000,
});

export async function POST(request: Request): Promise<Response> {
  try {
    const hit = limiter.hit(clientIp(request));
    if (!hit.ok) {
      const response = errorResponse(
        new ApiError("rate_limited", 429, "too many requests; try again later"),
      );
      response.headers.set("Retry-After", String(hit.retryAfterSeconds));
      return response;
    }
    const parsedBody = pinRequestSchema.safeParse(await readJson(request));
    if (!parsedBody.success) {
      const issue = parsedBody.error.issues[0];
      const where = issue && issue.path.length > 0 ? ` at ${issue.path.join(".")}` : "";
      throw new ApiError(
        "invalid_request",
        400,
        `expected { envelope, address, signature }; invalid request${where}: ${issue?.message}`,
      );
    }
    const { envelope, address, signature } = parsedBody.data;
    requireServerEnv();

    const deploymentId = (envelope as { deploymentId?: unknown } | null)?.deploymentId;
    if (deploymentId !== MANIFEST.deploymentId) {
      throw new ApiError(
        "wrong_deployment",
        400,
        `envelope.deploymentId must be ${MANIFEST.deploymentId}`,
      );
    }
    const parsedEnvelope = passportEnvelopeSchema.safeParse(envelope);
    if (!parsedEnvelope.success) {
      const issue = parsedEnvelope.error.issues[0];
      const where = issue && issue.path.length > 0 ? ` at ${issue.path.join(".")}` : "";
      throw new ApiError("invalid_envelope", 400, `invalid envelope${where}: ${issue?.message}`);
    }
    if (BigInt(parsedEnvelope.data.revision) < 1n) {
      throw new ApiError(
        "invalid_request",
        400,
        "revision 0 is created through /api/mint; /api/pin takes revision 1 and above",
      );
    }

    const challenge = await consumePinChallenge(address, signature);
    if (!challenge.ok) {
      throw new ApiError(
        challenge.code,
        401,
        challenge.code === "no_challenge"
          ? "no valid challenge for this address; request a new one"
          : "signature does not match the challenge",
      );
    }

    await authorizePin(parsedEnvelope.data, address as `0x${string}`);
    if (parsedEnvelope.data.kind === "bottle" && parsedEnvelope.data.data.sourceCasks) {
      await validateLiveSourceCasks(parsedEnvelope.data.data.sourceCasks);
    }

    const { cid } = await pinEnvelope(parsedEnvelope.data);
    return Response.json({ cid }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
