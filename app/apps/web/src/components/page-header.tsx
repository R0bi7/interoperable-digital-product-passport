import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

/** Page title with an optional back link and a short lead paragraph. */
export function PageHeader({
  title,
  lead,
  back,
  actions,
}: {
  title: ReactNode;
  lead?: ReactNode;
  back?: { href: string; label: string };
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      {back ? (
        <Link
          href={back.href}
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="size-3.5" />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="min-w-0 break-words text-3xl font-medium tracking-tight sm:text-4xl">
          {title}
        </h1>
        {actions}
      </div>
      {lead ? <p className="max-w-prose text-sm text-muted-foreground">{lead}</p> : null}
    </div>
  );
}
