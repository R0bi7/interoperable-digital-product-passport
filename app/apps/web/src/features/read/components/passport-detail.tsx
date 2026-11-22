"use client";

import { MANIFEST, originOf } from "@idpp/passport-config";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightLeft, PenLine, UserRoundPen } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getContractAddress } from "@/lib/chains";
import type { PassportSummary } from "@/lib/indexer/client";
import { compareLive, type LiveRecord } from "../live";
import {
  assuranceMessage,
  currentLiveRecord,
  passportQuery,
  liveQuery as readLiveQuery,
  revisionQueryKey,
} from "../queries";
import { getReadSources } from "../sources";
import { addressUrl, chainName, formatTimestamp, txUrl } from "../timeline";
import { type RevisionVerification, verifyPassport } from "../verification";
import { StatusBadge, VerificationBadge } from "./badges";
import { MockBanner } from "./mock-banner";
import { PassportQr } from "./passport-qr";
import { PayloadView } from "./payload-view";
import { TimelineView } from "./timeline-view";
import { VerificationSummary } from "./verification-summary";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-4 border-t pt-6">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function Warning({ children }: { children: ReactNode }) {
  return <Notice tone="warn">{children}</Notice>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="Loading passport">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-44 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

function AddressLink({ chainId, address }: { chainId: number; address: string }) {
  const url = addressUrl(chainId, address);
  return url ? (
    <a
      className="font-mono underline underline-offset-2"
      href={url}
      target="_blank"
      rel="noreferrer"
    >
      {address}
    </a>
  ) : (
    <span className="font-mono">{address}</span>
  );
}

const SOURCE_NOTE = {
  indexed: "CID from the indexer",
  live: "CID from passportOf on chain (live read)",
  "live-only": "CID from passportOf on chain; not in the indexer yet",
} as const;

function RevisionCard({
  entry,
  summaryRevision,
}: {
  entry: RevisionVerification;
  summaryRevision?: PassportSummary["revisions"][number];
}) {
  const reasons = (["content", "binding", "history", "recorded"] as const).flatMap((name) => {
    const check = entry[name];
    return check.reason ? [{ name, reason: check.reason, status: check.status }] : [];
  });
  return (
    <li className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">Revision {entry.revision}</h3>
        {summaryRevision && (
          <span className="text-xs text-muted-foreground">
            {chainName(summaryRevision.chainId)}, {formatTimestamp(summaryRevision.timestamp)},{" "}
            {txUrl(summaryRevision.chainId, summaryRevision.txHash) ? (
              <a
                className="underline underline-offset-2"
                href={txUrl(summaryRevision.chainId, summaryRevision.txHash)}
                target="_blank"
                rel="noreferrer"
              >
                tx
              </a>
            ) : null}
          </span>
        )}
      </div>
      <div className="text-xs leading-relaxed">
        <span className="break-all font-mono">{entry.cid}</span>
        <span className="ml-2 text-muted-foreground">{SOURCE_NOTE[entry.source]}</span>
      </div>
      {entry.conflict && (
        <Warning>
          The indexer saw conflicting CIDs for this revision, or its CID differs from the live read.
        </Warning>
      )}
      <div className="flex flex-wrap gap-2">
        <VerificationBadge name="content" check={entry.content} />
        <VerificationBadge name="binding" check={entry.binding} />
        <VerificationBadge name="history" check={entry.history} />
        <VerificationBadge name="recorded" check={entry.recorded} />
      </div>
      {reasons.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-muted-foreground">
          {reasons.map((r) => (
            <li key={r.name}>
              {r.name}: {r.reason}
            </li>
          ))}
        </ul>
      )}
      {entry.envelope && (
        <details open={entry.history.status !== "unavailable" && entry.source !== "indexed"}>
          <summary className="min-h-11 w-fit cursor-pointer py-3 text-sm font-medium">
            Payload data
          </summary>
          <div className="mt-2">
            <PayloadView envelope={entry.envelope} />
          </div>
        </details>
      )}
    </li>
  );
}

