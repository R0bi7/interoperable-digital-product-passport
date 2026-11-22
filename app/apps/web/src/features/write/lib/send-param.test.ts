import { whiskyDistilleryAbi } from "@idpp/passport-config";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData } from "viem";
import { describe, expect, it } from "vitest";
import { buildSendParam, lzScanTxUrl, parseOnftSent } from "@/features/write/lib/send-param";

const RECEIVER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const CONTRACT = "0x000000000000000000000000000000000000dEaD";
const GUID = `0x${"12".repeat(32)}` as const;

describe("buildSendParam", () => {
  it("left-pads the receiver to bytes32 and leaves options, compose and command empty", () => {
    const param = buildSendParam(40245, RECEIVER, 421614000000000006n);
    expect({ ...param, to: param.to.toLowerCase() }).toEqual({
      dstEid: 40245,
      to: `0x000000000000000000000000${RECEIVER.slice(2).toLowerCase()}`,
      tokenId: 421614000000000006n,
      extraOptions: "0x",
      composeMsg: "0x",
      onftCmd: "0x",
    });
    expect(param.to).toHaveLength(66);
  });

  it("encodes as quoteSend and send calldata against the contract ABI", () => {
    const param = buildSendParam(40245, RECEIVER, 421614000000000006n);
    const quote = encodeFunctionData({
      abi: whiskyDistilleryAbi,
      functionName: "quoteSend",
      args: [param, false],
    });
    expect(quote.startsWith("0x")).toBe(true);
    const send = encodeFunctionData({
      abi: whiskyDistilleryAbi,
      functionName: "send",
      args: [param, { nativeFee: 123n, lzTokenFee: 0n }, RECEIVER],
    });
    expect(send.startsWith("0x")).toBe(true);
    // The token id above 2^53 survives encoding as an exact 256-bit word.
    expect(send).toContain(421614000000000006n.toString(16).padStart(64, "0"));
  });
});

describe("parseOnftSent", () => {
  const log = (address: string, tokenId: bigint, guid = GUID) => ({
    address: address as `0x${string}`,
    topics: encodeEventTopics({
      abi: whiskyDistilleryAbi,
      eventName: "ONFTSent",
      args: { guid, fromAddress: RECEIVER },
    }) as `0x${string}`[],
    data: encodeAbiParameters(
      [{ type: "uint32" }, { type: "uint256" }],
      [40245, tokenId],
    ) as `0x${string}`,
  });

  it("returns guid, destination eid and token id for the matching log", () => {
    const event = parseOnftSent(
      [log(CONTRACT, 421614000000000006n)],
      CONTRACT,
      421614000000000006n,
    );
    expect(event).toMatchObject({ guid: GUID, dstEid: 40245, tokenId: 421614000000000006n });
  });

  it("ignores logs of other contracts and other token ids", () => {
    const other = "0x000000000000000000000000000000000000beef";
    expect(parseOnftSent([log(other, 1n)], CONTRACT, 1n)).toBeUndefined();
    expect(parseOnftSent([log(CONTRACT, 2n)], CONTRACT, 1n)).toBeUndefined();
  });
});

describe("lzScanTxUrl", () => {
  it("links the testnet scan", () => {
    expect(lzScanTxUrl("0xabc")).toBe("https://testnet.layerzeroscan.com/tx/0xabc");
  });
});
