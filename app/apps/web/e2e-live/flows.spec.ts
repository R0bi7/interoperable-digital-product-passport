import { whiskyDistilleryAbi } from "@idpp/passport-config";
import { expect, type Page, test } from "@playwright/test";
import { liveRepeat } from "./timing";
import { createTimingRecorder, finishTiming, transactionHash } from "./timing-browser";
import { contractFor, installWallet, loadAccount, publicClientFor } from "./wallet";

const account = loadAccount();
const repeat = liveRepeat();
const timings = createTimingRecorder();
const SOURCE = 421614; // issue and revise on Arbitrum Sepolia, send to Base Sepolia
const DESTINATION = 84532;
const SHORT = `${account.address.slice(0, 4)}…${account.address.slice(-4)}`;

let page: Page;
let wallet: Awaited<ReturnType<typeof installWallet>>;
let tokenId = "";

async function read(chainId: number, functionName: "ownerOf" | "passportOf", id: string) {
  return publicClientFor(chainId).readContract({
    address: contractFor(chainId).address,
    abi: whiskyDistilleryAbi,
    functionName,
    args: [BigInt(id)],
  } as never);
}

async function connect() {
  const connected = page.getByRole("button", { name: SHORT }).first();
  // wagmi reconnects on its own after a reload; only open the modal when it did not.
  const reconnected = await connected
    .waitFor({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (reconnected) return;
  await page.getByRole("button", { name: "Connect Wallet" }).first().click();
  await page.getByRole("dialog").getByText("Test Wallet").click();
  await expect(connected).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser, baseURL }) => {
  page = await (
    await browser.newContext({ baseURL, viewport: { width: 1200, height: 1000 } })
  ).newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  wallet = await installWallet(page, account);
});

test.afterAll(async () => {
  timings.write();
  if (wallet) console.log(`wallet requests: ${wallet.log.join(", ")}`);
  if (page) await page.context().close();
});

test("connects the injected wallet (wagmi reconnects it on load)", async () => {
  await page.goto("/mint");
  await connect();
  await expect(page.getByText("Connect a wallet to continue.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign and mint" })).toBeVisible();
});

for (let sample = 1; sample <= repeat; sample++) {
  test(`sample ${sample}: mints a cask: signs the challenge, pins, mints, and the chain agrees`, async () => {
    await page.goto("/mint");
    await connect();
    await page.getByLabel("Distillery").fill("Live Test Distillery");
    await page.getByLabel("Cask type").fill("Bourbon barrel");
    await page.getByLabel("Cask number").fill(`E2E-${Date.now()}`);
    await page.getByLabel("Volume (liters)").fill("200");
    await page.getByLabel("Alcohol by volume (%)").fill("63.5");
    await page.getByLabel("Fill date").fill("2026-10-01");
    await page.getByLabel("Description").fill("Minted by the live Playwright suite.");
    await expect(page.getByLabel("Recipient (holder of the new passport)")).toHaveValue(
      account.address,
    );

    const timing = timings.append({
      operation: "mint",
      tokenId: "pending",
      chainId: SOURCE,
      clickAt: new Date().toISOString(),
      confirmedAt: null,
      verifiedAt: null,
      outcome: "timed-out",
    });
    await page.getByRole("button", { name: "Sign and mint" }).click();
    const success = page.getByText(/Token id:/);
    await expect(success).toBeVisible({ timeout: 4 * 60_000 });
    timing.confirmedAt = new Date().toISOString();
    tokenId = (await success.innerText()).replace(/\D+/g, "");
    timing.tokenId = tokenId;
    timing.txHash = await transactionHash(page);
    timings.write();
    const cid = await page.getByText(/^CID:/).locator("span").innerText();
    await finishTiming(timings, timing, page, { tokenId, revision: "0", cid, chainId: SOURCE });
    console.log(`minted token ${tokenId}`);
    expect(tokenId).toMatch(/^421614\d{12}$/);

    expect(await read(SOURCE, "ownerOf", tokenId)).toBe(account.address);
    const record = (await read(SOURCE, "passportOf", tokenId)) as { revision: bigint; cid: string };
    expect(record.revision).toBe(0n);
    await expect(page.getByText(record.cid)).toBeVisible();
  });

  test(`sample ${sample}: revises the passport: signs the pin challenge, pins, writes revision 1`, async () => {
    const before = (await read(SOURCE, "passportOf", tokenId)) as { revision: bigint; cid: string };
    await page.goto(`/passport/${tokenId}/revise`);
    await connect();
    // The fresh payload comes from the public gateway, which can lag the pin for a moment.
    const submit = page.getByRole("button", { name: "Pin and revise" });
    for (
      let attempt = 0;
      attempt < 8 && !(await submit.isVisible().catch(() => false));
      attempt++
    ) {
      await page.waitForTimeout(15_000);
      await page.reload();
      await connect();
    }
    await expect(submit).toBeEnabled({ timeout: 60_000 });
    await page.getByLabel("Description").fill("Revised by the live Playwright suite.");
    const timing = timings.append({
      operation: "revise",
      tokenId,
      chainId: SOURCE,
      clickAt: new Date().toISOString(),
      confirmedAt: null,
      verifiedAt: null,
      outcome: "timed-out",
    });
    await submit.click();
    await expect(page.getByText("Revision 1 recorded.", { exact: false })).toBeVisible({
      timeout: 5 * 60_000,
    });
    timing.confirmedAt = new Date().toISOString();
    timing.txHash = await transactionHash(page);
    timings.write();
    const cid = await page
      .getByText(/^New CID:/)
      .locator("span")
      .innerText();
    await finishTiming(timings, timing, page, { tokenId, revision: "1", cid, chainId: SOURCE });

    const after = (await read(SOURCE, "passportOf", tokenId)) as { revision: bigint; cid: string };
    expect(after.revision).toBe(1n);
    expect(after.cid).not.toBe(before.cid);
    expect(await read(SOURCE, "ownerOf", tokenId)).toBe(account.address);
  });
}

