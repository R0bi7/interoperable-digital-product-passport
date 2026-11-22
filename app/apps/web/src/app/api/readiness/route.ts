import { isAddress } from "viem";
import { getServerEnv } from "@/lib/env.server";

export const dynamic = "force-dynamic";

/** Configuration only: no pins, challenges, signatures or transactions. Never returns secrets. */
export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address");
  let publicationConfigured = false;
  let allowlisted: boolean | null = null;
  try {
    const env = getServerEnv();
    publicationConfigured = true;
    if (address && isAddress(address)) {
      allowlisted = env.ISSUER_ALLOWLIST.includes(address.toLowerCase() as `0x${string}`);
    }
  } catch {
    // Deliberately do not return validation errors, variable values or credentials.
  }
  return Response.json(
    { publicationConfigured, allowlisted },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
