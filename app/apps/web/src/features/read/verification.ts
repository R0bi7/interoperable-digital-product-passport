import {
  isProfileCid,
  MAX_PAYLOAD_BYTES,
  type PassportEnvelope,
  passportEnvelopeSchema,
  verifyBinding,
  verifyContent,
  verifyHistory,
  verifyHistoryHash,
  whiskyDistilleryAbi,
} from "@idpp/passport-config";
import { type Address, type Hex, parseEventLogs } from "viem";
import { getContractAddress } from "@/lib/chains";

/**
 * Client-side verification of a passport's payloads (docs/TECHNICAL-REFERENCE.md, "Verification
 * results"). Per revision four results are reported separately: `content` (raw bytes hash to the
 * CID, checked before parsing), `binding` (envelope names the same deployment, token and revision
 * as the on-chain record), and `history` (each `previousCid` equals the CID of the preceding
 * revision, back to revision 0), and `recorded` (the emitting contract receipt names the displayed
 * CID, revision and author). Once per passport, `historyHash` (the CIDs of revisions 0..r
 * recompute the history hash that the live `passportOf` returns).
 */

export type CheckStatus = "verified" | "failed" | "unavailable" | "unconfirmed";
export type Assurance = "live" | "indexer-only" | "live-tip-older";
export type ReceiptView = {
  status: "success" | "reverted";
  from: Address;
  logs: { address: Address; topics: [] | [Hex, ...Hex[]]; data: Hex }[];
};
export type RevisionRef = {
  revision: string;
  cid: string;
  conflict?: boolean;
  txHash?: string;
  chainId?: number;
  author?: string;
};
export type Check = { status: CheckStatus; reason?: string };

export type PayloadFetch = { ok: true; bytes: Uint8Array } | { ok: false; reason: string };

/** Where the CID checked for a revision came from. */
export type CidSource = "indexed" | "live" | "live-only";

export type RevisionVerification = {
  revision: string;
  cid: string;
  /** `live`: read from `passportOf` on chain; `live-only`: on chain but not in the indexer yet. */
  source: CidSource;
  conflict: boolean;
  content: Check;
  binding: Check;
  history: Check;
  recorded: Check;
  assurance: Assurance;
  /** Schema-valid envelope; only set when the bytes passed the content check. */
  envelope?: PassportEnvelope;
};

export type VerifyInput = {
  /** Deployment generation the app is configured for (not what the indexer claims). */
  deploymentId: string;
  tokenId: string;
  /** Revisions as indexed; any order. */
  revisions: readonly RevisionRef[];
  /** `passportOf(tokenId)` read live on the current chain, when available. */
  live?: { revision: string; cid: string; historyHash?: string | null } | null;
  liveError?: string;
  fetchPayload: (cid: string) => Promise<PayloadFetch>;
  readReceipt?: (chainId: number, txHash: string) => Promise<ReceiptView | null>;
};

export type VerifyOutcome = {
  assurance: Assurance;
  reason?: string;
  entries: RevisionVerification[];
  /**
   * The CIDs checked for revisions 0..r (the tip from the live read) recompute the live
   * `historyHash`. Confirms the CID and order of every revision with one read; not who wrote a
   * revision or on which chain.
   */
  historyHash: Check;
  /** Observations that are not verification results (indexer behind, live CID differs, …). */
  notes: string[];
};

const verified: Check = { status: "verified" };
const failed = (reason: string): Check => ({ status: "failed", reason });
const unavailable = (reason: string): Check => ({ status: "unavailable", reason });

type Ref = RevisionRef & { source: CidSource; conflict: boolean; indexedCid?: string };

/** Indexed revisions in order, with the live on-chain record merged in as the authoritative tip. */
export function mergeRefs(input: VerifyInput): { refs: Ref[]; notes: string[] } {
  const notes: string[] = [];
  const refs: Ref[] = [...input.revisions]
    .sort((a, b) => {
      const [x, y] = [BigInt(a.revision), BigInt(b.revision)];
      return x < y ? -1 : x > y ? 1 : 0;
    })
    .map((r) => ({
      ...r,
      source: "indexed" as const,
      conflict: r.conflict ?? false,
    }));
  const live = input.live;
  if (!live) return { refs, notes };
  const last = refs[refs.length - 1];
  const liveRevision = BigInt(live.revision);
  if (!last) {
    refs.push({ revision: live.revision, cid: live.cid, source: "live-only", conflict: false });
    notes.push(`The indexer has no revisions; revision ${live.revision} comes from the chain.`);
  } else if (BigInt(last.revision) === liveRevision) {
    if (last.cid !== live.cid) {
      notes.push(
        `Indexed CID of revision ${last.revision} (${last.cid}) differs from the on-chain CID (${live.cid}); the on-chain CID is checked.`,
      );
    }
    refs[refs.length - 1] = {
      ...last,
      cid: live.cid,
      source: "live",
      indexedCid: last.cid !== live.cid ? last.cid : undefined,
      conflict: last.conflict || last.cid !== live.cid,
    };
  } else if (liveRevision > BigInt(last.revision)) {
    const missing = liveRevision - BigInt(last.revision);
    notes.push(
      missing === 1n
        ? `Revision ${live.revision} is on chain but not indexed yet.`
        : `The chain is at revision ${live.revision}; the indexer stops at revision ${last.revision}.`,
    );
    refs.push({ revision: live.revision, cid: live.cid, source: "live-only", conflict: false });
  } else {
    const atTip = refs.findIndex((ref) => BigInt(ref.revision) === liveRevision);
    if (atTip >= 0) {
      const indexed = refs[atTip] as Ref;
      if (indexed.cid !== live.cid) {
        notes.push(
          `Indexed CID of revision ${indexed.revision} (${indexed.cid}) differs from the on-chain CID (${live.cid}); the on-chain CID is checked.`,
        );
      }
      refs[atTip] = {
        ...indexed,
        cid: live.cid,
        source: "live",
        indexedCid: indexed.cid !== live.cid ? indexed.cid : undefined,
        conflict: indexed.conflict || indexed.cid !== live.cid,
      };
    } else {
      refs.push({ revision: live.revision, cid: live.cid, source: "live-only", conflict: false });
      refs.sort((a, b) => (BigInt(a.revision) < BigInt(b.revision) ? -1 : 1));
    }
  }
  return { refs, notes };
}