test("a stale revise is refused with a clear message", async () => {
  // Another tab revises first; this one still holds revision 1 as its base.
  await page.goto(`/passport/${tokenId}/revise`);
  await connect();
  const submit = page.getByRole("button", { name: "Pin and revise" });
  await expect(submit).toBeEnabled({ timeout: 4 * 60_000 });

  const other = await page.context().newPage();
  await installWallet(other, account);
  await other.goto(`/passport/${tokenId}/revise`);
  await other
    .getByRole("button", { name: SHORT })
    .first()
    .waitFor({ timeout: 30_000 })
    .catch(async () => {
      await other.getByRole("button", { name: "Connect Wallet" }).first().click();
      await other.getByRole("dialog").getByText("Test Wallet").click();
    });
  await other.getByLabel("Description").fill("Revised first by the second tab.");
  const timing = timings.append({
    operation: "revise",
    tokenId,
    chainId: SOURCE,
    clickAt: new Date().toISOString(),
    confirmedAt: null,
    verifiedAt: null,
    outcome: "timed-out",
  });
  await other.getByRole("button", { name: "Pin and revise" }).click();
  await expect(other.getByText("Revision 2 recorded.")).toBeVisible({ timeout: 5 * 60_000 });
  timing.confirmedAt = new Date().toISOString();
  timing.txHash = await transactionHash(other);
  timings.write();
  const cid = await other
    .getByText(/^New CID:/)
    .locator("span")
    .innerText();
  await finishTiming(timings, timing, other, { tokenId, revision: "2", cid, chainId: SOURCE });
  await other.close();

  await page.getByLabel("Description").fill("Revised second, from a stale base.");
  await submit.click();
  await expect(page.getByText(/Out of date|StaleRevision/).first()).toBeVisible({
    timeout: 3 * 60_000,
  });
  const record = (await read(SOURCE, "passportOf", tokenId)) as { revision: bigint };
  expect(record.revision).toBe(2n);
});

// Each new send form locates the token on its current side and switches the signing wallet there.
// Repeat sends use the same token: Arbitrum -> Base -> Arbitrum -> ... (including a quoted return hop).
for (let sample = 0; sample < repeat * 2; sample++) {
  const from = sample % 2 === 0 ? SOURCE : DESTINATION;
  const to = sample % 2 === 0 ? DESTINATION : SOURCE;
  test(`send sample ${sample + 1}: ${from} to ${to}`, async () => {
    const before = (await read(from, "passportOf", tokenId)) as { revision: bigint; cid: string };
    await page.goto(`/passport/${tokenId}/send`);
    await connect();
    await page.getByLabel("Destination chain").selectOption(String(to));
    await expect(page.getByText(/Native fee:/)).toBeVisible({ timeout: 60_000 });
    const timing = timings.append({
      operation: "send",
      direction: `${from}->${to}`,
      tokenId,
      chainId: from,
      clickAt: new Date().toISOString(),
      confirmedAt: null,
      verifiedAt: null,
      outcome: "timed-out",
    });
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText(/Source transaction:/)).toBeVisible({ timeout: 4 * 60_000 });
    timing.confirmedAt = new Date().toISOString();
    timing.txHash = await transactionHash(page);
    timings.write();
    await finishTiming(
      timings,
      timing,
      page,
      { tokenId, revision: before.revision.toString(), cid: before.cid, chainId: to },
      true,
    );
    expect(timing.delivery?.deliveredAt, "panel observed destination ownership").toBeTruthy();
    expect(await read(to, "ownerOf", tokenId)).toBe(account.address);
    const record = (await read(to, "passportOf", tokenId)) as { revision: bigint; cid: string };
    expect(record.revision).toBe(before.revision);
    expect(record.cid).toBe(before.cid);
    await expect(read(from, "ownerOf", tokenId)).rejects.toThrow();
  });
}
