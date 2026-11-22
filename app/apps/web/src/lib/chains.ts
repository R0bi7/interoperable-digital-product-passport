import { getChain, MANIFEST, type ManifestChain } from "@idpp/passport-config";
import type { Chain } from "viem";
import { arbitrumSepolia, baseSepolia, sepolia } from "viem/chains";

const VIEM_CHAINS: Record<number, Chain> = {
  [arbitrumSepolia.id]: arbitrumSepolia,
  [baseSepolia.id]: baseSepolia,
  [sepolia.id]: sepolia,
};

function toViemChain(entry: ManifestChain): Chain {
  const chain = VIEM_CHAINS[entry.chainId];
  if (!chain)
    throw new Error(`no viem chain for manifest chain ${entry.network} (${entry.chainId})`);
  return chain;
}

/** viem chains of the deployment, in manifest order. */
export const supportedChains = MANIFEST.chains.map(toViemChain) as [Chain, ...Chain[]];

export function getViemChain(chainId: number): Chain | undefined {
  const entry = getChain(chainId);
  return entry ? toViemChain(entry) : undefined;
}

/** WhiskyDistillery address of the deployment on `chainId`. */
export function getContractAddress(chainId: number): `0x${string}` | undefined {
  return getChain(chainId)?.address;
}
