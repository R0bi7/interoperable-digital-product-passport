import type { PassportEnvelope } from "@idpp/passport-config";
import Link from "next/link";
import { payloadRows } from "../payload-rows";
import { passportPath } from "../token-id";

/** Read-only `data` of a verified envelope. Dates are domain assertions, labelled as such. */
export function PayloadView({ envelope }: { envelope: PassportEnvelope }) {
  const rows = payloadRows(envelope);
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:gap-y-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
      {rows.map((entry, index) => (
        // The same label can repeat (several source casks), so the index disambiguates.
        // biome-ignore lint/suspicious/noArrayIndexKey: static, read-only list
        <div key={`${entry.label}-${index}`} className="flex flex-col gap-0.5 sm:contents">
          <dt className="text-muted-foreground">{entry.label}</dt>
          <dd className="min-w-0 [overflow-wrap:anywhere]">
            {entry.tokenId ? (
              <Link
                className="font-mono underline underline-offset-2"
                href={passportPath(entry.tokenId)}
              >
                {entry.value}
              </Link>
            ) : (
              entry.value
            )}
            {entry.domainDate && (
              <span className="ml-2 text-xs text-muted-foreground">
                (domain assertion by the issuer, not chain evidence)
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
