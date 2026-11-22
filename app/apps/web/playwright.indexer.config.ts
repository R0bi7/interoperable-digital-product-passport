import { defineConfig, devices } from "@playwright/test";
import { loadAccount } from "./e2e-live/wallet";

const PORT = 3113;

/**
 * Browser checks of the read pages against a running indexer and the chains. The indexer URL is
 * baked into the build (`NEXT_PUBLIC_INDEXER_URL`, set by `pnpm --filter web test:e2e:indexer`).
 * Read-only unless `LIVE_SPEND=1`, which also runs one cross-chain send with the key-backed
 * wallet (testnet gas). Output is not shared with the offline or flow suites.
 */
export default defineConfig({
  testDir: "./e2e-live",
  testMatch: "indexer.spec.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 15 * 60_000,
  expect: { timeout: 60_000 },
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: `next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    env: {
      ISSUER_ALLOWLIST: loadAccount().address,
      PIN_RATE_LIMIT_PER_MINUTE: "100",
    },
  },
});
