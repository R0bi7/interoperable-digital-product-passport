import "server-only";
import {
  canonicalize,
  computeCidV1,
  type PassportEnvelope,
  PayloadTooLargeError,
  passportEnvelopeSchema,
} from "@idpp/passport-config";
import { publicEnv } from "@/lib/env";
import { getServerEnv } from "@/lib/env.server";
import { createUploader, type PinUploader, resolveUploadPath } from "@/lib/pinata/uploaders";

export type PinErrorCode =
  | "invalid_envelope"
  | "payload_too_large"
  | "upload_failed"
  | "cid_mismatch"
  | "readback_failed"
  | "readback_mismatch";

/** Every failure of `pinEnvelope`. None of them is recoverable by adopting a different CID. */
export class PinError extends Error {
  constructor(
    readonly code: PinErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PinError";
  }
}

export type PinResult = { cid: string; bytes: Uint8Array };

export type PinOptions = {
  /** Defaults to the uploader selected by `PINATA_UPLOAD_PATH` (SDK when unset). */
  uploader?: PinUploader;
  /** Defaults to `NEXT_PUBLIC_PINATA_GATEWAY`. */
  gatewayHost?: string;
  fetchImpl?: typeof fetch;
  /** Fresh pins can take a moment to appear on the gateway. */
  readBack?: { attempts: number; delayMs: number };
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_READ_BACK = { attempts: 6, delayMs: 2_000 };
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function defaultUploader(): PinUploader {
  const path = resolveUploadPath(process.env.PINATA_UPLOAD_PATH);
  return createUploader(path, getServerEnv().PINATA_JWT);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.byteLength === b.byteLength && Buffer.from(a).equals(Buffer.from(b));
}

async function readBack(
  cid: string,
  expected: Uint8Array,
  gatewayHost: string,
  fetchImpl: typeof fetch,
  options: { attempts: number; delayMs: number },
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  let lastFailure = "no attempt made";
  for (let attempt = 0; attempt < options.attempts; attempt++) {
    if (attempt > 0) await sleep(options.delayMs);
    let response: Response;
    try {
      response = await fetchImpl(`https://${gatewayHost}/ipfs/${cid}`, { cache: "no-store" });
    } catch (error) {
      lastFailure = `gateway request failed: ${(error as Error).message}`;
      continue;
    }
    if (!response.ok) {
      lastFailure = `gateway returned ${response.status}`;
      continue;
    }
    const downloaded = new Uint8Array(await response.arrayBuffer());
    // Content is addressed by hash: bytes that differ from the upload are corruption, not lag.
    if (!bytesEqual(downloaded, expected)) {
      throw new PinError(
        "readback_mismatch",
        `gateway ${gatewayHost} served ${downloaded.byteLength} bytes for ${cid} that differ from the ${expected.byteLength} bytes uploaded`,
      );
    }
    return;
  }
  throw new PinError(
    "readback_failed",
    `could not read ${cid} back from ${gatewayHost} after ${options.attempts} attempts: ${lastFailure}`,
  );
}

/**
 * Validates `input` as an `idpp-passport/1` envelope, canonicalizes it (RFC 8785, at most 64 KiB),
 * predicts the CID, uploads the exact canonical bytes, requires the returned CID to equal the
 * prediction, then reads the bytes back from the gateway and compares them byte for byte.
 *
 * Any deviation throws `PinError`. The predicted CID is never replaced by the one Pinata reports.
 */
export async function pinEnvelope(input: unknown, options: PinOptions = {}): Promise<PinResult> {
  const parsed = passportEnvelopeSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? ` at ${issue.path.join(".")}` : "";
    throw new PinError("invalid_envelope", `invalid envelope${where}: ${issue?.message}`);
  }
  const envelope: PassportEnvelope = parsed.data;

  let bytes: Uint8Array;
  try {
    bytes = canonicalize(envelope);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      throw new PinError("payload_too_large", error.message);
    }
    throw error;
  }
  const predicted = computeCidV1(bytes);

  const uploader = options.uploader ?? defaultUploader();
  let returned: string;
  try {
    returned = await uploader.upload(bytes, `idpp-${envelope.tokenId}-r${envelope.revision}.json`);
  } catch (error) {
    throw new PinError(
      "upload_failed",
      `Pinata (${uploader.path}) upload failed: ${(error as Error).message}`,
    );
  }
  if (returned !== predicted) {
    throw new PinError(
      "cid_mismatch",
      `Pinata (${uploader.path}) returned ${returned}, predicted ${predicted}; the returned CID is not adopted`,
    );
  }

  await readBack(
    predicted,
    bytes,
    options.gatewayHost ?? publicEnv.NEXT_PUBLIC_PINATA_GATEWAY,
    options.fetchImpl ?? fetch,
    options.readBack ?? DEFAULT_READ_BACK,
    options.sleep ?? defaultSleep,
  );
  return { cid: predicted, bytes };
}
