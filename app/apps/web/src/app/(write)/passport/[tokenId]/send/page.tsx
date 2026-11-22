import { notFound } from "next/navigation";
import { SendForm } from "@/features/write/components/send-form";
import { PageShell } from "@/features/write/components/ui";
import { parseTokenId } from "@/features/write/lib/token-id";

export const metadata = { title: "Send a passport to another chain" };

export default async function SendPage({ params }: { params: Promise<{ tokenId: string }> }) {
  const tokenId = parseTokenId((await params).tokenId);
  if (tokenId === undefined) notFound();
  return (
    <PageShell
      wide
      title={`Send passport ${tokenId}`}
      back={{ href: `/passport/${tokenId}`, label: "Back to passport" }}
      lead="Move the passport to another chain under the same token id. Its current revision and CID travel in the message."
    >
      <SendForm tokenId={tokenId} />
    </PageShell>
  );
}
