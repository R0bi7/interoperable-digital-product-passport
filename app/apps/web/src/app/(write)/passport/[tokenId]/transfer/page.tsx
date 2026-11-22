import { notFound } from "next/navigation";
import { TransferForm } from "@/features/write/components/transfer-form";
import { PageShell } from "@/features/write/components/ui";
import { parseTokenId } from "@/features/write/lib/token-id";

export const metadata = { title: "Transfer passport ownership" };

export default async function TransferPage({ params }: { params: Promise<{ tokenId: string }> }) {
  const tokenId = parseTokenId((await params).tokenId);
  if (tokenId === undefined) notFound();
  return (
    <PageShell
      wide
      title={`Transfer passport ${tokenId}`}
      back={{ href: `/passport/${tokenId}`, label: "Back to passport" }}
      lead="Give the passport token to another holder on the chain where it is now. The token id and the passport record stay the same."
    >
      <TransferForm tokenId={tokenId} />
    </PageShell>
  );
}
