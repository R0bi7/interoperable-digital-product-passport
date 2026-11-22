import { notFound } from "next/navigation";
import { VerifyOwner } from "@/features/read/components/verify-owner";
import { parseTokenId } from "@/features/read/token-id";
import { PageShell } from "@/features/write/components/ui";

export const metadata = { title: "Verify ownership" };

export default async function VerifyOwnerPage({
  params,
}: {
  params: Promise<{ tokenId: string }>;
}) {
  const { tokenId } = await params;
  const id = parseTokenId(tokenId);
  if (id === null) notFound();
  return (
    <PageShell
      wide
      title="Verify ownership"
      back={{ href: `/passport/${tokenId}`, label: "Back to passport" }}
    >
      <VerifyOwner tokenId={id.toString()} />
    </PageShell>
  );
}
