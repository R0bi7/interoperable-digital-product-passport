import type { Draft, Kind } from "./draft";

/** Editable sample data for quick demonstrator mints; no invented source-cask references. */
export function mintDefaults(kind: Kind): Draft {
  const common = { quantity: "12", unit: kind === "cask" ? "casks" : "bottles" };
  return {
    fields:
      kind === "cask"
        ? {
            ...common,
            distillery: "Demonstrator Distillery",
            caskType: "Ex-bourbon oak",
            caskNumber: "DEMO-001",
            volumeLiters: "200",
            alcoholByVolume: "63.5",
            fillDate: "2026-10-01",
            originCountry: "Scotland",
            originRegion: "Speyside",
            description: "Sample cask for demonstrator testing.",
          }
        : {
            ...common,
            brand: "Demonstrator Whisky",
            bottleType: "Single malt",
            bottledDate: "2026-10-01",
            volumeMl: "700",
            alcoholByVolume: "43",
            description: "Sample bottle for demonstrator testing.",
          },
    sourceCasks: [],
  };
}
