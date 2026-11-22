import { MANIFEST, type PassportEnvelope, verifyHistoryHash } from "@idpp/passport-config";
import type { Location } from "@/features/write/lib/locate";
import type { PayloadRecord, VerifiedPayload } from "@/features/write/lib/payload";

export const MAX_SOURCE_CASK_TIP = 20n;
export const SOURCE_CASK_DEADLINE_MS = 60_000;
export type SourceCask = { tokenId: string; revision: string; volumeMl: string };
export type SourceCaskErrorCode =
  | "source_cask_missing"
  | "source_cask_revision"
  | "source_cask_not_cask"
  | "source_cask_overdraw"
  | "source_cask_unavailable"
  | "chain_unavailable";

export class SourceCaskError extends Error {
  constructor(
    readonly code: SourceCaskErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SourceCaskError";
  }
}

export type SourceCaskDeps = {
  locate(tokenId: bigint): Promise<Location>;
  fetchPayload(cid: string, record: PayloadRecord, signal?: AbortSignal): Promise<VerifiedPayload>;
};

/** Exact comparison of nonnegative schema-validated decimals; never rounds through Number. */
function overdraw(volumeMl: string, volumeLiters: string): boolean {
  const [mlWhole, mlFraction = ""] = volumeMl.split(".");
  const [litersWhole, litersFraction = ""] = volumeLiters.split(".");
  const places = Math.max(mlFraction.length, litersFraction.length);
  const ml = BigInt(`${mlWhole}${mlFraction.padEnd(places, "0")}`);
  const liters = BigInt(`${litersWhole}${litersFraction.padEnd(places, "0")}`);
  return ml > liters * 1000n;
}

/**
 * Validates each issuer-asserted source against its current held passport and authenticated
 * history. A reference to an older revision still requires the complete recorded sequence.
 * Duplicate token ids share one walk; no conservation across bottles is claimed.
 */
export async function validateSourceCasks(
  sourceCasks: readonly SourceCask[],
  deps: SourceCaskDeps,
): Promise<void> {
  if (sourceCasks.length === 0) return;
  const controller = new AbortController();
  let currentId = sourceCasks[0]?.tokenId;
  function fail(code: SourceCaskErrorCode, message: string): never {
    throw new SourceCaskError(code, `source cask ${currentId}: ${message}`);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new SourceCaskError(
        "source_cask_unavailable",
        `source cask ${currentId}: validation exceeded the 60 second request deadline`,
      );
      controller.abort(error);
      reject(error);
    }, SOURCE_CASK_DEADLINE_MS);
  });
  const validate = async () => {
    const histories = new Map<string, Map<bigint, PassportEnvelope>>();
    for (const source of sourceCasks) {
      controller.signal.throwIfAborted();
      currentId = source.tokenId;
      const tokenId = BigInt(source.tokenId);
      const target = BigInt(source.revision);
      let history = histories.get(source.tokenId);
      if (!history) {
        let location: Location;
        try {
          location = await deps.locate(tokenId);
        } catch {
          fail("chain_unavailable", "could not read the deployment chains; try again");
        }
        controller.signal.throwIfAborted();
        const failed = location.probes.filter((probe) => probe.status === "error");
        if (failed.length > 0) {
          fail(
            "chain_unavailable",
            `could not read chain ${failed.map((probe) => probe.chainId).join(", ")}; try again`,
          );
        }
        if (location.kind === "not_held")
          fail("source_cask_missing", "not held on any chain of the deployment");
        if (location.kind === "unknown") fail("chain_unavailable", location.reason);
        const { record } = location;
        if (target > record.revision) {
          fail(
            "source_cask_revision",
            `revision ${target} does not exist; the chain holds revision ${record.revision}`,
          );
        }
        if (record.revision > MAX_SOURCE_CASK_TIP) {
          fail(
            "source_cask_revision",
            "a history above revision 20 is not validated by this demonstrator",
          );
        }
        history = new Map();
        const cids: string[] = [];
        let cid: string | null = record.cid;
        for (let revision = record.revision; revision >= 0n; revision--) {
          controller.signal.throwIfAborted();
          if (cid === null)
            fail("source_cask_revision", `broken history link at revision ${revision}`);
          let payload: VerifiedPayload;
          try {
            payload = await deps.fetchPayload(
              cid,
              {
                deploymentId: MANIFEST.deploymentId,
                tokenId,
                revision,
              },
              controller.signal,
            );
          } catch {
            fail("source_cask_unavailable", `could not retrieve revision ${revision}; try again`);
          }
          controller.signal.throwIfAborted();
          if (!payload.ok) {
            fail(
              payload.unavailable ? "source_cask_unavailable" : "source_cask_revision",
              `revision ${revision}: ${payload.reason}`,
            );
          }
          history.set(revision, payload.envelope);
          cids.push(cid);
          cid = payload.envelope.previousCid;
        }
        const hash = verifyHistoryHash(tokenId, cids.reverse(), record.historyHash);
        if (!hash.ok) {
          fail(
            "source_cask_revision",
            `history hash mismatch; a predecessor may be an unrecorded decoy: ${hash.reason}`,
          );
        }
        histories.set(source.tokenId, history);
      }
      const envelope = history.get(target);
      if (!envelope) fail("source_cask_revision", `revision ${target} does not exist`);
      if (envelope.kind !== "cask")
        fail("source_cask_not_cask", `revision ${target} is a ${envelope.kind}, not a cask`);
      if (envelope.kind === "cask" && overdraw(source.volumeMl, envelope.data.volumeLiters)) {
        fail(
          "source_cask_overdraw",
          `requested ${source.volumeMl} ml exceeds revision ${target}'s ${envelope.data.volumeLiters} liters`,
        );
      }
    }
  };
  try {
    await Promise.race([validate(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
