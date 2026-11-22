import { defineConfig, devices } from "@playwright/test";

const PORT = 3111;

/**
 * Browser tests of the built app in mock mode (no indexer URL, so fixtures serve every read page).
 * `pnpm test:e2e` builds first; run `pnpm exec playwright install chromium` once per machine.
 * No wallet extension is present. The responsive suite also uses an injected keyless wallet.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // The responsive suite declares its own phone/tablet/desktop contexts in the desktop project.
    { name: "mobile", use: { ...devices["Pixel 7"] }, testIgnore: "**/responsive.spec.ts" },
  ],
  webServer: {
    command: `next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    env: { NEXT_PUBLIC_INDEXER_URL: "" },
  },
});
