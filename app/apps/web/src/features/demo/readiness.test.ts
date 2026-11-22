import { MANIFEST } from "@idpp/passport-config";
import { expect, it } from "vitest";
import { indexerItems } from "./readiness";

it("refuses another deployment, missing progress and duplicate chains", () => {
  expect(indexerItems({ deploymentId: "other", chains: [] })[0]?.ok).toBe(false);
  const row = {
    chainId: MANIFEST.chains[0]?.chainId as number,
    indexedBlock: "100",
    latestBlock: "100",
    toleranceBlocks: "1",
    caughtUp: true,
  };
  expect(
    indexerItems({ deploymentId: MANIFEST.deploymentId, chains: [row] }).filter((c) => c.ok),
  ).toHaveLength(1);
  expect(
    indexerItems({ deploymentId: MANIFEST.deploymentId, chains: [row, row] }).every((c) => !c.ok),
  ).toBe(true);
  expect(
    indexerItems({
      deploymentId: MANIFEST.deploymentId,
      chains: [{ ...row, indexedBlock: null }],
    }).every((c) => !c.ok),
  ).toBe(true);
});
