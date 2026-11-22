import { MintForm } from "@/features/write/components/mint-form";
import { PageShell } from "@/features/write/components/ui";

export const metadata = { title: "Mint a passport" };

export default function MintPage() {
  return (
    <PageShell
      wide
      title="Mint a passport"
      back={{ href: "/", label: "All passports" }}
      lead="Only allowlisted issuers can mint. You sign a one-time challenge; the server pins the verified payload and mints with the operator key to the recipient below."
    >
      <MintForm />
    </PageShell>
  );
}
