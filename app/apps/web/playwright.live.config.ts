import { defineConfig, devices } from "@playwright/test";
import { loadAccount } from "./e2e-live/wallet";

const PORT = 3112;

/**
 * Live testnet run of the connected flows: mint, revise and send with a wallet whose key comes
 * from `OPERATOR_PRIVATE_KEY` (env or `apps/web/.env.local`). It spends testnet gas, pins real
 * payloads to Pinata and mints real tokens. The key must be an issuer on every chain (the mint
 * API signs with it; the deployer is the first issuer) and is allowlisted for this run only.
 * Run with `pnpm --filter web test:e2e:live`.
 */
export default defineConfig({
  testDir: "./e2e-live",
  testMatch: "flows.spec.ts",
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
      NEXT_PUBLIC_INDEXER_URL: process.env.INDEXER_URL ?? "",
      ISSUER_ALLOWLIST: loadAccount().address,
      PIN_RATE_LIMIT_PER_MINUTE: "100",
    },
  },
});
