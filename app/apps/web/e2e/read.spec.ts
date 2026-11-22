import { MANIFEST } from "@idpp/passport-config";
import { expect, test } from "@playwright/test";

const HELD = "421614000000000001";
const IN_FLIGHT = "421614000000000002";
const TAMPERED_CONTENT = "84532000000000001";
const TAMPERED_BINDING = "11155111000000000000";

test.describe("passport QR code", () => {
  test("shows a QR code and link that point back at the passport", async ({ page }) => {
    await page.goto(`/passport/${HELD}`);
    const url = new URL(
      `/passport/${HELD}?deployment=${MANIFEST.deploymentId}`,
      "http://localhost:3111",
    ).toString();
    await expect(page.getByRole("img", { name: `QR code linking to ${url}` })).toBeVisible();
    await expect(page.getByText(url, { exact: true })).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download PNG" }).click();
    expect((await download).suggestedFilename()).toBe(`passport-${HELD}.png`);
  });
});

test.describe("passport list", () => {
  test("shows fixtures behind a mock banner and filters by status", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("note")).toContainText("Mock data");
    const rows = page.getByRole("row").filter({ has: page.getByRole("link") });
    await expect(rows).toHaveCount(10);

    await page.getByLabel("Status").selectOption("in_flight");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(IN_FLIGHT);

    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(rows).toHaveCount(10);
  });

  test("opens a passport from the list", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: HELD }).click();
    await expect(page).toHaveURL(`/passport/${HELD}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(HELD);
  });
});

test.describe("passport detail", () => {
  test("verifies a held passport and offers the write flows", async ({ page }) => {
    await page.goto(`/passport/${HELD}`);
    await expect(page.getByText("The live read agrees with the indexer.")).toBeVisible();
    await expect(
      page.getByText("Fixture result: Retrieved data matches the recorded revision history"),
    ).toBeVisible();
    await expect(page.getByText("content: verified").first()).toBeVisible();
    await expect(page.getByText("content: failed")).toHaveCount(0);
    await expect(page.getByText("history hash: verified")).toBeVisible();
    await expect(page.getByRole("link", { name: "Revise" })).toHaveAttribute(
      "href",
      `/passport/${HELD}/revise`,
    );
    await page.getByRole("link", { name: "Send to another chain" }).click();
    await expect(page).toHaveURL(`/passport/${HELD}/send`);
    await expect(page.getByRole("link", { name: "Back to passport" })).toBeVisible();
  });

  test("explains a passport in flight", async ({ page }) => {
    await page.goto(`/passport/${IN_FLIGHT}`);
    await expect(page.getByText("no matching receive is indexed yet")).toBeVisible();
    await expect(
      page.getByText(
        "Indexer only: the token is in flight; no chain holds it to read. No binding below is confirmed on chain.",
      ),
    ).toBeVisible();
    await expect(page.getByText("binding: unconfirmed", { exact: true })).toBeVisible();
    await expect(page.getByText("recorded on chain: verified", { exact: true })).toBeVisible();
  });

  test("flags a payload that does not hash to its CID", async ({ page }) => {
    await page.goto(`/passport/${TAMPERED_CONTENT}`);
    await expect(page.getByText("content: failed")).toBeVisible();
  });

  test("flags an envelope bound to another token", async ({ page }) => {
    await page.goto(`/passport/${TAMPERED_BINDING}`);
    await expect(page.getByText("binding: failed")).toBeVisible();
  });

  test("flags a decoy revision 0 through the history hash and receipt", async ({ page }) => {
    await page.goto("/passport/421614000000000004");
    await expect(page.getByText("history hash: failed")).toBeVisible();
    await expect(page.getByText("recorded on chain: failed", { exact: true })).toBeVisible();
    await expect(page.getByText("history: failed")).toHaveCount(0);
  });

  test("warns when a QR label names another deployment even for an unknown token", async ({
    page,
  }) => {
    for (const id of [HELD, "999"]) {
      await page.goto(`/passport/${id}?deployment=other`);
      await expect(
        page.getByText(
          `This label was printed for other; this app serves ${MANIFEST.deploymentId}; the id may name an unrelated token.`,
        ),
      ).toBeVisible();
    }
  });

  test("failed live read marks every binding unconfirmed while receipts still verify", async ({
    page,
  }) => {
    await page.goto("/passport/421614000000000005");
    await expect(
      page.getByText("Indexer only: the live read failed. No binding below is confirmed on chain."),
    ).toBeVisible();
    await expect(page.getByText("binding: unconfirmed", { exact: true })).toHaveCount(2);
    await expect(page.getByText("recorded on chain: verified", { exact: true })).toHaveCount(2);
  });

  test("older live tip leaves the indexed future revision unconfirmed", async ({ page }) => {
    await page.goto("/passport/421614000000000006");
    await expect(
      page.getByText(
        "The chain holds revision 0; the indexer lists revision 1. Revisions above 0 are not confirmed on chain.",
      ),
    ).toBeVisible();
    await expect(page.getByText("binding: verified", { exact: true })).toHaveCount(1);
    await expect(page.getByText("binding: unconfirmed", { exact: true })).toHaveCount(1);
    await expect(page.getByText("history hash: verified", { exact: true })).toBeVisible();
    await expect(page.getByText("recorded on chain: verified", { exact: true })).toHaveCount(2);
  });

  test("unknown ids are a 404, unknown tokens a friendly message", async ({ page }) => {
    const response = await page.goto("/passport/not-a-number");
    expect(response?.status()).toBe(404);
    await page.goto("/passport/421614000000999999");
    await expect(page.getByText("The indexer does not know token")).toBeVisible();
  });
});

test.describe("scan", () => {
  test("opens a passport from a typed id or URL", async ({ page }) => {
    await page.goto("/scan");
    const input = page.getByLabel("Token id or passport URL");
    await input.fill("hello");
    await page.getByRole("button", { name: "Open" }).click();
    await expect(page.getByText("Not a token id or passport URL.")).toBeVisible();

    await input.fill(`http://localhost:3111/passport/${HELD}`);
    await page.getByRole("button", { name: "Open" }).click();
    await expect(page).toHaveURL(`/passport/${HELD}`);
  });
});
