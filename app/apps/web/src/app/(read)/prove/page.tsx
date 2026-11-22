import { ProveOwner } from "@/features/read/components/prove-owner";
import { PageShell } from "@/features/write/components/ui";

export const metadata = { title: "Prove ownership" };

export default function ProveOwnershipPage() {
  return (
    <PageShell wide title="Prove ownership" back={{ href: "/", label: "All passports" }}>
      <ProveOwner />
    </PageShell>
  );
}
