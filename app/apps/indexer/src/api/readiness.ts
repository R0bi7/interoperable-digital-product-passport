import { MANIFEST } from "@idpp/passport-config";
import { type ChainProgress, lagToleranceBlocks } from "../summary";

/** Read-only presentation preflight; uses the summary API's existing lag policy. */
export function indexerReadiness(progress: readonly ChainProgress[]) {
  return {
    deploymentId: MANIFEST.deploymentId,
    chains: MANIFEST.chains.map(({ chainId }) => {
      const row = progress.find((p) => p.chainId === chainId);
      const tolerance = lagToleranceBlocks(chainId);
      return {
        chainId,
        indexedBlock: row?.indexedBlock.toString() ?? null,
        latestBlock: row?.latestBlock.toString() ?? null,
        toleranceBlocks: tolerance.toString(),
        caughtUp:
          !!row &&
          row.indexedBlock > 0n &&
          row.latestBlock > 0n &&
          row.latestBlock - row.indexedBlock <= tolerance,
      };
    }),
  };
}
