import { defineConfig, devices } from "@playwright/test";
import { loadAccount } from "./e2e-live/wallet";

const PORT = 3115;

/**
 * Evidence runs on the live testnets (docs/evaluation/PROTOCOL.md): `evidence.spec.ts`
 * (DS12 figure set and the live proof of ownership; signs, sends nothing) and `ds11.spec.ts`
 * (DS11 bottle lifecycle; spends testnet gas and pins real payloads). Test-only: no app code.
 * Build with the indexer URL baked in, then run one file:
 *   NEXT_PUBLIC_INDEXER_URL=http://localhost:42069 pnpm --filter web exec next build
 *   pnpm --filter web exec playwright test -c playwright.evidence.config.ts e2e-live/ds11.spec.ts
 */
export default defineConfig({
  testDir: "./e2e-live",
  testMatch: ["evidence.spec.ts", "ds11.spec.ts"],
  workers: 1,
  fullyParallel: false,
  timeout: 20 * 60_000,
  expect: { timeout: 60_000 },
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    // A missing element fails within a minute instead of at the test timeout.
    actionTimeout: 60_000,
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
