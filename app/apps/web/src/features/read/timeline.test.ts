import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "@/lib/indexer/client";
import {
  buildTimelineItems,
  formatInterval,
  formatTimestamp,
  layerZeroScanUrl,
  txUrl,
} from "./timeline";

const e = (
  kind: TimelineEntry["kind"],
  chainId: number,
  timestamp: string,
  guid?: string,
): TimelineEntry => ({
  kind,
  chainId,
  txHash: `0x${kind}${timestamp}`,
  blockNumber: "1",
  timestamp,
  guid,
});

describe("buildTimelineItems", () => {
  it("pairs sent and received by guid and computes the block interval", () => {
    const items = buildTimelineItems([
      e("issued", 421614, "100"),
      e("sent", 421614, "160", "g1"),
      e("received", 84532, "175", "g1"),
      e("revised", 84532, "300"),
    ]);
    expect(items.map((i) => i.kind)).toEqual(["event", "hop", "event"]);
    const hop = items[1];
    expect(hop?.kind === "hop" && hop.hop.intervalSeconds).toBe(15n);
    expect(hop?.kind === "hop" && hop.hop.received?.chainId).toBe(84532);
  });

  it("keeps a send without a receive as an open hop", () => {
    const items = buildTimelineItems([e("sent", 421614, "160", "g1")]);
    expect(items).toHaveLength(1);
    const hop = items[0];
    expect(hop?.kind === "hop" && hop.hop.received).toBeNull();
    expect(hop?.kind === "hop" && hop.hop.intervalSeconds).toBeNull();
  });

  it("does not pair across different guids and keeps an orphan receive visible", () => {
    const items = buildTimelineItems([e("sent", 421614, "1", "a"), e("received", 84532, "2", "b")]);
    expect(items.map((i) => i.kind)).toEqual(["hop", "event"]);
  });

  it("pairs a round trip with two guids", () => {
    const items = buildTimelineItems([
      e("sent", 421614, "1", "a"),
      e("received", 84532, "5", "a"),
      e("sent", 84532, "9", "b"),
      e("received", 421614, "20", "b"),
    ]);
    expect(items.map((i) => i.kind)).toEqual(["hop", "hop"]);
  });
});

describe("formatting and links", () => {
  it("formats timestamps and intervals", () => {
    expect(formatTimestamp("1790900000")).toBe("2026-10-02T00:13:20Z");
    expect(formatInterval(15n)).toBe("15 s");
    expect(formatInterval(318n)).toBe("5 min 18 s");
  });

  it("builds explorer and LayerZero Scan links", () => {
    expect(txUrl(421614, "0xabc")).toBe("https://sepolia.arbiscan.io/tx/0xabc");
    expect(txUrl(84532, "0xabc")).toBe("https://sepolia.basescan.org/tx/0xabc");
    expect(txUrl(11155111, "0xabc")).toBe("https://sepolia.etherscan.io/tx/0xabc");
    expect(txUrl(1, "0xabc")).toBeUndefined();
    expect(layerZeroScanUrl("0xabc")).toBe("https://testnet.layerzeroscan.com/tx/0xabc");
  });
});
