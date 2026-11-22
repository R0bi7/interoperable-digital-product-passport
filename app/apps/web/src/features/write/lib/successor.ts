import {
  canonicalize,
  computeCidV1,
  type PassportEnvelope,
  passportEnvelopeSchema,
} from "@idpp/passport-config";

/**
 * Successor of `current` (revision + 1, `previousCid` = the CID the current revision was read
 * from) with new `data`. Kind, granularity, token and deployment are inherited.
 */
export function buildSuccessorEnvelope(
  current: PassportEnvelope,
  currentCid: string,
  data: Record<string, unknown>,
): unknown {
  return {
    schema: current.schema,
    deploymentId: current.deploymentId,
    tokenId: current.tokenId,
    revision: (BigInt(current.revision) + 1n).toString(),
    previousCid: currentCid,
    kind: current.kind,
    granularity: current.granularity,
    data,
  };
}

export type EnvelopeCheck =
  | { ok: true; envelope: PassportEnvelope; predictedCid: string }
  | { ok: false; message: string };

/** Schema-validates a draft envelope and predicts its CID locally. */
export function checkEnvelope(candidate: unknown): EnvelopeCheck {
  const parsed = passportEnvelopeSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? ` (${issue.path.join(".")})` : "";
    return { ok: false, message: `${issue?.message ?? "invalid payload"}${where}` };
  }
  try {
    return {
      ok: true,
      envelope: parsed.data,
      predictedCid: computeCidV1(canonicalize(parsed.data)),
    };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}
