"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { checkReadiness, type ReadinessItem } from "./readiness";

function Checks({ title, items }: { title: string; items: ReadinessItem[] }) {
  return (
    <section className="min-w-0 space-y-2">
      <h3 className="font-medium">{title}</h3>
      <ul className="space-y-2 text-sm">
        {items.map((item) => (
          <li key={item.label} className="[overflow-wrap:anywhere]">
            <span className={item.ok ? "text-success" : "text-warning"}>
              {item.label}: {item.ok ? "Passed" : "Needs attention"}
            </span>
            <p className="text-xs leading-relaxed text-muted-foreground">{item.detail}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ReadinessPanel() {
  const { address } = useAccount();
  const query = useQuery({
    queryKey: ["demo-readiness", address],
    queryFn: () => checkReadiness(address),
    enabled: false,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const data = query.data;
  const passed =
    data?.indexer.every((i) => i.ok) &&
    data.chains.every((i) => i.ok) &&
    data.publication?.publicationConfigured &&
    data.publication.allowlisted === true;
  return (
    <section aria-labelledby="readiness-title" className="rounded-xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="readiness-title" className="font-semibold">
            Demonstrator readiness
          </h2>
          <p role="status" className="mt-1 text-sm text-muted-foreground">
            {query.isFetching
              ? "Checking services…"
              : query.isError
                ? "Checks unavailable. Try again."
                : !data
                  ? "Check services before presenting."
                  : passed
                    ? "Preflight checks passed. Upload and delivery are still untested."
                    : "Some checks need attention before the live demonstration."}
          </p>
        </div>
        <Button
          variant="outline"
          className="min-h-11"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {query.isFetching ? "Checking…" : data ? "Check again" : "Check readiness"}
        </Button>
      </div>
      {data && (
        <details className="mt-3" open>
          <summary className="w-fit cursor-pointer py-2 text-sm">Readiness details</summary>
          <div className="mt-3 grid gap-6 border-t pt-4 md:grid-cols-3">
            <Checks title="Indexer catch-up" items={data.indexer} />
            <Checks title="Browser chain access" items={data.chains} />
            <section className="space-y-2 text-sm">
              <h3 className="font-medium">Publication and wallet</h3>
              <p
                className={
                  data.publication?.publicationConfigured ? "text-success" : "text-warning"
                }
              >
                {data.publication?.publicationConfigured
                  ? "Server configuration present."
                  : "Server publication configuration unavailable or invalid."}
              </p>
              <p className={data.publication?.allowlisted ? "text-success" : "text-warning"}>
                {!address
                  ? "Connect the presenting issuer wallet, then check again."
                  : data.publication?.allowlisted === true
                    ? "Connected wallet is allowlisted for mint requests."
                    : data.publication?.allowlisted === false
                      ? "Connected wallet is not allowlisted for mint requests."
                      : "Wallet allowlist check unavailable."}
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Configuration does not test upload credentials, issuer roles, gas balances or
                delivery. A rehearsal checks those.
              </p>
            </section>
          </div>
          {query.dataUpdatedAt > 0 && (
            <p className="mt-4 text-xs text-muted-foreground">
              Snapshot checked at {new Date(query.dataUpdatedAt).toLocaleTimeString()}. Check again
              after changing services or wallets.
            </p>
          )}
        </details>
      )}
    </section>
  );
}
