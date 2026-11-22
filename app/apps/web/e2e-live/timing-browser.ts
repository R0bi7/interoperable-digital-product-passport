import { createRequire } from "node:module";
import { MANIFEST } from "@idpp/passport-config";
import type { Page } from "@playwright/test";
import { chainName } from "../src/features/write/lib/links";
import {
  type DeliveryTiming,
  gitState,
  observeReader,
  observeTogether,
  readerMatches,
  type TimingObservation,
  TimingRecorder,
} from "./timing";

export function createTimingRecorder(indexerUrl = process.env.INDEXER_URL) {
  return new TimingRecorder({
    startedAt: new Date().toISOString(),
    ...gitState(),
    deploymentId: MANIFEST.deploymentId,
    chains: MANIFEST.chains.map(({ chainId, eid, address }) => ({ chainId, eid, address })),
    tools: {
      node: process.version,
      playwright: createRequire(import.meta.url)("@playwright/test/package.json").version,
    },
    indexerUrl: indexerUrl || null,
  });
}

export async function transactionHash(page: Page): Promise<string | undefined> {
  return (await page.locator('a[href*="/tx/"]').first().textContent())?.trim();
}

export async function panelTiming(page: Page, indexerConfigured: boolean): Promise<DeliveryTiming> {
  // Panel clock has a 10 min delivery window followed by 60 s of indexer-only polling.
  const deadline = Date.now() + 11 * 60_000 + 10_000;
  let result: DeliveryTiming = { mountedAt: null, deliveredAt: null, indexerObservedAt: null };
  while (Date.now() < deadline) {
    result = await page.locator("[data-mounted-at]").evaluate((panel) => ({
      mountedAt: panel.getAttribute("data-mounted-at"),
      deliveredAt: panel.getAttribute("data-delivered-at"),
      indexerObservedAt: panel.getAttribute("data-indexer-observed-at"),
    }));
    if (
      result.deliveredAt &&
      (result.indexerObservedAt ||
        !indexerConfigured ||
        Date.now() - Date.parse(result.deliveredAt) >= 70_000)
    )
      return result;
    if (
      result.mountedAt &&
      !result.deliveredAt &&
      Date.now() - Date.parse(result.mountedAt) >= 10 * 60_000 + 10_000
    )
      return result;
    await page.waitForTimeout(500);
  }
  return result;
}

export type ExpectedPassport = { tokenId: string; revision: string; cid: string; chainId: number };
export async function verifiedReader(writePage: Page, expected: ExpectedPassport) {
  const reader = await writePage.context().newPage();
  try {
    return await observeReader({
      load: (remainingMs) =>
        reader
          .goto(`/passport/${expected.tokenId}`, {
            waitUntil: "domcontentloaded",
            timeout: Math.max(1, Math.min(remainingMs, 30_000)),
          })
          .then(() => undefined),
      snapshot: async () => {
        const snapshot = await reader.evaluate(() => {
          const field = (name: string) =>
            Array.from(document.querySelectorAll("dt"))
              .find((node) => node.textContent?.trim() === name)
              ?.nextElementSibling?.textContent?.trim();
          return {
            tokenId: document.querySelector("h1")?.textContent?.trim(),
            revision: field("Revision"),
            cid: field("CID"),
            chain: field("Current chain"),
            agreement: document.body.innerText.includes("The live read agrees with the indexer."),
            badges: Object.fromEntries(
              ["content", "binding", "history", "recorded on chain"].map((name) => [
                name,
                {
                  total: document.querySelectorAll(`[data-check="${name}"]`).length,
                  verified: document.querySelectorAll(
                    `[data-check="${name}"][data-status="verified"]`,
                  ).length,
                },
              ]),
            ),
            historyHash:
              document.querySelector('[data-check="history hash"][data-status="verified"]') !==
              null,
            pending:
              document.querySelector(
                '[role="status"][aria-label="Loading passport"], [role="status"][aria-label="Reading on chain"], [role="status"][aria-label="Verifying payloads"]',
              ) !== null,
            state: document.body.innerText.slice(0, 30_000),
          };
        });
        return {
          verified: readerMatches(snapshot, { ...expected, chain: chainName(expected.chainId) }),
          state: snapshot.state,
          pending: snapshot.pending,
        };
      },
    });
  } finally {
    await reader.close();
  }
}

/** Call immediately after the success notice; reader and delivery have independent deadlines. */
export async function finishTiming(
  recorder: TimingRecorder,
  observation: TimingObservation,
  page: Page,
  expected: ExpectedPassport,
  panel = false,
) {
  const onReader = (result: { verifiedAt: string | null; lastPageState: string }) => {
    Object.assign(observation, result, {
      outcome: result.verifiedAt
        ? "verified"
        : recorder.header.indexerUrl
          ? "timed-out"
          : "not-measured",
    });
    recorder.write();
  };
  const reader = () =>
    recorder.header.indexerUrl
      ? verifiedReader(page, expected)
      : Promise.resolve({
          verifiedAt: null,
          lastPageState: "INDEXER_URL unset: confirmed-to-verified not measured (mock read pages).",
        });
  if (panel) {
    const result = await observeTogether(
      reader,
      () => panelTiming(page, Boolean(recorder.header.indexerUrl)),
      onReader,
    );
    observation.delivery = result.delivery;
  } else {
    onReader(await reader());
  }
  recorder.write();
}
