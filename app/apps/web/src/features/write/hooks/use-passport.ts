"use client";

import { MANIFEST } from "@idpp/passport-config";
import { useQuery } from "@tanstack/react-query";
import type { PublicClient } from "viem";
import { useConfig } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import { type Location, locatePassport } from "@/features/write/lib/locate";
import { fetchVerifiedPayload, type VerifiedPayload } from "@/features/write/lib/payload";
import { publicEnv } from "@/lib/env";

export type LoadedPassport = { location: Location; payload?: VerifiedPayload };

/**
 * Finds the chain holding `tokenId` and, when held, fetches and verifies the current payload
 * (content, then binding). Everything is read from the chain's authoritative `passportOf`.
 */
export function useLocatedPassport(tokenId: bigint) {
  const config = useConfig();
  const getClient = (chainId: number) =>
    getPublicClient(config, { chainId } as never) as unknown as PublicClient;

  return useQuery<LoadedPassport>({
    queryKey: ["write", "passport", tokenId.toString()],
    // Reads are a snapshot: the forms prepare writes against it, and a background refetch after a
    // send (token now gone from this chain) must not tear down the delivery panel. Reload is explicit.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    queryFn: async () => {
      const location = await locatePassport(getClient, tokenId);
      if (location.kind !== "held") return { location };
      const payload = await fetchVerifiedPayload(
        publicEnv.NEXT_PUBLIC_PINATA_GATEWAY,
        location.record.cid,
        { deploymentId: MANIFEST.deploymentId, tokenId, revision: location.record.revision },
      );
      return { location, payload };
    },
  });
}

/** Read client for a chain of the deployment, for use inside event handlers. */
export function usePublicClientFor() {
  const config = useConfig();
  return (chainId: number) =>
    getPublicClient(config, { chainId } as never) as unknown as PublicClient;
}
