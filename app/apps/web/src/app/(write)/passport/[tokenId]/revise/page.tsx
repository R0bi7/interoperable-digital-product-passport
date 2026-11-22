import { notFound } from "next/navigation";
import { ReviseForm } from "@/features/write/components/revise-form";
import { PageShell } from "@/features/write/components/ui";
import { parseTokenId } from "@/features/write/lib/token-id";

export const metadata = { title: "Revise a passport" };

export default async function RevisePage({ params }: { params: Promise<{ tokenId: string }> }) {
  const tokenId = parseTokenId((await params).tokenId);
  if (tokenId === undefined) notFound();
  return (
    <PageShell
      wide
      title={`Revise passport ${tokenId}`}
      back={{ href: `/passport/${tokenId}`, label: "Back to passport" }}
      lead="Pin a new payload that supersedes the current one. The token keeps its id; its revision goes up by one."
    >
      <ReviseForm tokenId={tokenId} />
    </PageShell>
  );
}
