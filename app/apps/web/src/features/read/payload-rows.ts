import type { PassportEnvelope } from "@idpp/passport-config";

export type PayloadRow = {
  label: string;
  value: string;
  /** A date inside `data`: a domain assertion by the issuer, not chain evidence. */
  domainDate?: boolean;
  /** Decimal token id this row refers to, rendered as a link to its passport. */
  tokenId?: string;
};

const row = (label: string, value: string | undefined, extra: Partial<PayloadRow> = {}) =>
  value === undefined ? [] : [{ label, value, ...extra }];

/** Read-only rows for the `data` of a cask or bottle envelope. */
export function payloadRows(envelope: PassportEnvelope): PayloadRow[] {
  const rows: PayloadRow[] = [
    ...row("Kind", envelope.kind),
    ...row("Granularity", envelope.granularity),
  ];
  if (envelope.kind === "cask") {
    const d = envelope.data;
    rows.push(
      ...row("Distillery", d.distillery),
      ...row("Cask type", d.caskType),
      ...row("Cask number", d.caskNumber),
      ...row("Volume (liters)", d.volumeLiters),
      ...row("Alcohol by volume (%)", d.alcoholByVolume),
      ...row("Fill date", d.fillDate, { domainDate: true }),
      ...row("Origin country", d.origin?.country),
      ...row("Origin region", d.origin?.region),
      ...row("Quantity", d.quantity),
      ...row("Unit", d.unit),
      ...row("Description", d.description),
    );
  } else {
    const d = envelope.data;
    rows.push(
      ...row("Brand", d.brand),
      ...row("Bottle type", d.bottleType),
      ...row("Bottled date", d.bottledDate, { domainDate: true }),
      ...row("Volume (ml)", d.volumeMl),
      ...row("Alcohol by volume (%)", d.alcoholByVolume),
      ...row("Quantity", d.quantity),
      ...row("Unit", d.unit),
      ...row("Description", d.description),
    );
    for (const source of d.sourceCasks ?? []) {
      rows.push({
        label: "Source cask",
        value: `${source.tokenId}, revision ${source.revision}, ${source.volumeMl} ml`,
        tokenId: source.tokenId,
      });
    }
  }
  return rows;
}
