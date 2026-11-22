import { MANIFEST } from "@idpp/passport-config";
import { expect, it } from "vitest";
import { indexerReadiness } from "../src/api/readiness";
import { lagToleranceBlocks } from "../src/summary";

it("does not treat a missing chain or a zero checkpoint as caught up", () => {
  expect(indexerReadiness([]).chains.every((c) => !c.caughtUp)).toBe(true);
  const id = MANIFEST.chains[0]?.chainId as number;
  expect(
    indexerReadiness([{ chainId: id, indexedBlock: 0n, latestBlock: 0n }]).chains.every(
      (c) => !c.caughtUp,
    ),
  ).toBe(true);
});
it("uses the same per-chain lag allowance as passport summaries", () => {
  for (const { chainId } of MANIFEST.chains) {
    const progress = {
      chainId,
      indexedBlock: 100n,
      latestBlock: 100n + lagToleranceBlocks(chainId),
    };
    expect(indexerReadiness([progress]).chains.find((c) => c.chainId === chainId)?.caughtUp).toBe(
      true,
    );
    progress.latestBlock += 1n;
    expect(indexerReadiness([progress]).chains.find((c) => c.chainId === chainId)?.caughtUp).toBe(
      false,
    );
  }
});