function LivePanel({
  summary,
  live,
  error,
  loading,
}: {
  summary: PassportSummary;
  live?: LiveRecord;
  error?: Error | null;
  loading: boolean;
}) {
  if (summary.currentChainId === null) {
    return (
      <p className="text-sm text-muted-foreground">
        No live confirmation: the indexer does not place the token on a single chain (
        {summary.status === "in_flight" ? "in flight" : "incomplete"}).
      </p>
    );
  }
  if (loading) {
    return <Skeleton role="status" aria-label="Reading on chain" className="h-10 w-full" />;
  }
  if (error || !live) {
    return (
      <Warning>
        Live read on {chainName(summary.currentChainId)} failed
        {error ? `: ${error.message}` : ""}. Showing indexer values only.
      </Warning>
    );
  }
  const comparison = compareLive(summary, live);
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>
        Read <code>ownerOf</code> and <code>passportOf</code> on {chainName(live.chainId)} in one
        multicall at block <span className="font-mono">{live.blockNumber.toString()}</span>.
      </p>
      {comparison.agrees ? (
        <p className="font-medium text-success">The live read agrees with the indexer.</p>
      ) : (
        <Warning>
          The indexer is behind or inconsistent.{" "}
          {live.owner === null
            ? "The chain does not hold the token at this block, so the indexer values above are unconfirmed."
            : "The values shown above are the live ones."}
          <ul className="mt-1 list-disc pl-5">
            {comparison.differences.map((difference) => (
              <li key={difference}>{difference}</li>
            ))}
          </ul>
        </Warning>
      )}
    </div>
  );
}

