import { computeCidV1, isProfileCid } from "./cid";
import { type PassportEnvelope, passportEnvelopeSchema } from "./envelope";

/** Outcome of one verification. Verifiers never throw; bad input yields `ok: false`. */
export type VerificationResult = { ok: true } | { ok: false; reason: string };

/** The on-chain record a CID was read from (`passportOf(tokenId)` on a chain of `deploymentId`). */
export type OnChainRecord = {
  deploymentId: string;
  tokenId: bigint | string;
  revision: bigint | string;
};

/**
 * Result of `verifyHistory`. On failure, `index` is the position of the first revision that
 * failed; every revision before it passed. `index` is absent when the input as a whole is unusable
 * (not arrays, empty, or lengths differ).
 */
export type HistoryResult = { ok: true } | { ok: false; reason: string; index?: number };

/** One indexed revision, in the order the indexer recorded it. */
export type IndexedRevision = {
  revision: bigint | string;
  cid: string;
};

const ok: VerificationResult = { ok: true };
const fail = (reason: string): VerificationResult => ({ ok: false, reason });

function toDecimal(value: unknown): string | undefined {
  if (typeof value === "bigint") return value >= 0n ? value.toString() : undefined;
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) return value;
  return undefined;
}

function parseEnvelope(
  value: unknown,
): { ok: true; envelope: PassportEnvelope } | { ok: false; reason: string } {
  const parsed = passportEnvelopeSchema.safeParse(value);
  if (parsed.success) return { ok: true, envelope: parsed.data };
  const issue = parsed.error.issues[0];
  const where = issue && issue.path.length > 0 ? ` at ${issue.path.join(".")}` : "";
  return { ok: false, reason: `invalid envelope${where}: ${issue?.message ?? "unknown error"}` };
}

/**
 * `content`: the downloaded raw bytes hash to the requested CID. Run before parsing the bytes.
 * Only CIDs of the IDPP profile (v1, raw, sha2-256, base32) can be verified.
 */
export function verifyContent(bytes: Uint8Array, cid: string): VerificationResult {
  try {
    if (!(bytes instanceof Uint8Array)) return fail("bytes must be a Uint8Array");
    if (typeof cid !== "string" || !isProfileCid(cid)) {
      return fail(`requested CID ${String(cid)} is not a CIDv1 raw sha2-256 base32 CID`);
    }
    const actual = computeCidV1(bytes);
    return actual === cid ? ok : fail(`content hashes to ${actual}, expected ${cid}`);
  } catch (error) {
    return fail(`content check failed: ${(error as Error).message}`);
  }
}

/**
 * `binding`: the parsed envelope's `deploymentId`, `tokenId` and `revision` equal the on-chain
 * record whose CID pointed to it.
 */
export function verifyBinding(envelope: unknown, record: OnChainRecord): VerificationResult {
  try {
    const parsed = parseEnvelope(envelope);
    if (!parsed.ok) return parsed;
    const { envelope: env } = parsed;
    const tokenId = toDecimal(record?.tokenId);
    const revision = toDecimal(record?.revision);
    if (tokenId === undefined) return fail("on-chain tokenId is not a non-negative integer");
    if (revision === undefined) return fail("on-chain revision is not a non-negative integer");
    if (env.deploymentId !== record.deploymentId) {
      return fail(`deploymentId ${env.deploymentId} differs from ${record.deploymentId}`);
    }
    if (env.tokenId !== tokenId) return fail(`tokenId ${env.tokenId} differs from ${tokenId}`);
    if (env.revision !== revision) return fail(`revision ${env.revision} differs from ${revision}`);
    return ok;
  } catch (error) {
    return fail(`binding check failed: ${(error as Error).message}`);
  }
}

/**
 * `history`: `envelopes[i]` is the payload fetched for `indexedRevisions[i]`. Revisions must run
 * 0, 1, 2, … without gaps, every envelope must carry its indexed revision and the same token and
 * deployment, and each `previousCid` must equal the CID of the preceding indexed revision.
 * Content of each envelope is checked separately with `verifyContent`.
 *
 * Per-revision badges: on failure, revisions before `index` are verified and `index` failed. When
 * the payload of revision k cannot be fetched, call this on the prefix
 * (`envelopes.slice(0, k)`, `indexedRevisions.slice(0, k)`) and show k and later as unavailable.
 */
export function verifyHistory(
  envelopes: readonly unknown[],
  indexedRevisions: readonly IndexedRevision[],
): HistoryResult {
  const failAt = (index: number, reason: string): HistoryResult => ({ ok: false, reason, index });
  try {
    if (!Array.isArray(envelopes) || !Array.isArray(indexedRevisions)) {
      return fail("envelopes and indexedRevisions must be arrays");
    }
    if (indexedRevisions.length === 0) return fail("no indexed revisions");
    if (envelopes.length !== indexedRevisions.length) {
      return fail(`${envelopes.length} envelopes for ${indexedRevisions.length} indexed revisions`);
    }
    let first: PassportEnvelope | undefined;
    for (let i = 0; i < indexedRevisions.length; i++) {
      const indexed = indexedRevisions[i] as IndexedRevision;
      const expectedRevision = String(i);
      if (toDecimal(indexed?.revision) !== expectedRevision) {
        return failAt(i, `indexed revision at position ${i} is ${String(indexed?.revision)}`);
      }
      const parsed = parseEnvelope(envelopes[i]);
      if (!parsed.ok) return failAt(i, `revision ${i}: ${parsed.reason}`);
      const env = parsed.envelope;
      first ??= env;
      if (env.revision !== expectedRevision) {
        return failAt(i, `envelope at position ${i} declares revision ${env.revision}`);
      }
      if (env.tokenId !== first.tokenId || env.deploymentId !== first.deploymentId) {
        return failAt(i, `revision ${i} belongs to another token or deployment`);
      }
      const expectedPrevious = i === 0 ? null : (indexedRevisions[i - 1] as IndexedRevision).cid;
      if (env.previousCid !== expectedPrevious) {
        return failAt(
          i,
          `revision ${i} previousCid ${String(env.previousCid)}, expected ${String(expectedPrevious)}`,
        );
      }
    }
    return ok;
  } catch (error) {
    return fail(`history check failed: ${(error as Error).message}`);
  }
}