function decodeJson(
  bytes: Uint8Array,
): { ok: true; value: unknown } | { ok: false; reason: string } {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return { ok: false, reason: `payload is not valid UTF-8 JSON: ${(error as Error).message}` };
  }
}

type Stage = {
  ref: Ref;
  content: Check;
  parsed?: unknown;
  binding: Check;
  envelope?: PassportEnvelope;
};

async function stageOf(input: VerifyInput, ref: Ref): Promise<Stage> {
  const fetched = await input.fetchPayload(ref.cid);
  if (!fetched.ok) {
    const reason = `payload unavailable: ${fetched.reason}`;
    return { ref, content: unavailable(reason), binding: unavailable(reason) };
  }
  // Raw bytes first: nothing is parsed before the CID matched.
  const content = verifyContent(fetched.bytes, ref.cid);
  if (!content.ok) {
    return {
      ref,
      content: failed(content.reason),
      binding: unavailable("not evaluated: content check failed"),
    };
  }
  const decoded = decodeJson(fetched.bytes);
  if (!decoded.ok) return { ref, content: verified, binding: failed(decoded.reason) };
  const bound = verifyBinding(decoded.value, {
    deploymentId: input.deploymentId,
    tokenId: input.tokenId,
    revision: ref.revision,
  });
  const envelope = passportEnvelopeSchema.safeParse(decoded.value);
  return {
    ref,
    content: verified,
    parsed: decoded.value,
    binding: bound.ok ? verified : failed(bound.reason),
    envelope: envelope.success ? envelope.data : undefined,
  };
}

function historyHashCheck(input: VerifyInput, refs: readonly Ref[]): Check {
  const live = input.live;
  const onChain = live?.historyHash;
  if (!live || !onChain) return unavailable("no live read of passportOf");
  const throughTip = refs.filter((ref) => BigInt(ref.revision) <= BigInt(live.revision));
  const gap = throughTip.findIndex((ref, i) => ref.revision !== String(i));
  if (gap >= 0) {
    return unavailable(
      `not evaluated: revision ${gap} is not listed, so the history cannot be hashed`,
    );
  }
  const result = verifyHistoryHash(
    input.tokenId,
    throughTip.map((ref) => ref.cid),
    onChain,
  );
  return result.ok ? verified : failed(result.reason);
}

/** Confirm the displayed reference against a receipt on the emitting chain, independently of the live tip. */
async function recordedCheck(input: VerifyInput, ref: Ref): Promise<Check> {
  if (ref.txHash === undefined || ref.chainId === undefined || !ref.author || !input.readReceipt) {
    return unavailable("no indexed transaction metadata for this revision");
  }
  const address = getContractAddress(ref.chainId);
  if (!address) return unavailable(`chain ${ref.chainId} is not part of this deployment`);
  try {
    const receipt = await input.readReceipt(ref.chainId, ref.txHash);
    if (!receipt) return unavailable("transaction receipt not found");
    if (receipt.status !== "success") return failed("the indexed transaction reverted");
    const logs = receipt.logs
      .filter((log) => log.address.toLowerCase() === address.toLowerCase())
      .map((log) => ({
        ...log,
        blockHash: null,
        blockNumber: null,
        logIndex: null,
        transactionHash: null,
        transactionIndex: null,
        removed: false,
      }));
    const sameAuthor = (author: string) => author.toLowerCase() === ref.author?.toLowerCase();
    const matches =
      BigInt(ref.revision) === 0n
        ? parseEventLogs({ abi: whiskyDistilleryAbi, eventName: "PassportIssued", logs }).some(
            ({ args }) =>
              args.tokenId === BigInt(input.tokenId) &&
              args.cid === ref.cid &&
              sameAuthor(receipt.from),
          )
        : parseEventLogs({ abi: whiskyDistilleryAbi, eventName: "PassportRevised", logs }).some(
            ({ args }) =>
              args.tokenId === BigInt(input.tokenId) &&
              args.revision === BigInt(ref.revision) &&
              args.cid === ref.cid &&
              sameAuthor(args.author),
          );
    return matches
      ? verified
      : failed(
          `no matching ${BigInt(ref.revision) === 0n ? "PassportIssued" : "PassportRevised"} event for the displayed CID ${ref.cid}, revision and author${ref.indexedCid ? ` (indexer CID ${ref.indexedCid}; live CID ${ref.cid})` : ""}`,
        );
  } catch (error) {
    return unavailable(`receipt unavailable: ${(error as Error).message}`);
  }
}

