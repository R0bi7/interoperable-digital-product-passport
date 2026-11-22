import { whiskyDistilleryAbi } from "@idpp/passport-config";
import { type Address, type Hex, pad, parseEventLogs } from "viem";

/** LayerZero V2 `SendParam` of the ONFT721 `send` / `quoteSend` calls. */
export type SendParam = {
  dstEid: number;
  to: Hex;
  tokenId: bigint;
  extraOptions: Hex;
  composeMsg: Hex;
  onftCmd: Hex;
};

/**
 * `extraOptions` stays empty because the contract enforces the `lzReceive` gas per destination;
 * compose messages are rejected by the contract, so `composeMsg` and `onftCmd` stay empty too.
 */
export function buildSendParam(dstEid: number, receiver: Address, tokenId: bigint): SendParam {
  return {
    dstEid,
    to: pad(receiver, { size: 32 }),
    tokenId,
    extraOptions: "0x",
    composeMsg: "0x",
    onftCmd: "0x",
  };
}

export type SentEvent = { guid: Hex; dstEid: number; tokenId: bigint; fromAddress: Address };

/** The `ONFTSent` event for `tokenId` emitted by `contract` in a send receipt. */
export function parseOnftSent(
  logs: readonly { address: Address; topics: readonly Hex[]; data: Hex }[],
  contract: Address,
  tokenId: bigint,
): SentEvent | undefined {
  const parsed = parseEventLogs({
    abi: whiskyDistilleryAbi,
    eventName: "ONFTSent",
    logs: logs.filter((log) => log.address.toLowerCase() === contract.toLowerCase()) as never,
  });
  const match = parsed.find((event) => event.args.tokenId === tokenId);
  if (!match) return undefined;
  const { guid, dstEid, tokenId: id, fromAddress } = match.args;
  return { guid, dstEid, tokenId: id, fromAddress };
}

export const LZ_SCAN_UI = "https://testnet.layerzeroscan.com/tx";
export const LZ_SCAN_API = "https://scan-testnet.layerzero-api.com/v1";

export function lzScanTxUrl(txHash: string): string {
  return `${LZ_SCAN_UI}/${txHash}`;
}
