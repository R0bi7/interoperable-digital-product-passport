import jcs from "canonicalize";
import type { PassportEnvelope } from "./envelope";

/** Upper bound for canonical payload bytes (64 KiB). Larger payloads are rejected. */
export const MAX_PAYLOAD_BYTES = 65_536;

export class PayloadTooLargeError extends Error {
  constructor(readonly size: number) {
    super(`canonical payload is ${size} bytes, limit is ${MAX_PAYLOAD_BYTES}`);
    this.name = "PayloadTooLargeError";
  }
}

/** RFC 8785 (JCS) serialization of any JSON value as UTF-8, without the size limit. */
export function canonicalBytes(value: unknown): Uint8Array {
  const text = jcs(value);
  if (text === undefined) throw new TypeError("value cannot be canonicalized as JSON");
  return new TextEncoder().encode(text);
}

/**
 * Canonical bytes of a passport envelope: exactly what is uploaded and hashed into the CID.
 * Validate untrusted input with `passportEnvelopeSchema` first. Throws `PayloadTooLargeError`
 * when the result exceeds `MAX_PAYLOAD_BYTES`.
 */
export function canonicalize(envelope: PassportEnvelope): Uint8Array {
  const bytes = canonicalBytes(envelope);
  if (bytes.byteLength > MAX_PAYLOAD_BYTES) throw new PayloadTooLargeError(bytes.byteLength);
  return bytes;
}
