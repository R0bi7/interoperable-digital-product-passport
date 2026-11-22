import { whiskyDistilleryAbi } from "@idpp/passport-config";
import type { Address, PublicClient } from "viem";
import { isRevert } from "@/features/write/lib/revert";
import { LZ_SCAN_API } from "@/features/write/lib/send-param";

/** Delivery is observed through three independent sources; none of them decides for the others. */

export type ScanStatus =
  | { state: "found"; name: string; message?: string }
  | { state: "not_indexed" }
  | { state: "unreachable"; reason: string };

export const DELIVERY_HTTP_TIMEOUT_MS = 15_000;

/** Bound both response headers and JSON bodies, even if an injected fetch ignores abort. */
async function deliveryJson(
  url: string,
  fetchImpl: typeof fetch,
): Promise<{ status: number; ok: boolean; body?: unknown }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(url, { signal: controller.signal });
        return {
          status: response.status,
          ok: response.ok,
          body: response.ok ? await response.json() : undefined,
        };
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(
            `delivery HTTP request timed out after ${DELIVERY_HTTP_TIMEOUT_MS} ms`,
          );
          controller.abort(error);
          reject(error);
        }, DELIVERY_HTTP_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** `GET /v1/messages/tx/<txHash>` of LayerZero Scan (testnet). */
