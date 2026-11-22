import { expect, test } from "@playwright/test";

test("navigation reaches every top-level page and marks the current one", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Passports" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await nav.getByRole("link", { name: "Scan" }).click();
  await expect(page).toHaveURL("/scan");
  await expect(nav.getByRole("link", { name: "Scan" })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("link", { name: "Mint" }).click();
  await expect(page).toHaveURL("/mint");
});

test("the wallet button is on every page", async ({ page }) => {
  for (const path of ["/", "/scan", "/mint", "/passport/421614000000000001"]) {
    await page.goto(path);
    await expect(page.getByRole("button", { name: "Connect Wallet" }).first()).toBeVisible();
  }
});

test("pages do not scroll sideways", async ({ page }) => {
  for (const path of ["/", "/passport/421614000000000001", "/mint"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
