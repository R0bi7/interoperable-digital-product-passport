import "server-only";
import { MANIFEST, type PassportEnvelope, passportEnvelopeSchema } from "@idpp/passport-config";
import { mint, readNextTokenId, UnexpectedTokenIdError } from "@/lib/operator";
import { validateLiveSourceCasks } from "@/lib/operator/source-casks-live";
import { pinEnvelope } from "@/lib/pinata/pin";

export type EnvelopeData = Pick<PassportEnvelope, "kind" | "granularity" | "data">;

export type IssueRequest = {
  chainId: number;
  to: `0x${string}`;
  envelopeData: EnvelopeData;
};

export type IssueResult = { tokenId: string; cid: string; txHash: `0x${string}` };

export type IssueDeps = {
  readNextTokenId: typeof readNextTokenId;
  pin: typeof pinEnvelope;
  mint: typeof mint;
  validateSourceCasks: typeof validateLiveSourceCasks;
};

const defaultDeps: IssueDeps = {
  readNextTokenId,
  pin: pinEnvelope,
  mint,
  validateSourceCasks: validateLiveSourceCasks,
};

/** Revision-0 envelope for `tokenId` of the configured deployment. */
export function buildIssueEnvelope(envelopeData: EnvelopeData, tokenId: bigint): unknown {
  return {
    schema: "idpp-passport/1",
    deploymentId: MANIFEST.deploymentId,
    tokenId: tokenId.toString(),
    revision: "0",
    previousCid: null,
    kind: envelopeData.kind,
    granularity: envelopeData.granularity,
    data: envelopeData.data,
  };
}

/** Whether `envelopeData` forms a valid revision-0 envelope (checked with a placeholder id). */
export function validateEnvelopeData(
  envelopeData: unknown,
): { ok: true } | { ok: false; message: string } {
  const probe = buildIssueEnvelope(envelopeData as EnvelopeData, 0n);
  const parsed = passportEnvelopeSchema.safeParse(probe);
  if (parsed.success) return { ok: true };
  const issue = parsed.error.issues[0];
  const where = issue && issue.path.length > 0 ? ` at ${issue.path.join(".")}` : "";
  return { ok: false, message: `invalid envelope${where}: ${issue?.message}` };
}

const MAX_ATTEMPTS = 2;

/**
 * Reads `nextTokenId()`, pins the revision-0 envelope for that id, and mints with the operator
 * key. When another mint advanced the counter in between (`UnexpectedTokenId`) the whole sequence
 * runs once more with a fresh id, which re-pins because the envelope embeds the token id.
 */
export async function issuePassport(
  request: IssueRequest,
  deps: IssueDeps = defaultDeps,
): Promise<IssueResult> {
  if (request.envelopeData.kind === "bottle") {
    const data = request.envelopeData.data as Extract<PassportEnvelope, { kind: "bottle" }>["data"];
    if (data.sourceCasks) await deps.validateSourceCasks(data.sourceCasks);
  }
  let lastError: UnexpectedTokenIdError | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const expectedTokenId = await deps.readNextTokenId(request.chainId);
    const { cid } = await deps.pin(buildIssueEnvelope(request.envelopeData, expectedTokenId));
    try {
      const { txHash, issued } = await deps.mint(request.chainId, request.to, expectedTokenId, cid);
      if (issued.tokenId !== expectedTokenId || issued.cid !== cid) {
        throw new Error(
          `PassportIssued (${issued.tokenId}, ${issued.cid}) differs from the request (${expectedTokenId}, ${cid})`,
        );
      }
      return { tokenId: issued.tokenId.toString(), cid, txHash };
    } catch (error) {
      if (!(error instanceof UnexpectedTokenIdError)) throw error;
      lastError = error;
    }
  }
  throw lastError ?? new Error("mint was not attempted");
}
