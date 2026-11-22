import type { PassportEnvelope } from "@idpp/passport-config";

export type Kind = PassportEnvelope["kind"];
export type Granularity = PassportEnvelope["granularity"];

export type FieldDef = {
  key: string;
  label: string;
  required: boolean;
  type?: "date" | "textarea";
  hint?: string;
};

const CASK_FIELDS: FieldDef[] = [
  { key: "distillery", label: "Distillery", required: true },
  { key: "caskType", label: "Cask type", required: true },
  { key: "caskNumber", label: "Cask number", required: true },
  { key: "volumeLiters", label: "Volume (liters)", required: true, hint: "decimal, e.g. 200" },
  { key: "alcoholByVolume", label: "Alcohol by volume (%)", required: true, hint: "e.g. 63.5" },
  { key: "fillDate", label: "Fill date", required: true, type: "date" },
  { key: "originCountry", label: "Origin country", required: false },
  { key: "originRegion", label: "Origin region", required: false },
  { key: "description", label: "Description", required: false, type: "textarea" },
];

const BOTTLE_FIELDS: FieldDef[] = [
  { key: "brand", label: "Brand", required: true },
  { key: "bottleType", label: "Bottle type", required: true },
  { key: "bottledDate", label: "Bottled date", required: true, type: "date" },
  { key: "volumeMl", label: "Volume (ml)", required: true, hint: "decimal, e.g. 700" },
  { key: "alcoholByVolume", label: "Alcohol by volume (%)", required: true, hint: "e.g. 43" },
  { key: "description", label: "Description", required: false, type: "textarea" },
];

const BATCH_FIELDS: FieldDef[] = [
  { key: "quantity", label: "Quantity", required: true, hint: "decimal" },
  { key: "unit", label: "Unit", required: true, hint: "e.g. bottles" },
];

/** Form fields of a kind; batch passports add quantity and unit. */
export function fieldsFor(kind: Kind, granularity: Granularity): FieldDef[] {
  const base = kind === "cask" ? CASK_FIELDS : BOTTLE_FIELDS;
  return granularity === "batch" ? [...base, ...BATCH_FIELDS] : base;
}

export type SourceCaskRow = { tokenId: string; revision: string; volumeMl: string };

/** Flat string state of the data form. */
export type Draft = { fields: Record<string, string>; sourceCasks: SourceCaskRow[] };

export const emptyDraft = (): Draft => ({ fields: {}, sourceCasks: [] });

const isFilled = (value: string | undefined): value is string =>
  value !== undefined && value.trim() !== "";

/**
 * Form state to the envelope's `data` object. Required keys are always emitted (an empty value
 * then fails schema validation with a precise message); optional keys only when filled.
 */
export function buildData(
  kind: Kind,
  granularity: Granularity,
  draft: Draft,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const field of fieldsFor(kind, granularity)) {
    if (field.key === "originCountry" || field.key === "originRegion") continue;
    const value = (draft.fields[field.key] ?? "").trim();
    if (field.required || isFilled(value)) data[field.key] = value;
  }
  if (kind === "cask") {
    const country = (draft.fields.originCountry ?? "").trim();
    const region = (draft.fields.originRegion ?? "").trim();
    if (country !== "" || region !== "") data.origin = { country, region };
  } else {
    const rows = draft.sourceCasks.filter(
      (row) => isFilled(row.tokenId) || isFilled(row.revision) || isFilled(row.volumeMl),
    );
    if (rows.length > 0) {
      data.sourceCasks = rows.map((row) => ({
        tokenId: row.tokenId.trim(),
        revision: row.revision.trim(),
        volumeMl: row.volumeMl.trim(),
      }));
    }
  }
  return data;
}

/** Inverse of `buildData`, used to prefill the revise form from the current payload. */
export function draftFromData(data: Record<string, unknown>): Draft {
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") fields[key] = value;
  }
  const origin = data.origin as { country?: string; region?: string } | undefined;
  if (origin) {
    fields.originCountry = origin.country ?? "";
    fields.originRegion = origin.region ?? "";
  }
  const sourceCasks = Array.isArray(data.sourceCasks)
    ? (data.sourceCasks as SourceCaskRow[]).map((row) => ({
        tokenId: String(row.tokenId),
        revision: String(row.revision),
        volumeMl: String(row.volumeMl),
      }))
    : [];
  return { fields, sourceCasks };
}
