// Read-only paging check of the passport list (DS12, cause of the indexer-suite list failures): opens APP_URL in
// headless Chromium, counts DOM mutations while idle, then clicks "Load more" until it is gone and counts the rows
// after each click. Writes one JSON object to stdout. Nothing is signed or sent.
//   APP_URL=http://localhost:3120 node docs/acceptance/automation/eval3/loadmore.mjs > <evidence file>
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const { chromium } = createRequire(`${REPO}/app/apps/web/package.json`)("@playwright/test");
const APP_URL = process.env.APP_URL ?? "http://localhost:3120";
const out = { at: new Date().toISOString(), appUrl: APP_URL, idleMutations: null, clicks: [], finalRows: null, buttonGone: false };
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(`${APP_URL}/`);
  const rows = page.getByRole("row").filter({ has: page.getByRole("link") });
  await rows.first().waitFor({ timeout: 60_000 });
  await page.evaluate(() => {
    window.__m = 0;
    new MutationObserver((l) => (window.__m += l.length)).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  await page.waitForTimeout(5_000);
  out.idleMutations = await page.evaluate(() => window.__m);
  out.initialRows = await rows.count();
  for (let i = 0; i < 20; i++) {
    const button = page.getByRole("button", { name: "Load more" });
    if (!(await button.isVisible())) {
      out.buttonGone = true;
      break;
    }
    const t = Date.now();
    await button.click({ timeout: 20_000 });
    const clickMs = Date.now() - t;
    await page.waitForTimeout(3_000);
    out.clicks.push({ clickMs, rowsAfter: await rows.count() });
  }
  out.finalRows = await rows.count();
} finally {
  await browser.close();
}
console.log(JSON.stringify(out, null, 2));
