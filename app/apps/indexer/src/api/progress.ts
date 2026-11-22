import { publicClients } from "ponder:api";
import { createProgressReader, resolveStatusUrl } from "./progress-core";

let reader: ReturnType<typeof createProgressReader> | undefined;
let readerUrl: string | undefined;

/** The local TCP port comes from Node's socket, never the URL or Host header. Ponder may
 * automatically choose the next port when its configured port is already occupied. */
export function getProgress(listeningPort: number | undefined) {
  if (
    typeof listeningPort !== "number" ||
    !Number.isInteger(listeningPort) ||
    listeningPort < 1 ||
    listeningPort > 65535
  ) {
    throw new Error("missing indexer listening port");
  }
  const statusUrl = resolveStatusUrl(process.env, listeningPort);
  if (!reader || readerUrl !== statusUrl) {
    readerUrl = statusUrl;
    reader = createProgressReader({
      fetch: globalThis.fetch,
      statusUrl,
      publicClients: publicClients as unknown as Record<
        string,
        { getBlockNumber(): Promise<bigint> } | undefined
      >,
    });
  }
  return reader.getProgress();
}