/** Verifies every revision of one passport. Never throws; failures become check results. */
export async function verifyPassport(input: VerifyInput): Promise<VerifyOutcome> {
  const { refs, notes } = mergeRefs(input);
  const live = input.live;
  const aboveTip = live && refs.some((ref) => BigInt(ref.revision) > BigInt(live.revision));
  const assurance: Assurance = !input.live ? "indexer-only" : aboveTip ? "live-tip-older" : "live";
  const reason =
    assurance === "indexer-only"
      ? `indexer only: ${input.liveError ?? "no live read was available"}`
      : assurance === "live-tip-older"
        ? `above the live tip (revision ${live?.revision})`
        : undefined;
  const [stages, recorded] = await Promise.all([
    Promise.all(refs.map((ref) => stageOf(input, ref))),
    Promise.all(refs.map((ref) => recordedCheck(input, ref))),
  ]);

  // Leading run of revisions 0, 1, 2, … whose verified bytes parsed: the part verifyHistory can judge.
  let prefix = 0;
  while (prefix < stages.length) {
    const stage = stages[prefix] as Stage;
    if (stage.ref.revision !== String(prefix) || stage.parsed === undefined) break;
    prefix++;
  }

  const history: Check[] = stages.map((stage, i) => {
    if (i < prefix) return verified;
    if (i > prefix) {
      return unavailable(`not evaluated: revision ${prefix} could not be read and verified`);
    }
    if (stage.ref.revision !== String(i)) {
      return unavailable(
        `not evaluated: indexed revisions are not contiguous before ${stage.ref.revision}`,
      );
    }
    return unavailable(
      stage.content.status === "verified"
        ? "not evaluated: payload is not valid JSON"
        : `not evaluated: content is ${stage.content.status}`,
    );
  });
  if (prefix > 0) {
    const prefixStages = stages.slice(0, prefix);
    const result = verifyHistory(
      prefixStages.map((s) => s.parsed),
      prefixStages.map((s) => ({ revision: s.ref.revision, cid: s.ref.cid })),
    );
    if (!result.ok) {
      const at = result.index ?? 0;
      for (let i = 0; i < prefix; i++) {
        history[i] =
          i < at
            ? verified
            : i === at
              ? failed(result.reason)
              : unavailable(`not evaluated: revision ${at} failed the history check`);
      }
    }
  }

  const entries = stages.map(
    (stage, i): RevisionVerification => ({
      revision: stage.ref.revision,
      cid: stage.ref.cid,
      source: stage.ref.source,
      conflict: stage.ref.conflict,
      content: stage.content,
      binding:
        stage.binding.status === "verified" &&
        (!input.live || BigInt(stage.ref.revision) > BigInt(input.live.revision))
          ? { status: "unconfirmed", reason }
          : stage.binding,
      assurance: !input.live
        ? "indexer-only"
        : BigInt(stage.ref.revision) > BigInt(input.live.revision)
          ? "live-tip-older"
          : "live",
      recorded: recorded[i] as Check,
      history: history[i] as Check,
      envelope: stage.envelope,
    }),
  );
  return { assurance, reason, entries, historyHash: historyHashCheck(input, refs), notes };
}

/**
 * Fetches `https://<gateway>/ipfs/<cid>` as raw bytes. The CID comes from an untrusted indexer, so
 * it must match the IDPP CID profile before it is put into a URL, and the response is capped at the
 * payload limit.
 */
export async function fetchGatewayPayload(
  gateway: string,
  cid: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PayloadFetch> {
  if (!isProfileCid(cid))
    return { ok: false, reason: "CID is not a CIDv1 raw sha2-256 base32 CID" };
  try {
    const response = await fetchImpl(`https://${gateway}/ipfs/${cid}`, {
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (!response.ok) return { ok: false, reason: `gateway answered HTTP ${response.status}` };
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_PAYLOAD_BYTES) {
      return { ok: false, reason: `payload exceeds the ${MAX_PAYLOAD_BYTES}-byte limit` };
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_PAYLOAD_BYTES) {
      return { ok: false, reason: `payload exceeds the ${MAX_PAYLOAD_BYTES}-byte limit` };
    }
    return { ok: true, bytes: new Uint8Array(buffer) };
  } catch (error) {
    return { ok: false, reason: `gateway request failed: ${(error as Error).message}` };
  }
}
