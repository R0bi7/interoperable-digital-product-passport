import { whiskyDistilleryAbi } from "@idpp/passport-config";
import { createConfig } from "ponder";
import { buildChains, whiskyDistilleryChains } from "./manifest-config";

/**
 * Chains and the WhiskyDistillery contract come from the deployment manifest (see
 * `manifest-config.ts`). Ponder loads RPC URLs from `.env.local`; a missing one fails `dev` and
 * `start` with its name (`ponder codegen` does not load this file). Public testnet RPCs cap
 * `eth_getLogs` ranges. Base Sepolia accepted 100 blocks after refusing 500 during the
 * 2026-10-19 preflight; this is an endpoint observation, not a universal chain limit.
 * Use a keyed provider for sustained indexing.
 */
export default createConfig({
  chains: buildChains(process.env),
  contracts: {
    WhiskyDistillery: {
      abi: whiskyDistilleryAbi,
      chain: whiskyDistilleryChains,
    },
  },
});
