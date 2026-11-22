import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type NoticeTone = "error" | "warn" | "ok" | "info";

const TONE: Record<NoticeTone, { box: string; icon: typeof Info; role: "alert" | "status" }> = {
  error: {
    box: "border-destructive/40 bg-danger-soft text-destructive",
    icon: AlertCircle,
    role: "alert",
  },
  warn: {
    box: "border-warning/40 bg-warning-soft text-warning",
    icon: TriangleAlert,
    role: "alert",
  },
  ok: { box: "border-success/40 bg-success-soft text-success", icon: CheckCircle2, role: "status" },
  info: { box: "border-border bg-card text-card-foreground", icon: Info, role: "status" },
};

/** An inline message: errors and warnings are announced at once, the rest politely. */
export function Notice({
  tone,
  children,
  className,
}: {
  tone: NoticeTone;
  children: ReactNode;
  className?: string;
}) {
  const { box, icon: Icon, role } = TONE[tone];
  return (
    <div
      role={role}
      className={cn("flex gap-2.5 rounded-lg border px-3 py-2.5 text-sm", box, className)}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1 [&_a]:underline [&_a]:underline-offset-2">
        {children}
      </div>
    </div>
  );
}
