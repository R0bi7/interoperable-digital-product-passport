import { getViemChain } from "@/lib/chains";

/** Block-explorer link for a transaction on a chain of the deployment, if the chain has one. */
export function txUrl(chainId: number, txHash: string): string | undefined {
  const explorer = getViemChain(chainId)?.blockExplorers?.default.url;
  return explorer ? `${explorer.replace(/\/$/, "")}/tx/${txHash}` : undefined;
}

export function chainName(chainId: number): string {
  return getViemChain(chainId)?.name ?? `chain ${chainId}`;
}
