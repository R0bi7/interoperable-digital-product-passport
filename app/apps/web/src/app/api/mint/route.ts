import { getChain } from "@idpp/passport-config";
import { isAddress, zeroAddress } from "viem";
import { z } from "zod";
import { ApiError, errorResponse, readJson, requireServerEnv } from "@/app/api/_lib/respond";
import { isAllowlistedIssuer } from "@/lib/operator/allowlist";
import { consumeChallenge } from "@/lib/operator/challenge";
import { type EnvelopeData, issuePassport, validateEnvelopeData } from "@/lib/operator/issue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const address = z.string().refine((value) => isAddress(value), "expected a 0x address");

const mintRequestSchema = z.object({
  chainId: z.number().int().positive(),
  to: address.refine(
    (value) => value.toLowerCase() !== zeroAddress,
    "cannot mint to the zero address",
  ),
  envelopeData: z.object({
    kind: z.enum(["cask", "bottle"]),
    granularity: z.enum(["item", "batch"]),
    data: z.record(z.string(), z.unknown()),
  }),
  address,
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/, "expected a hex signature"),
});

/**
 * `POST /api/mint { chainId, to, envelopeData, address, signature }` → `{ tokenId, cid, txHash }`.
 *
 * Order matters: the request shape is validated, then the allowlist, the chain and the envelope
 * data are checked, and only then is the single-use challenge consumed (signature check). Pinning
 * and the operator transaction happen after authentication only.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = mintRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue && issue.path.length > 0 ? ` at ${issue.path.join(".")}` : "";
      throw new ApiError("invalid_request", 400, `invalid request${where}: ${issue?.message}`);
    }
    const body = parsed.data;

    requireServerEnv();
    if (!isAllowlistedIssuer(body.address)) {
      throw new ApiError("not_allowlisted", 403, "address is not an allowlisted issuer");
    }
    if (!getChain(body.chainId)) {
      throw new ApiError(
        "unsupported_chain",
        400,
        `chain ${body.chainId} is not part of the deployment`,
      );
    }
    const envelope = validateEnvelopeData(body.envelopeData);
    if (!envelope.ok) throw new ApiError("invalid_envelope", 400, envelope.message);

    const challenge = await consumeChallenge(body.address, body.signature);
    if (!challenge.ok) {
      throw new ApiError(
        challenge.code,
        401,
        challenge.code === "no_challenge"
          ? "no valid challenge for this address; request a new one"
          : "signature does not match the challenge",
      );
    }

    const result = await issuePassport({
      chainId: body.chainId,
      to: body.to as `0x${string}`,
      envelopeData: body.envelopeData as EnvelopeData,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