export async function fetchScanStatus(
  txHash: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ScanStatus> {
  try {
    const response = await deliveryJson(`${LZ_SCAN_API}/messages/tx/${txHash}`, fetchImpl);
    if (response.status === 404) return { state: "not_indexed" };
    if (!response.ok) return { state: "unreachable", reason: `scan HTTP ${response.status}` };
    const body = response.body as {
      data?: { status?: { name?: string; message?: string } }[];
    };
    const status = body.data?.[0]?.status;
    if (!status?.name) return { state: "not_indexed" };
    return { state: "found", name: status.name, message: status.message };
  } catch (error) {
    return { state: "unreachable", reason: (error as Error).message };
  }
}

export type IndexerObservation =
  | { state: "received"; chainId: number; txHash?: string }
  | { state: "not_yet" }
  | { state: "unavailable"; reason: string };

type TimelineEntry = {
  kind?: string;
  guid?: string;
  chainId?: number;
  txHash?: string;
};

/**
 * `GET <indexer>/api/passports/<tokenId>`: observed when the timeline holds a `received` entry
 * whose `guid` is this transfer's. The entry's discriminator is read from `kind`, the field the indexer emits.
 * The timing panel also requires held placement on its destination before latching its clock.
 */
export async function fetchIndexerObservation(
  indexerUrl: string | undefined,
  tokenId: string,
  guid: string,
  fetchImpl: typeof fetch = fetch,
  destinationChainId?: number,
): Promise<IndexerObservation> {
  // Mock mode (`NEXT_PUBLIC_INDEXER_URL` unset): there is no indexer to ask, so no request is made.
  if (!indexerUrl) return { state: "unavailable", reason: "no indexer configured" };
  try {
    const response = await deliveryJson(
      `${indexerUrl.replace(/\/$/, "")}/api/passports/${tokenId}`,
      fetchImpl,
    );
    if (response.status === 404) return { state: "not_yet" };
    if (!response.ok) return { state: "unavailable", reason: `indexer HTTP ${response.status}` };
    const body = response.body as {
      timeline?: TimelineEntry[];
      status?: string;
      currentChainId?: number;
    };
    const entry = body.timeline?.find(
      (item) => item.kind === "received" && item.guid?.toLowerCase() === guid.toLowerCase(),
    );
    if (
      !entry ||
      (destinationChainId !== undefined &&
        (body.status !== "held" || body.currentChainId !== destinationChainId))
    )
      return { state: "not_yet" };
    return { state: "received", chainId: entry.chainId ?? 0, txHash: entry.txHash };
  } catch (error) {
    return { state: "unavailable", reason: (error as Error).message };
  }
}

export type DestinationOwnership = {
  state: "owned";
  blockNumber: bigint;
  owner: Address;
  reason?: string;
};

export type DestinationRead =
  | DestinationOwnership
  | {
      state: "present";
      blockNumber: bigint;
      owner: Address;
      revision: bigint;
      cid: string;
    }
  | { state: "absent"; blockNumber: bigint }
  | { state: "error"; reason: string };

/** Live `ownerOf(tokenId)` (and `passportOf`) on the destination at one explicit block. */
export async function readDestination(
  client: PublicClient,
  contract: Address,
  tokenId: bigint,
  onOwner?: (observation: DestinationOwnership) => void,
): Promise<DestinationRead> {
  try {
    const blockNumber = await client.getBlockNumber();
    let owner: Address;
    try {
      owner = await client.readContract({
        address: contract,
        abi: whiskyDistilleryAbi,
        functionName: "ownerOf",
        args: [tokenId],
        blockNumber,
      });
    } catch (error) {
      if (isRevert(error, "ERC721NonexistentToken")) return { state: "absent", blockNumber };
      throw error;
    }
    const ownership: DestinationOwnership = { state: "owned", owner, blockNumber };
    onOwner?.(ownership);
    try {
      const passport = await client.readContract({
        address: contract,
        abi: whiskyDistilleryAbi,
        functionName: "passportOf",
        args: [tokenId],
        blockNumber,
      });
      return {
        state: "present",
        blockNumber,
        owner,
        revision: BigInt(passport.revision),
        cid: passport.cid,
      };
    } catch (error) {
      return {
        ...ownership,
        reason: (error as Error).message.split("\n")[0] ?? "passport read failed",
      };
    }
  } catch (error) {
    return { state: "error", reason: (error as Error).message.split("\n")[0] ?? "read failed" };
  }
}

export type StepState = "waiting" | "done" | "unavailable";

export type ProgressInput = {
  /** Whether the source-chain receipt is final (status success). */
  sourceReceipt: "waiting" | "success" | "reverted";
  scan?: ScanStatus;
  indexer?: IndexerObservation;
  destination?: DestinationRead;
  receiver: Address;
  sent: { revision: bigint; cid: string };
  /** The poll window elapsed. */
  timedOut: boolean;
};

export type ProgressView = {
  pending: { state: StepState; detail: string };
  observed: { state: StepState; scan: string; indexer: string };
  confirmed: { state: StepState; detail: string; snapshotMatches?: boolean };
  /** Shown above the three states while delivery is open; never claims failure. */
  headline: string;
};

function describeScan(scan: ScanStatus | undefined): string {
  if (!scan) return "LayerZero Scan: not queried yet";
  if (scan.state === "found") {
    return `LayerZero Scan: ${scan.name}${scan.message ? ` (${scan.message})` : ""}`;
  }
  if (scan.state === "not_indexed") return "LayerZero Scan: message not indexed yet";
  return `LayerZero Scan: unreachable (${scan.reason})`;
}

function describeIndexer(indexer: IndexerObservation | undefined): string {
  if (!indexer) return "Indexer: not queried yet";
  if (indexer.state === "received") return `Indexer: received entry on chain ${indexer.chainId}`;
  if (indexer.state === "not_yet") return "Indexer: no received entry with this GUID yet";
  return `Indexer: unavailable (${indexer.reason})`;
}

/** Combines the three independent observations into the progress panel's view. */
export function deriveProgress(input: ProgressInput): ProgressView {
  const pending: ProgressView["pending"] =
    input.sourceReceipt === "success"
      ? {
          state: "done",
          detail: "Source transaction confirmed; the token is burned on the source chain.",
        }
      : input.sourceReceipt === "reverted"
        ? { state: "unavailable", detail: "Source transaction reverted." }
        : { state: "waiting", detail: "Waiting for the source transaction receipt." };

  const scanDelivered = input.scan?.state === "found" && input.scan.name === "DELIVERED";
  const indexerReceived = input.indexer?.state === "received";
  const observedDone = scanDelivered || indexerReceived;
  const bothUnreachable =
    input.scan?.state === "unreachable" && input.indexer?.state === "unavailable";
  const observed: ProgressView["observed"] = {
    state: observedDone ? "done" : bothUnreachable ? "unavailable" : "waiting",
    scan: describeScan(input.scan),
    indexer: describeIndexer(input.indexer),
  };

  const destination = input.destination;
  let confirmed: ProgressView["confirmed"];
  if (
    (destination?.state === "present" || destination?.state === "owned") &&
    destination.owner.toLowerCase() === input.receiver.toLowerCase()
  ) {
    if (destination.state === "owned") {
      confirmed = {
        state: "done",
        detail: `ownerOf(tokenId) = ${destination.owner} at block ${destination.blockNumber}; passport snapshot ${destination.reason ? `unavailable (${destination.reason})` : "still being read"}.`,
      };
    } else {
      const snapshotMatches =
        destination.revision === input.sent.revision && destination.cid === input.sent.cid;
      confirmed = {
        state: "done",
        snapshotMatches,
        detail: `ownerOf(tokenId) = ${destination.owner} at block ${destination.blockNumber}; passport revision ${destination.revision}${snapshotMatches ? " matches the sent snapshot" : " DIFFERS from the sent snapshot"}.`,
      };
    }
  } else if (destination?.state === "present" || destination?.state === "owned") {
    confirmed = {
      state: "waiting",
      detail: `ownerOf(tokenId) = ${destination.owner} at block ${destination.blockNumber}, not the receiver.`,
    };
  } else if (destination?.state === "absent") {
    confirmed = {
      state: "waiting",
      detail: `ownerOf(tokenId) reverts on the destination at block ${destination.blockNumber}: not delivered yet.`,
    };
  } else if (destination?.state === "error") {
    confirmed = { state: "unavailable", detail: `Destination read failed: ${destination.reason}` };
  } else {
    confirmed = { state: "waiting", detail: "Destination not read yet." };
  }

  let headline: string;
  if (input.sourceReceipt === "reverted")
    headline = "The source transaction reverted; nothing was sent.";
  else if (confirmed.state === "done")
    headline = "Delivered: the token is held on the destination chain.";
  else if (input.timedOut) headline = "Delivery not yet observed.";
  else if (pending.state === "done") headline = "In flight: waiting for LayerZero to deliver.";
  else headline = "Waiting for the source transaction.";
  return { pending, observed, confirmed, headline };
}
