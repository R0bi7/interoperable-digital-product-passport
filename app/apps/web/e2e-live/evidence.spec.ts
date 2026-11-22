import { mkdirSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { installWallet, loadAccount } from "./wallet";

/**
 * DS12 figure set and the live proof of ownership (docs/evaluation/PROTOCOL.md) against the
 * indexer-backed build. Screenshots of the list, a detail page with its verification results and
 * QR code, a filled mint form and a quoted send form are taken without submitting anything. The proof of ownership exchanges a challenge and a signed proof
 * between a verifier page and a holder page (the key-backed wallet signs EIP-712 typed data; no
 * transaction). EVIDENCE_TOKEN names a held token of the key. Output: EVIDENCE_OUT (directory).
 * Run from apps/web after an indexer-backed build (`NEXT_PUBLIC_INDEXER_URL=… next build`):
 * `EVIDENCE_TOKEN=<id> npx playwright test -c playwright.evidence.config.ts e2e-live/evidence.spec.ts`.
 */
const account = loadAccount();
const TOKEN = process.env.EVIDENCE_TOKEN ?? "";
const OUT = process.env.EVIDENCE_OUT ?? "e2e-live/out/evidence";
const SHORT = `${account.address.slice(0, 4)}…${account.address.slice(-4)}`;
mkdirSync(OUT, { recursive: true });

async function connect(p: Page) {
  const connected = p.getByRole("button", { name: SHORT }).first();
  const reconnected = await connected
    .waitFor({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (reconnected) return;
  await p.getByRole("button", { name: "Connect Wallet" }).first().click();
  await p.getByRole("dialog").getByText("Test Wallet").click();
  await expect(connected).toBeVisible();
}

const shot = (p: Page, name: string) =>
  p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1200, height: 1000 } });

test("figure set: list, detail with results and QR, mint form, send form", async ({ page }) => {
  expect(TOKEN, "EVIDENCE_TOKEN").toMatch(/^\d+$/);
  await installWallet(page, account);
  await page.goto("/");
  // The list's first page of 20; the subject may sit on a later page.
  await expect(
    page
      .getByRole("row")
      .filter({ has: page.getByRole("link") })
      .first(),
  ).toBeVisible({ timeout: 60_000 });
  await shot(page, "list");

  await page.goto(`/passport/${TOKEN}`);
  await expect(page.getByText("history hash: verified")).toBeVisible({ timeout: 3 * 60_000 });
  await expect(
    page.getByText(/^recorded on chain: (verified|failed|unavailable)$/).first(),
  ).toBeVisible();
  await shot(page, "detail");
  await page.getByText("QR code", { exact: true }).scrollIntoViewIfNeeded();
  await page
    .locator("canvas, svg[role=img], img[alt*=QR]")
    .first()
    .screenshot({ path: `${OUT}/qr.png` });

  await page.goto("/mint");
  await connect(page);
  await page.getByLabel("Distillery").fill("Demo Distillery");
  await page.getByLabel("Cask type").fill("Bourbon barrel");
  await page.getByLabel("Cask number").fill("FIG-1");
  await page.getByLabel("Volume (liters)").fill("200");
  await page.getByLabel("Alcohol by volume (%)").fill("63.5");
  await page.getByLabel("Fill date").fill("2026-10-01");
  await page.getByLabel("Description").fill("Figure only; not submitted.");
  await shot(page, "mint-form");

  await page.goto(`/passport/${TOKEN}/send`);
  await connect(page);
  const destination = page.getByLabel("Destination chain");
  // The form renders its destinations once it has located the token's current chain.
  await expect(destination.locator("option").first()).toBeAttached({ timeout: 2 * 60_000 });
  const options = await destination
    .locator("option")
    .evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value).filter(Boolean));
  await destination.selectOption(options[0] ?? "");
  await expect(page.getByText(/Native fee:/)).toBeVisible({ timeout: 60_000 });
  await shot(page, "send-form");
});

test("proof of ownership: challenge, signed proof, fresh owner read, nonce consumed", async ({
  page: verifier,
  context,
}) => {
  const holder = await context.newPage();
  const wallet = await installWallet(holder, account);
  const startedAt = new Date().toISOString();
  await verifier.goto(`/passport/${TOKEN}/verify-owner`);
  await verifier.getByRole("button", { name: "Create ownership challenge" }).click();
  const challengeField = verifier.getByLabel("Ownership challenge JSON", { exact: true });
  await expect(challengeField).toBeVisible();
  const challengeText = await challengeField.inputValue();
  const challenge = JSON.parse(challengeText);
  expect(challenge.tokenId).toBe(TOKEN);
  await shot(verifier, "ownership-challenge");

  await holder.goto("/prove");
  await holder.getByLabel("Ownership challenge text", { exact: true }).fill(challengeText);
  await holder.getByRole("button", { name: "Read ownership challenge" }).click();
  const sign = holder.getByRole("button", { name: "Sign ownership challenge", exact: true });
  if (!(await sign.isVisible())) await connect(holder);
  await expect(sign).toBeEnabled({ timeout: 60_000 });
  await sign.click();
  const proofField = holder.getByLabel("Ownership proof JSON", { exact: true });
  await expect(proofField).toBeVisible({ timeout: 60_000 });
  const proofText = await proofField.inputValue();
  await shot(holder, "ownership-proof");

  await verifier.getByLabel("Ownership proof text", { exact: true }).fill(proofText);
  await verifier.getByRole("button", { name: "Verify ownership proof", exact: true }).click();
  const verified = verifier.getByText(/Ownership verified:/);
  await expect(verified).toBeVisible({ timeout: 60_000 });
  const verifiedText = await verified.innerText();
  await shot(verifier, "ownership-verified");
  await verifier.getByRole("button", { name: "Verify ownership proof", exact: true }).click();
  const reused = verifier.getByText(/Ownership not verified: already used/);
  await expect(reused).toBeVisible();
  writeFileSync(
    `${OUT}/ownership.json`,
    JSON.stringify(
      {
        startedAt,
        finishedAt: new Date().toISOString(),
        tokenId: TOKEN,
        challenge,
        proof: JSON.parse(proofText),
        verified: verifiedText,
        secondPresentation: await reused.innerText(),
        walletRequests: wallet.log,
      },
      null,
      2,
    ),
  );
  await holder.close();
});
