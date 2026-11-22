import { describe, expect, it } from "vitest";
import { buildData, draftFromData, emptyDraft } from "@/features/write/lib/draft";
import { mintDefaults } from "@/features/write/lib/mint-defaults";
import { buildSuccessorEnvelope, checkEnvelope } from "@/features/write/lib/successor";

const CID = "bafkreibnugdjrt4xfyb4untqebjbktbq7lhbbxbiwtlgcefchoioao6dhm";

const caskDraft = () => ({
  fields: {
    distillery: "Demo Distillery",
    caskType: "Bourbon barrel",
    caskNumber: "1",
    volumeLiters: "200",
    alcoholByVolume: "63.5",
    fillDate: "2026-10-01",
  },
  sourceCasks: [],
});

const envelopeOf = (kind: "cask" | "bottle", data: Record<string, unknown>) => ({
  schema: "idpp-passport/1",
  deploymentId: "whisky-v2-final",
  tokenId: "97000000000000",
  revision: "0",
  previousCid: null,
  kind,
  granularity: "item",
  data,
});

describe("buildData", () => {
  it.each([
    ["cask", "item"],
    ["cask", "batch"],
    ["bottle", "item"],
    ["bottle", "batch"],
  ] as const)("accepts the %s %s mint defaults without editing", (kind, granularity) => {
    const data = buildData(kind, granularity, mintDefaults(kind));
    expect(checkEnvelope({ ...envelopeOf(kind, data), granularity })).toMatchObject({ ok: true });
  });

  it("builds the shared test vector's cask data and validates", () => {
    const data = buildData("cask", "item", caskDraft());
    expect(data).toEqual({
      distillery: "Demo Distillery",
      caskType: "Bourbon barrel",
      caskNumber: "1",
      volumeLiters: "200",
      alcoholByVolume: "63.5",
      fillDate: "2026-10-01",
    });
    const check = checkEnvelope(envelopeOf("cask", data));
    expect(check).toMatchObject({
      ok: true,
      predictedCid: "bafkreibnugdjrt4xfyb4untqebjbktbq7lhbbxbiwtlgcefchoioao6dhm",
    });
  });

  it("emits origin only when filled and optional text only when non-empty", () => {
    const draft = caskDraft();
    draft.fields = {
      ...draft.fields,
      originCountry: "Scotland",
      originRegion: "Islay",
      description: " ",
    } as never;
    const data = buildData("cask", "item", draft);
    expect(data.origin).toEqual({ country: "Scotland", region: "Islay" });
    expect("description" in data).toBe(false);
  });

  it("keeps required keys even when empty so validation names them", () => {
    const data = buildData("cask", "item", emptyDraft());
    expect(data.distillery).toBe("");
    expect(checkEnvelope(envelopeOf("cask", data))).toMatchObject({ ok: false });
  });

  it("adds quantity and unit for batches only", () => {
    const draft = caskDraft();
    draft.fields = { ...draft.fields, quantity: "10", unit: "casks" } as never;
    expect("quantity" in buildData("cask", "item", draft)).toBe(false);
    const batch = buildData("cask", "batch", draft);
    expect(batch).toMatchObject({ quantity: "10", unit: "casks" });
    expect(checkEnvelope({ ...envelopeOf("cask", batch), granularity: "batch" })).toMatchObject({
      ok: true,
    });
  });

  it("builds a bottle with source casks", () => {
    const data = buildData("bottle", "item", {
      fields: {
        brand: "Demo",
        bottleType: "Single malt",
        bottledDate: "2026-10-02",
        volumeMl: "700",
        alcoholByVolume: "43",
      },
      sourceCasks: [
        { tokenId: "97000000000000", revision: "1", volumeMl: "700" },
        { tokenId: "", revision: "", volumeMl: "" },
      ],
    });
    expect(data.sourceCasks).toEqual([
      { tokenId: "97000000000000", revision: "1", volumeMl: "700" },
    ]);
    expect(checkEnvelope(envelopeOf("bottle", data))).toMatchObject({ ok: true });
  });

  it("round-trips through draftFromData", () => {
    const draft = caskDraft();
    draft.fields = { ...draft.fields, originCountry: "Scotland", originRegion: "Islay" } as never;
    const data = buildData("cask", "item", draft);
    expect(buildData("cask", "item", draftFromData(data))).toEqual(data);
  });
});

describe("buildSuccessorEnvelope", () => {
  it("increments the revision, links previousCid and keeps identity fields", () => {
    const current = checkEnvelope(envelopeOf("cask", buildData("cask", "item", caskDraft())));
    if (!current.ok) throw new Error(current.message);
    const next = buildSuccessorEnvelope(current.envelope, CID, {
      ...current.envelope.data,
      description: "re-racked",
    });
    expect(next).toMatchObject({
      tokenId: "97000000000000",
      revision: "1",
      previousCid: CID,
      kind: "cask",
      deploymentId: "whisky-v2-final",
    });
    expect(checkEnvelope(next)).toMatchObject({ ok: true });
  });
});
