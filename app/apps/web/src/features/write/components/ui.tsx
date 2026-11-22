"use client";

import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { txUrl } from "@/features/write/lib/links";
import { cn } from "@/lib/utils";

export { Notice } from "@/components/notice";

const control =
  "h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground hover:border-ring/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50";

/** Class for native `<input>` and `<select>` controls in the write forms. */
export const inputClass = control;
export const buttonClass = cn(buttonVariants({ size: "lg" }), "h-10 px-4");
export const secondaryButtonClass = buttonVariants({ variant: "outline", size: "default" });

export const actionLayoutClass = "grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]";

/** Shared action summary and feedback, aligned with the mint review panel. */
export function ActionPanel({
  title,
  busy = false,
  children,
}: {
  title: string;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <aside
      aria-label={title}
      aria-busy={busy}
      className="min-w-0 space-y-5 rounded-xl border bg-card p-5 [overflow-wrap:anywhere] lg:sticky lg:top-48 xl:top-40 [&_button]:h-auto [&_button]:min-h-11 [&_button]:max-w-full [&_button]:whitespace-normal [&_button]:py-2"
    >
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {children}
    </aside>
  );
}

export function PageShell({
  title,
  lead,
  back,
  children,
  wide = false,
}: {
  title: string;
  lead?: ReactNode;
  back?: { href: string; label: string };
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={cn("mx-auto flex flex-col gap-8", wide ? "max-w-6xl" : "max-w-3xl")}>
      <PageHeader title={title} lead={lead} back={back} />
      {children}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <Label className="flex flex-col items-stretch gap-1.5 text-sm leading-normal">
      <span className="font-medium">{label}</span>
      {children}
      {hint ? <span className="text-xs font-normal text-muted-foreground">{hint}</span> : null}
    </Label>
  );
}

export function TxLink({ chainId, hash }: { chainId: number; hash: string }) {
  const url = txUrl(chainId, hash);
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className="break-all font-mono underline">
      {hash}
    </a>
  ) : (
    <span className="break-all font-mono">{hash}</span>
  );
}
