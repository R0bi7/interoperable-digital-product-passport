import {
  isProfileCid,
  MAX_PAYLOAD_BYTES,
  type PassportEnvelope,
  passportEnvelopeSchema,
  verifyBinding,
  verifyContent,
} from "@idpp/passport-config";

export type PayloadRecord = { deploymentId: string; tokenId: bigint; revision: bigint };

export type VerifiedPayload =
  | { ok: true; envelope: PassportEnvelope }
  | { ok: false; reason: string; unavailable?: boolean };

/**
 * Bounded gateway retrieval, then content, schema and binding checks. `unavailable` distinguishes
 * a retrieval failure from invalid bytes, so a server cannot accept an unchecked source cask.
 * The optional request signal shares the caller's deadline across a whole history walk.
 */
export async function fetchVerifiedPayload(
  gatewayHost: string,
  cid: string,
  record: PayloadRecord,
  fetchImpl: typeof fetch = fetch,
  requestSignal?: AbortSignal,
): Promise<VerifiedPayload> {
  if (!isProfileCid(cid)) {
    return { ok: false, reason: "CID is not a CIDv1 raw sha2-256 base32 CID" };
  }
  const timeout = AbortSignal.timeout(20_000);
  const signal = requestSignal ? AbortSignal.any([timeout, requestSignal]) : timeout;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let rejectAbort: (reason: unknown) => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => {
    rejectAbort(signal.reason);
    void reader?.cancel().catch(() => {});
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    signal.throwIfAborted();
    const response = await Promise.race([
      fetchImpl(`https://${gatewayHost}/ipfs/${cid}`, { signal, cache: "no-store" }),
      aborted,
    ]);
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      return { ok: false, reason: `gateway returned ${response.status}`, unavailable: true };
    }
    if (Number(response.headers.get("content-length") ?? "0") > MAX_PAYLOAD_BYTES) {
      void response.body?.cancel().catch(() => {});
      return {
        ok: false,
        reason: `payload exceeds the ${MAX_PAYLOAD_BYTES}-byte limit`,
        unavailable: true,
      };
    }
    if (!response.body) return { ok: false, reason: "gateway returned no body", unavailable: true };
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      signal.throwIfAborted();
      const chunk = await Promise.race([reader.read(), aborted]);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_PAYLOAD_BYTES) {
        void reader.cancel().catch(() => {});
        return {
          ok: false,
          reason: `payload exceeds the ${MAX_PAYLOAD_BYTES}-byte limit`,
          unavailable: true,
        };
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const content = verifyContent(bytes, cid);
    if (!content.ok) return { ok: false, reason: `content check failed: ${content.reason}` };

    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return { ok: false, reason: "payload is not valid JSON" };
    }
    const parsed = passportEnvelopeSchema.safeParse(json);
    if (!parsed.success) {
      return {
        ok: false,
        reason: `payload is not an idpp-passport/1 envelope: ${parsed.error.issues[0]?.message}`,
      };
    }
    const binding = verifyBinding(parsed.data, record);
    if (!binding.ok) return { ok: false, reason: `binding check failed: ${binding.reason}` };
    return { ok: true, envelope: parsed.data };
  } catch (error) {
    return {
      ok: false,
      reason: `gateway request failed: ${(error as Error).message}`,
      unavailable: true,
    };
  } finally {
    signal.removeEventListener("abort", onAbort);
    reader?.releaseLock();
  }
}
