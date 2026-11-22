import { notFound } from "next/navigation";
import { PassportDetail } from "@/features/read/components/passport-detail";
import { parseTokenId } from "@/features/read/token-id";

export default async function PassportPage({
  params,
  searchParams,
}: {
  params: Promise<{ tokenId: string }>;
  searchParams: Promise<{ deployment?: string | string[] }>;
}) {
  const { tokenId } = await params;
  // Canonical decimal only, so one passport has one URL; ids are strings until BigInt is needed.
  const id = parseTokenId(tokenId);
  if (id === null) notFound();
  const { deployment } = await searchParams;
  const deploymentId = Array.isArray(deployment) ? deployment[0] : deployment;
  return <PassportDetail tokenId={id.toString()} deploymentId={deploymentId} />;
}
