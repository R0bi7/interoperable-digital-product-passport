import { describe, expect, it, vi } from "vitest";
import { canonicalize, passportEnvelopeSchema } from "../src/index";
import { fetchVerified } from "./pinata";
import { VECTOR_CID, VECTOR_ENVELOPE } from "./vector";

const bytes = canonicalize(passportEnvelopeSchema.parse(VECTOR_ENVELOPE));
const gateway = "gateway.example";

describe("gateway read-back (mocked)", () => {
  const respond = (body: BodyInit | null, status = 200) =>
    vi.fn<typeof fetch>(async () => new Response(body, { status }));

  it("accepts the exact bytes", async () => {
    const result = await fetchVerified(gateway, VECTOR_CID, respond(bytes as BodyInit));
    expect(result.ok).toBe(true);
  });

  it("rejects a corrupt response", async () => {
    const corrupt = bytes.slice();
    corrupt[corrupt.length - 2] = 0x31;
    const result = await fetchVerified(gateway, VECTOR_CID, respond(corrupt as BodyInit));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/expected bafkrei/);
  });

  it("reports a 404", async () => {
    const result = await fetchVerified(gateway, VECTOR_CID, respond("not found", 404));
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it("reports a network error without throwing", async () => {
    const failing = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    const result = await fetchVerified(gateway, VECTOR_CID, failing);
    expect(result.ok).toBe(false);
  });
});
