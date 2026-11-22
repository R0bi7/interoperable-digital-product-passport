import { MANIFEST } from "@idpp/passport-config";
import { http, type Transport } from "viem";

/** Space request starts before the HTTP timeout, while allowing responses to overlap. */
function pacedTransport(url: string, interval: number): Transport {
  return (options) => {
    const transport = http(url, { retryCount: 0 })(options);
    let tail = Promise.resolve();
    return {
      ...transport,
      // Scheduling preserves the underlying generic request/response relationship.
      request: ((...args: Parameters<typeof transport.request>) => {
        const ready = tail;
        tail = ready.then(() => new Promise<void>((resolve) => setTimeout(resolve, interval)));
        return ready.then(() => transport.request(...args));
      }) as typeof transport.request,
    };
  };
}

/**
 * Mapping from the deployment manifest to Ponder `chains` and contract entries, keyed by the
 * manifest network name (`arbitrum-sepolia`, `base-sepolia`, `sepolia`). Kept outside `ponder.config.ts` (and
 * outside `src/`, which Ponder loads as indexing code) so tests can import it without RPC env.
 */

export type RpcEnv = Readonly<Record<string, string | undefined>>;

/** `chains` for `createConfig`. RPC URLs come from `PONDER_RPC_URL_<chainId>` in `env`. */
export function buildChains(env: RpcEnv) {
  return Object.fromEntries(
    MANIFEST.chains.map((chain) => {
      const name = `PONDER_RPC_URL_${chain.chainId}`;
      const rpc = env[name];
      if (!rpc) throw new Error(`${name} is not set (put it in apps/indexer/.env.local)`);
      const rangeName = `PONDER_LOG_BLOCK_RANGE_${chain.chainId}`;
      const range = env[rangeName];
      if (
        range !== undefined &&
        (!/^[1-9][0-9]*$/.test(range) || !Number.isSafeInteger(Number(range)))
      ) {
        throw new Error(`${rangeName} must be a positive safe integer`);
      }
      const intervalName = `PONDER_RPC_INTERVAL_MS_${chain.chainId}`;
      const interval = env[intervalName];
      if (
        interval !== undefined &&
        (!/^[1-9][0-9]*$/.test(interval) ||
          !Number.isSafeInteger(Number(interval)) ||
          Number(interval) > 2_147_483_647)
      ) {
        throw new Error(`${intervalName} must be an integer from 1 to 2147483647`);
      }
      return [
        chain.network,
        {
          id: chain.chainId,
          rpc: interval === undefined ? rpc : pacedTransport(rpc, Number(interval)),
          ...(range === undefined ? {} : { ethGetLogsBlockRange: Number(range) }),
        },
      ];
    }),
  );
}

/** Per-chain `WhiskyDistillery` entries: manifest address, `startBlock` = deployment block. */
export const whiskyDistilleryChains = Object.fromEntries(
  MANIFEST.chains.map((chain) => [
    chain.network,
    { address: chain.address, startBlock: chain.deploymentBlock },
  ]),
);
