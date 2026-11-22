import { CheckCircle2, CircleHelp, Plane, TriangleAlert, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { PassportStatus } from "@/lib/indexer/client";
import { cn } from "@/lib/utils";
import type { Check, CheckStatus } from "../verification";

const STATUS_LABEL: Record<PassportStatus, string> = {
  held: "held",
  in_flight: "in flight",
  incomplete: "incomplete",
};

const STATUS_STYLE: Record<PassportStatus, string> = {
  held: "bg-success-soft text-success",
  in_flight: "bg-info-soft text-info",
  incomplete: "bg-warning-soft text-warning",
};

const STATUS_ICON: Record<PassportStatus, ReactNode> = {
  held: <CheckCircle2 aria-hidden />,
  in_flight: <Plane aria-hidden />,
  incomplete: <TriangleAlert aria-hidden />,
};

const PILL =
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap [&>svg]:size-3.5";

export function statusLabel(status: PassportStatus): string {
  return STATUS_LABEL[status];
}

/** Where a passport is: `held`, `in flight`, or `incomplete` (the indexer cannot say). */
export function StatusBadge({ status }: { status: PassportStatus }) {
  return (
    <span data-status={status} className={cn(PILL, STATUS_STYLE[status])}>
      {STATUS_ICON[status]}
      {STATUS_LABEL[status]}
    </span>
  );
}

const CHECK_STYLE: Record<CheckStatus, string> = {
  verified: "bg-success-soft text-success",
  failed: "bg-danger-soft text-destructive",
  unconfirmed: "bg-warning-soft text-warning",
  unavailable: "bg-muted text-muted-foreground",
};

const CHECK_ICON: Record<CheckStatus, ReactNode> = {
  verified: <CheckCircle2 aria-hidden />,
  failed: <XCircle aria-hidden />,
  unconfirmed: <TriangleAlert aria-hidden />,
  unavailable: <CircleHelp aria-hidden />,
};

export type CheckName = "content" | "binding" | "history" | "history hash" | "recorded";

/**
 * One verification result: `content`, `binding` or `history` of a revision, or the passport's
 * `history hash`.
 */
export function VerificationBadge({ name, check }: { name: CheckName; check: Check }) {
  return (
    <span
      data-check={name === "recorded" ? "recorded on chain" : name}
      data-status={check.status}
      title={check.reason}
      className={cn(PILL, CHECK_STYLE[check.status])}
    >
      {CHECK_ICON[check.status]}
      {name === "recorded" ? "recorded on chain" : name}: {check.status}
    </span>
  );
}
