import { z } from "zod";
import { canonicalBytes, MAX_PAYLOAD_BYTES } from "./canonicalize";
import { isProfileCid } from "./cid";

export const ENVELOPE_SCHEMA_ID = "idpp-passport/1";

/** Non-negative integer as a decimal string without leading zeros (token ids, revisions). */
const uintString = z.string().regex(/^(0|[1-9][0-9]*)$/, "expected a decimal integer string");
/** Non-negative decimal number as a string, e.g. `"63.5"`. */
const decimalString = z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/, "expected a decimal string");
/** ISO-8601 calendar date, e.g. `"2026-10-01"`. */
const isoDate = z.iso.date();
const profileCid = z.string().refine(isProfileCid, "expected a CIDv1 raw sha2-256 base32 CID");
const text = z.string().min(1);

/** Present only when `granularity` is `batch`. */
const batchFields = {
  quantity: decimalString.optional(),
  unit: text.optional(),
};

export const caskDataSchema = z.strictObject({
  distillery: text,
  caskType: text,
  caskNumber: text,
  volumeLiters: decimalString,
  alcoholByVolume: decimalString,
  fillDate: isoDate,
  origin: z.strictObject({ country: text, region: text }).optional(),
  description: z.string().optional(),
  ...batchFields,
});

export const sourceCaskSchema = z.strictObject({
  tokenId: uintString,
  revision: uintString,
  volumeMl: decimalString,
});

export const bottleDataSchema = z.strictObject({
  brand: text,
  bottleType: text,
  bottledDate: isoDate,
  volumeMl: decimalString,
  alcoholByVolume: decimalString,
  sourceCasks: z.array(sourceCaskSchema).optional(),
  description: z.string().optional(),
  ...batchFields,
});

const commonFields = {
  schema: z.literal(ENVELOPE_SCHEMA_ID),
  deploymentId: text,
  tokenId: uintString,
  revision: uintString,
  previousCid: profileCid.nullable(),
  granularity: z.enum(["item", "batch"]),
};

/** Payload envelope `idpp-passport/1` (docs/TECHNICAL-REFERENCE.md "Payload envelope"). */
export const passportEnvelopeSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({ ...commonFields, kind: z.literal("cask"), data: caskDataSchema }),
    z.strictObject({ ...commonFields, kind: z.literal("bottle"), data: bottleDataSchema }),
  ])
  .superRefine((envelope, ctx) => {
    if (envelope.revision === "0" && envelope.previousCid !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["previousCid"],
        message: "previousCid must be null at revision 0",
      });
    }
    if (envelope.revision !== "0" && envelope.previousCid === null) {
      ctx.addIssue({
        code: "custom",
        path: ["previousCid"],
        message: "previousCid is required after revision 0",
      });
    }
    const { quantity, unit } = envelope.data;
    if (envelope.granularity === "batch") {
      if (quantity === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["data", "quantity"],
          message: "batch needs quantity",
        });
      }
      if (unit === undefined) {
        ctx.addIssue({ code: "custom", path: ["data", "unit"], message: "batch needs unit" });
      }
    } else if (quantity !== undefined || unit !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["data"],
        message: "quantity and unit are only allowed for granularity batch",
      });
    }
    const size = canonicalBytes(envelope).byteLength;
    if (size > MAX_PAYLOAD_BYTES) {
      ctx.addIssue({
        code: "custom",
        path: [],
        message: `canonical payload is ${size} bytes, limit is ${MAX_PAYLOAD_BYTES}`,
      });
    }
  });

export type PassportEnvelope = z.infer<typeof passportEnvelopeSchema>;
export type CaskData = z.infer<typeof caskDataSchema>;
export type BottleData = z.infer<typeof bottleDataSchema>;
