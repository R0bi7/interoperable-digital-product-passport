import { MANIFEST } from "@idpp/passport-config";
import { expect, type Page, test } from "@playwright/test";
import { installAddressOnlyWallet, installMockChain, type MockToken } from "./mock-chain";

// Only an issuer of the chain that holds the token may revise; the holder may not.
const HOLDER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const ISSUER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const home = MANIFEST.chains[0];
if (!home) throw new Error("manifest has no chains");
const TOKEN: MockToken = {
  tokenId: BigInt(home.chainId) * 10n ** 12n + 5n,
  chainId: home.chainId,
  owner: HOLDER,
  issuers: [ISSUER],
};
const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

async function openReviseAs(page: Page, address: `0x${string}`) {
  await installMockChain(page, TOKEN);
  await installAddressOnlyWallet(page, TOKEN, address);
  await page.goto(`/passport/${TOKEN.tokenId}/revise`);
  await expect(page.getByText(`held by ${HOLDER}`, { exact: false })).toBeVisible();
  const connected = page.getByRole("button", { name: short(address) }).first();
  // wagmi reconnects an injected wallet that already reports its account; connect only otherwise.
  const reconnected = await connected
    .waitFor({ timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!reconnected) {
    await page.getByRole("button", { name: "Connect Wallet" }).first().click();
    await page.getByRole("dialog").getByText("Mock Wallet").click();
  }
  await expect(connected).toBeVisible();
}

test.describe("revise is an issuer right", () => {
  test.skip(({ isMobile }) => isMobile, "the connect flow is covered on desktop");

  test("the holder is refused and cannot submit", async ({ page }) => {
    await openReviseAs(page, HOLDER);
    await expect(page.getByText(/The connected wallet is not an issuer on/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Pin and revise" })).toBeDisabled();
  });

  test("an issuer who does not hold the token may submit", async ({ page }) => {
    await openReviseAs(page, ISSUER);
    await expect(page.getByRole("button", { name: "Pin and revise" })).toBeEnabled();
    await expect(page.getByText(/not an issuer/)).toHaveCount(0);
  });
});