export function PassportDetail({
  tokenId,
  deploymentId,
}: {
  tokenId: string;
  deploymentId?: string;
}) {
  const id = BigInt(tokenId);
  const sources = getReadSources();

  const summaryQuery = useQuery({
    queryKey: ["passport", sources.mode, tokenId],
    queryFn: passportQuery(sources, id),
  });
  const summary = summaryQuery.data ?? undefined;
  const currentChainId = summary?.currentChainId ?? null;

  const liveQuery = useQuery({
    queryKey: ["live", sources.mode, tokenId, currentChainId],
    enabled: currentChainId !== null,
    queryFn: readLiveQuery(sources, currentChainId as number, id),
    retry: 1,
  });
  const liveSettled = currentChainId === null || liveQuery.isSuccess || liveQuery.isError;
  const live = currentLiveRecord(liveQuery);
  const liveRef =
    live && live.owner !== null && live.revision !== null && live.cid !== null
      ? { revision: live.revision, cid: live.cid, historyHash: live.historyHash }
      : null;

  const revisionKey = summary ? revisionQueryKey(summary.revisions) : undefined;
  const verifyQuery = useQuery({
    queryKey: [
      "verify",
      sources.mode,
      tokenId,
      revisionKey,
      currentChainId,
      summary?.status,
      liveQuery.error?.message,
      liveRef?.revision,
      liveRef?.cid,
      liveRef?.historyHash,
    ],
    enabled: !!summary && liveSettled,
    retry: false,
    queryFn: () =>
      verifyPassport({
        deploymentId: MANIFEST.deploymentId,
        tokenId,
        revisions: (summary as PassportSummary).revisions,
        live: liveRef,
        liveError:
          liveQuery.error?.message ??
          (summary?.status === "in_flight"
            ? "token in flight"
            : "indexer incomplete or token absent on the named chain"),
        readReceipt: sources.readReceipt,
        fetchPayload: sources.fetchPayload,
      }),
  });

  const scenarioQuery = useQuery({
    queryKey: ["scenario", tokenId],
    enabled: sources.mode === "mock",
    queryFn: () => sources.scenario?.(id),
  });

  const labelWarning =
    deploymentId !== undefined && deploymentId !== MANIFEST.deploymentId ? (
      <Warning>
        This label was printed for <code>{deploymentId}</code>; this app serves{" "}
        <code>{MANIFEST.deploymentId}</code>; the id may name an unrelated token.
      </Warning>
    ) : null;
  if (summaryQuery.isPending)
    return (
      <div className="flex flex-col gap-3">
        {labelWarning}
        <DetailSkeleton />
      </div>
    );
  if (summaryQuery.isError) {
    return (
      <div className="flex flex-col gap-3">
        {labelWarning}
        <Notice tone="error">
          Could not load passport <span className="font-mono">{tokenId}</span>:{" "}
          {summaryQuery.error.message}
        </Notice>
      </div>
    );
  }
  if (!summary) {
    return (
      <div className="flex flex-col gap-3">
        {labelWarning}
        {sources.mode === "mock" && <MockBanner />}
        <Notice tone="info">
          <p>
            The indexer does not know token <span className="font-mono break-all">{tokenId}</span>.
            It may not be issued yet, or the indexer has not reached its block.
          </p>
        </Notice>
        <Link className={`${buttonVariants({ variant: "outline" })} w-fit`} href="/">
          Back to the list
        </Link>
      </div>
    );
  }

  const comparison = live ? compareLive(summary, live) : undefined;
  const useLive = !!live && !!liveRef && comparison !== undefined && !comparison.agrees;
  const shown = {
    owner: useLive ? live.owner : summary.owner,
    revision: useLive ? live.revision : summary.revision,
    cid: useLive ? live.cid : summary.cid,
  };
  const origin = originOf(id);
  const originChain = Number(origin); // chain ids are small; only token ids need bigint
  const contract = currentChainId === null ? undefined : getContractAddress(currentChainId);
  const lagging = summary.progress.filter((p) => BigInt(p.indexedBlock) < BigInt(p.latestBlock));

  return (
    <div className="flex flex-col gap-8">
      {sources.mode === "mock" && <MockBanner scenario={scenarioQuery.data} />}

      {labelWarning}
      {summary.deploymentId !== MANIFEST.deploymentId && (
        <Warning>
          The indexer reports deployment <code>{summary.deploymentId}</code>, this app is configured
          for <code>{MANIFEST.deploymentId}</code>. Verification uses the configured deployment.
        </Warning>
      )}
      {summary.originChainId !== originChain && (
        <Warning>
          The indexer reports origin chain {summary.originChainId}, but the id prefix says{" "}
          {originChain}. The id prefix is authoritative.
        </Warning>
      )}

      <PageHeader
        title={<span className="font-mono [overflow-wrap:anywhere]">{tokenId}</span>}
        back={{ href: "/", label: "All passports" }}
        actions={<StatusBadge status={summary.status} />}
      />
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section className="min-w-0 space-y-5" aria-label="Passport record">
          <h2 className="text-lg font-semibold tracking-tight">Passport record</h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-y-3">
            <Field label="Origin (originOf)">
              {chainName(originChain)} ({origin.toString()})
            </Field>
            <Field label="Deployment">
              <span className="font-mono">{MANIFEST.deploymentId}</span>
            </Field>
            <Field label="Current chain">
              {currentChainId === null ? "unknown" : chainName(currentChainId)}
            </Field>
            <Field label="Contract">
              {currentChainId !== null && contract ? (
                <AddressLink chainId={currentChainId} address={contract} />
              ) : (
                "unknown"
              )}
            </Field>
            <Field label="Owner">
              {shown.owner && currentChainId !== null ? (
                <AddressLink chainId={currentChainId} address={shown.owner} />
              ) : (
                (shown.owner ?? "unknown")
              )}
            </Field>
            <Field label="Revision">
              <span className="font-mono">{shown.revision ?? "unknown"}</span>
            </Field>
            <Field label="CID">
              <span className="font-mono">{shown.cid ?? "unknown"}</span>
            </Field>
          </dl>
        </section>
        <aside aria-label="Passport actions" className="min-w-0 rounded-xl border bg-card p-5">
          <h2 className="mb-4 text-lg font-semibold tracking-tight">Passport actions</h2>
          <div className="grid gap-3 [&_a]:min-h-11 [&_a]:whitespace-normal">
            <Link
              href={`/passport/${tokenId}/revise`}
              className={buttonVariants({ variant: "outline", size: "lg" })}
            >
              <PenLine aria-hidden data-icon="inline-start" />
              Revise
            </Link>
            <Link
              href={`/passport/${tokenId}/transfer`}
              className={buttonVariants({ variant: "outline", size: "lg" })}
            >
              <UserRoundPen aria-hidden data-icon="inline-start" />
              Transfer ownership
            </Link>
            <Link href={`/passport/${tokenId}/send`} className={buttonVariants({ size: "lg" })}>
              <ArrowRightLeft aria-hidden data-icon="inline-start" />
              Send to another chain
            </Link>
            <Link
              href={`/passport/${tokenId}/verify-owner`}
              className={buttonVariants({ variant: "outline", size: "lg" })}
            >
              Verify owner
            </Link>
            <Link href="/prove" className={buttonVariants({ variant: "outline", size: "lg" })}>
              Prove ownership
            </Link>
          </div>
        </aside>
      </div>

      {summary.status !== "held" && (
        <Warning>
          {summary.status === "in_flight"
            ? "The token was sent and no matching receive is indexed yet, so no chain holds it right now."
            : "The indexer cannot place this token reliably (it is behind on a chain, or its observations conflict)."}
        </Warning>
      )}

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-8">
          <Section title="Live confirmation">
            <LivePanel
              summary={summary}
              live={live}
              error={liveQuery.error}
              loading={currentChainId !== null && liveQuery.isPending}
            />
          </Section>

          <Section title="Revisions and verification">
            {verifyQuery.data && (
              <VerificationSummary
                outcome={verifyQuery.data}
                simulated={sources.mode === "mock"}
                discoveryUncertain={
                  summary.status !== "held" ||
                  summary.deploymentId !== MANIFEST.deploymentId ||
                  (deploymentId !== undefined && deploymentId !== MANIFEST.deploymentId) ||
                  (comparison !== undefined && !comparison.agrees)
                }
              />
            )}

            <p className="text-sm text-muted-foreground">
              Checked in this browser on the raw bytes from the gateway: <b>content</b> (bytes hash
              to the CID), <b>binding</b> (envelope names this deployment, token and revision),{" "}
              <b>history</b> (each previousCid is the preceding revision's CID),{" "}
              <b>recorded on chain</b> (the emitting contract receipt confirms this CID, revision
              and author; timestamps remain indexer-sourced), and once for the passport{" "}
              <b>history hash</b> (the CIDs of every revision, in order, recompute the{" "}
              <code>historyHash</code> of the live <code>passportOf</code> read).
            </p>
            {verifyQuery.isPending && (
              <div className="flex flex-col gap-3" role="status" aria-label="Verifying payloads">
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-28 w-full" />
              </div>
            )}
            {verifyQuery.isError && (
              <Warning>Verification could not run: {verifyQuery.error.message}</Warning>
            )}
            {verifyQuery.data && assuranceMessage(summary, verifyQuery.data) && (
              <Warning>{assuranceMessage(summary, verifyQuery.data)}</Warning>
            )}
            {verifyQuery.data?.notes.map((note) => (
              <Warning key={note}>{note}</Warning>
            ))}
            {verifyQuery.data && (
              <div className="flex flex-col gap-1">
                <div>
                  <VerificationBadge name="history hash" check={verifyQuery.data.historyHash} />
                </div>
                {verifyQuery.data.historyHash.reason && (
                  <p className="text-xs text-muted-foreground">
                    history hash: {verifyQuery.data.historyHash.reason}
                  </p>
                )}
              </div>
            )}
            {verifyQuery.data && (
              <ol className="flex flex-col gap-3">
                {verifyQuery.data.entries.map((entry) => (
                  <RevisionCard
                    key={entry.revision}
                    entry={entry}
                    summaryRevision={summary.revisions.find((r) => r.revision === entry.revision)}
                  />
                ))}
              </ol>
            )}
            {verifyQuery.data?.entries.length === 0 && (
              <p className="text-sm text-muted-foreground">No revisions recorded.</p>
            )}
          </Section>
          <Section title="Timeline">
            <TimelineView timeline={summary.timeline} />
          </Section>
        </div>
        <aside aria-label="Sharing and indexer progress" className="min-w-0 space-y-8">
          <Section title="QR code">
            <PassportQr tokenId={tokenId} />
          </Section>

          {lagging.length > 0 && (
            <Section title="Indexer progress">
              <ul className="list-disc pl-5 text-sm text-muted-foreground">
                {lagging.map((p) => (
                  <li key={p.chainId}>
                    {chainName(p.chainId)}: indexed block {p.indexedBlock} of {p.latestBlock} (
                    {(BigInt(p.latestBlock) - BigInt(p.indexedBlock)).toString()} blocks behind)
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </aside>
      </div>
    </div>
  );
}
