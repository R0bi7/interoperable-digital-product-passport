import "server-only";
import { locatePassport } from "@/features/write/lib/locate";
import { fetchVerifiedPayload } from "@/features/write/lib/payload";
import { publicEnv } from "@/lib/env";
import { getPublicClient } from "@/lib/operator/clients";
import { type SourceCask, validateSourceCasks } from "@/lib/operator/source-casks";

/** Server adapter: live chain reads and bounded gateway retrieval, without an indexer. */
export function validateLiveSourceCasks(sourceCasks: readonly SourceCask[]): Promise<void> {
  return validateSourceCasks(sourceCasks, {
    locate: (tokenId) => locatePassport(getPublicClient, tokenId),
    fetchPayload: (cid, record, signal) =>
      fetchVerifiedPayload(publicEnv.NEXT_PUBLIC_PINATA_GATEWAY, cid, record, fetch, signal),
  });
}
