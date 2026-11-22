import { whiskyDistilleryAbi } from "@idpp/passport-config";
import { type Address, type Hex, isAddress, parseEventLogs, zeroAddress } from "viem";
import { isHolder, type PassportRecord } from "@/features/write/lib/locate";

/**
 * Why a same-chain transfer cannot be submitted yet, or `undefined` when it can. The page offers
 * the transfer to the holder only (the contract also accepts an approved account or operator, which
 * this page does not manage).
 */
export function transferProblem({
  record,
  account,
  receiver,
  confirmed,
}: {
  record: PassportRecord;
  account: Address | undefined;
  receiver: string;
  confirmed: boolean;
}): string | undefined {
  if (!account) return "Connect the wallet that holds this passport.";
  if (!isHolder(record, account))
    return `Only the holder can transfer. The holder is ${record.owner}.`;
  const trimmed = receiver.trim();
  if (trimmed === "") return "Enter the new holder's address.";
  if (!isReceiverAddress(trimmed)) {
    return "The new holder is not a valid address (check its checksum).";
  }
  if (trimmed.toLowerCase() === zeroAddress) return "The new holder cannot be the zero address.";
  if (trimmed.toLowerCase() === record.owner.toLowerCase()) {
    return "The new holder is already the holder.";
  }
  if (!confirmed) return "Confirm that you give up control of this token.";
  return undefined;
}

/**
 * A 20-byte hex address that is all lowercase, all uppercase (both unchecksummed under EIP-55) or
 * correctly checksummed. A mixed-case address with a wrong checksum is refused as a likely typo.
 */
export function isReceiverAddress(value: string): value is Address {
  return isAddress(value) || /^0x[0-9A-F]{40}$/.test(value);
}

export type TransferEvent = { from: Address; to: Address; tokenId: bigint };

/** The ERC-721 `Transfer` of `tokenId` from `from` emitted by `contract` in a receipt. */
export function parseTransfer(
  logs: readonly { address: Address; topics: readonly Hex[]; data: Hex }[],
  contract: Address,
  tokenId: bigint,
  from: Address,
): TransferEvent | undefined {
  const parsed = parseEventLogs({
    abi: whiskyDistilleryAbi,
    eventName: "Transfer",
    logs: logs.filter((log) => log.address.toLowerCase() === contract.toLowerCase()) as never,
  });
  const match = parsed.find(
    (event) =>
      event.args.tokenId === tokenId && event.args.from.toLowerCase() === from.toLowerCase(),
  );
  if (!match) return undefined;
  return { from: match.args.from, to: match.args.to, tokenId: match.args.tokenId };
}

export type AfterTransfer = {
  owner: Address;
  revision: bigint;
  cid: string;
  historyHash: Hex;
};

export type ReadBackCheck = {
  /** Whether the receiver owns the token at the transaction's block. */
  ownerAgrees: boolean;
  /**
   * Differences between the passport at the transaction's block and the page's snapshot. A transfer
   * never touches the record, so any difference comes from a revision by an issuer in between.
   */
  passportChanges: string[];
};

/** Compares the post-transfer read with the receiver and with the snapshot the page was prepared on. */
export function checkAfterTransfer(
  before: PassportRecord,
  receiver: Address,
  after: AfterTransfer,
): ReadBackCheck {
  const passportChanges: string[] = [];
  if (after.revision !== before.revision) {
    passportChanges.push(`revision ${before.revision} → ${after.revision}`);
  }
  if (after.cid !== before.cid) passportChanges.push("CID");
  if (after.historyHash.toLowerCase() !== before.historyHash.toLowerCase()) {
    passportChanges.push("history hash");
  }
  return { ownerAgrees: after.owner.toLowerCase() === receiver.toLowerCase(), passportChanges };
}
