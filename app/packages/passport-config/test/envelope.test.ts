import { describe, expect, it } from "vitest";
import { MAX_PAYLOAD_BYTES, passportEnvelopeSchema } from "../src/index";
import { VECTOR_CID, VECTOR_ENVELOPE } from "./vector";

const valid = VECTOR_ENVELOPE;

const bottle = {
  schema: "idpp-passport/1",
  deploymentId: "whisky-v2-final",
  tokenId: "421614000000000001",
  revision: "1",
  previousCid: VECTOR_CID,
  kind: "bottle",
  granularity: "batch",
  data: {
    brand: "Demo",
    bottleType: "Standard",
    bottledDate: "2026-10-05",
    volumeMl: "700",
    alcoholByVolume: "46",
    sourceCasks: [{ tokenId: "11155111000000000001", revision: "2", volumeMl: "70000" }],
    quantity: "100",
    unit: "bottle",
  },
};

describe("passportEnvelopeSchema", () => {
  it("accepts the test vector and a batch of bottles", () => {
    expect(passportEnvelopeSchema.safeParse(valid).success).toBe(true);
    expect(passportEnvelopeSchema.safeParse(bottle).success).toBe(true);
  });

  it("rejects a missing deploymentId", () => {
    const { deploymentId: _, ...rest } = valid;
    expect(passportEnvelopeSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a numeric tokenId", () => {
    expect(
      passportEnvelopeSchema.safeParse({ ...valid, tokenId: Number(valid.tokenId) }).success,
    ).toBe(false);
  });

  it("rejects a payload larger than 64 KiB", () => {
    const big = {
      ...valid,
      data: { ...valid.data, description: "x".repeat(MAX_PAYLOAD_BYTES) },
    };
    const result = passportEnvelopeSchema.safeParse(big);
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.message.includes("limit"))).toBe(true);
  });

  it("rejects chain or timestamp fields", () => {
    expect(passportEnvelopeSchema.safeParse({ ...valid, chainId: "421614" }).success).toBe(false);
    expect(passportEnvelopeSchema.safeParse({ ...valid, timestamp: "1" }).success).toBe(false);
  });

  it("ties previousCid to the revision", () => {
    expect(passportEnvelopeSchema.safeParse({ ...valid, previousCid: VECTOR_CID }).success).toBe(
      false,
    );
    expect(passportEnvelopeSchema.safeParse({ ...valid, revision: "1" }).success).toBe(false);
  });

  it("requires quantity and unit only for batches", () => {
    expect(passportEnvelopeSchema.safeParse({ ...valid, granularity: "batch" }).success).toBe(
      false,
    );
    const { quantity: _, ...noQuantity } = bottle.data;
    expect(passportEnvelopeSchema.safeParse({ ...bottle, data: noQuantity }).success).toBe(false);
    expect(
      passportEnvelopeSchema.safeParse({ ...valid, data: { ...valid.data, quantity: "1" } })
        .success,
    ).toBe(false);
  });

  it("rejects non-string numbers, bad dates and unknown kinds", () => {
    const withData = (data: object) => ({ ...valid, data: { ...valid.data, ...data } });
    expect(passportEnvelopeSchema.safeParse(withData({ volumeLiters: 200 })).success).toBe(false);
    expect(passportEnvelopeSchema.safeParse(withData({ fillDate: "01.10.2026" })).success).toBe(
      false,
    );
    expect(passportEnvelopeSchema.safeParse({ ...valid, kind: "barrel" }).success).toBe(false);
    expect(passportEnvelopeSchema.safeParse({ ...valid, tokenId: "097" }).success).toBe(false);
  });
});
