import { expect, test } from "@playwright/test";

test.describe("without a wallet", () => {
  test("mint shows the whole form and swaps the submit button for Connect", async ({ page }) => {
    await page.goto("/mint");
    await expect(page.getByRole("heading", { name: "Mint a passport" })).toBeVisible();
    await expect(page.getByLabel("Distillery")).toBeVisible();
    await expect(page.getByLabel("Recipient (holder of the new passport)")).toBeVisible();
    await expect(
      page.getByText("Connect the issuer wallet to sign the mint challenge."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign and mint" })).toHaveCount(0);
    await expect(page.getByText("Connect a wallet to continue.")).toBeVisible();
  });

  test("a bottle exposes the source cask editor", async ({ page }) => {
    await page.goto("/mint");
    await page.getByLabel("Kind").selectOption("bottle");
    await page.getByRole("button", { name: "Add source cask" }).click();
    await expect(page.getByLabel("Source cask 1 token id")).toBeVisible();
    await page.getByRole("button", { name: "Remove source cask 1" }).click();
    await expect(page.getByLabel("Source cask 1 token id")).toHaveCount(0);
  });

  test("revise, send and transfer pages have a title and a way back", async ({ page }) => {
    const pages = [
      { action: "revise", title: "Revise passport 421614000000000001" },
      { action: "send", title: "Send passport 421614000000000001" },
      { action: "transfer", title: "Transfer passport 421614000000000001" },
    ];
    for (const { action, title } of pages) {
      await page.goto(`/passport/421614000000000001/${action}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
      await expect(page.getByRole("link", { name: "Back to passport" })).toHaveAttribute(
        "href",
        "/passport/421614000000000001",
      );
    }
  });
});
