import { whiskyDistilleryAbi } from "@idpp/passport-config";
import { encodeEventTopics, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import type { PassportRecord } from "@/features/write/lib/locate";
import {
  checkAfterTransfer,
  isReceiverAddress,
  parseTransfer,
  transferProblem,
} from "@/features/write/lib/transfer";

const HOLDER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const RECEIVER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const CONTRACT = "0x000000000000000000000000000000000000dEaD" as const;
const TOKEN = 421614000000000006n;

const record: PassportRecord = {
  chainId: 421614,
  blockNumber: 100n,
  owner: HOLDER,
  revision: 2n,
  cid: "bafkreiexample",
  historyHash: `0x${"ab".repeat(32)}`,
};

describe("transferProblem", () => {
  const ok = { record, account: HOLDER, receiver: RECEIVER, confirmed: true } as const;

  it("accepts the holder sending to another valid address once confirmed", () => {
    expect(transferProblem(ok)).toBeUndefined();
    expect(transferProblem({ ...ok, account: HOLDER.toLowerCase() as `0x${string}` })).toBe(
      undefined,
    );
    expect(transferProblem({ ...ok, receiver: ` ${RECEIVER.toLowerCase()} ` })).toBeUndefined();
  });

  it("refuses without a wallet or from a wallet that is not the holder", () => {
    expect(transferProblem({ ...ok, account: undefined })).toMatch(/Connect the wallet/);
    expect(transferProblem({ ...ok, account: RECEIVER })).toMatch(/Only the holder can transfer/);
  });

  it("refuses an empty, malformed, mis-checksummed, zero or unchanged receiver", () => {
    expect(transferProblem({ ...ok, receiver: "" })).toMatch(/Enter the new holder/);
    expect(transferProblem({ ...ok, receiver: "0x1234" })).toMatch(/not a valid address/);
    const badChecksum = `0x3c44CdDdB6a900fa2b585dd299e03d12FA4293BC`;
    expect(transferProblem({ ...ok, receiver: badChecksum })).toMatch(/not a valid address/);
    expect(transferProblem({ ...ok, receiver: `0x${"0".repeat(40)}` })).toMatch(/zero address/);
    expect(transferProblem({ ...ok, receiver: HOLDER.toLowerCase() })).toMatch(
      /already the holder/,
    );
  });

  it("waits for the explicit confirmation", () => {
    expect(transferProblem({ ...ok, confirmed: false })).toMatch(
      /Confirm that you give up control/,
    );
  });
});

function transferLog(from: Hex, to: Hex, tokenId: bigint, address: Hex = CONTRACT) {
  const topics = encodeEventTopics({
    abi: whiskyDistilleryAbi,
    eventName: "Transfer",
    args: { from, to, tokenId },
  }) as Hex[];
  return { address, topics, data: "0x" as Hex };
}

describe("parseTransfer", () => {
  it("finds the Transfer of this token from the holder emitted by the contract", () => {
    const logs = [
      transferLog(HOLDER, RECEIVER, TOKEN + 1n),
      transferLog(HOLDER, RECEIVER, TOKEN, "0x000000000000000000000000000000000000bEEF"),
      transferLog(HOLDER, RECEIVER, TOKEN),
    ];
    expect(parseTransfer(logs, CONTRACT, TOKEN, HOLDER)).toEqual({
      from: HOLDER,
      to: RECEIVER,
      tokenId: TOKEN,
    });
  });

  it("returns undefined when no matching Transfer is present", () => {
    expect(parseTransfer([], CONTRACT, TOKEN, HOLDER)).toBeUndefined();
    expect(
      parseTransfer([transferLog(RECEIVER, HOLDER, TOKEN)], CONTRACT, TOKEN, HOLDER),
    ).toBeUndefined();
  });
});

describe("checkAfterTransfer", () => {
  const after = {
    owner: RECEIVER,
    revision: record.revision,
    cid: record.cid,
    historyHash: record.historyHash,
  };

  it("agrees when the receiver holds the unchanged passport", () => {
    const agrees = { ownerAgrees: true, passportChanges: [] };
    expect(checkAfterTransfer(record, RECEIVER, after)).toEqual(agrees);
    expect(
      checkAfterTransfer(record, RECEIVER, { ...after, owner: RECEIVER.toLowerCase() as Hex }),
    ).toEqual(agrees);
  });

  it("reports a wrong owner separately from changes since the snapshot", () => {
    expect(checkAfterTransfer(record, RECEIVER, { ...after, owner: HOLDER })).toEqual({
      ownerAgrees: false,
      passportChanges: [],
    });
    expect(
      checkAfterTransfer(record, RECEIVER, {
        owner: RECEIVER,
        revision: 3n,
        cid: "bafkreiother",
        historyHash: `0x${"cd".repeat(32)}`,
      }),
    ).toEqual({ ownerAgrees: true, passportChanges: ["revision 2 → 3", "CID", "history hash"] });
  });
});

describe("isReceiverAddress", () => {
  it("accepts checksummed, all-lowercase and all-uppercase addresses", () => {
    expect(isReceiverAddress(RECEIVER)).toBe(true);
    expect(isReceiverAddress(RECEIVER.toLowerCase())).toBe(true);
    expect(isReceiverAddress(`0x${RECEIVER.slice(2).toUpperCase()}`)).toBe(true);
  });

  it("refuses a wrong checksum, a wrong length and a missing or upper-case prefix", () => {
    expect(isReceiverAddress("0x3c44CdDdB6a900fa2b585dd299e03d12FA4293BC")).toBe(false);
    expect(isReceiverAddress(RECEIVER.slice(0, -1))).toBe(false);
    expect(isReceiverAddress(RECEIVER.slice(2))).toBe(false);
    expect(isReceiverAddress(`0X${RECEIVER.slice(2).toUpperCase()}`)).toBe(false);
  });
});
