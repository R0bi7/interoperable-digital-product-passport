// DS10 reader runs (docs/evaluation/PROTOCOL.md DS10). Loads /passport/<id> in headless Chromium (the Playwright
// installed for app/apps/web) against an app build whose NEXT_PUBLIC_INDEXER_URL is the DS10 stand-in, and records
// each revision's content / binding / history / recorded-on-chain results, the passport history hash and the
// reader banners. Nothing is signed and nothing is sent.
//   a1, a2, c   tampering is on chain; the stand-in passes the summary through unchanged.
//   b           existing eval3 tokens; one control load, then a load in which the gateway answer for the current CID
//               is replaced by altered bytes (a malicious gateway, INJECTED).
//   decoy       case c tokens with revision 0 replaced by the decoy CID in the stand-in (INJECTED).
//   future      tokens with a revision above the live tip appended by the stand-in (INJECTED).
//
//   APP_URL=http://localhost:3120 node ds10-ui.mjs a1 a2 c b decoy future
// ONLY_CHAIN=sep (with B_TOKENS naming the Sepolia subject only) retries the Sepolia loads into ACCEPTANCE_OUT.
// B_TOKENS=<id>,<id>,<id> names the case b subjects (one per chain). Output: $ACCEPTANCE_OUT/ds10-ui-results.json and
// one .txt and .png per load.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "../../../..");
const OUT = resolve(process.env.ACCEPTANCE_OUT ?? `${here}/out`);
const APP_URL = process.env.APP_URL ?? "http://localhost:3120";
const { chromium } = createRequire(`${REPO}/app/apps/web/package.json`)("@playwright/test");
const env = readFileSync(`${REPO}/app/apps/web/.env.local`, "utf8");
const GATEWAY = (process.env.NEXT_PUBLIC_PINATA_GATEWAY ?? env.match(/^NEXT_PUBLIC_PINATA_GATEWAY=(.+)$/m)?.[1] ?? "")
  .trim()
  .replace(/^"|"$/g, "")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");
if (!GATEWAY) throw new Error("NEXT_PUBLIC_PINATA_GATEWAY not found");
const fixtures = JSON.parse(readFileSync(`${OUT}/ds10-fixtures.json`, "utf8"));
const resultsFile = `${OUT}/ds10-ui-results.json`;
let results = [];
try {
  results = JSON.parse(readFileSync(resultsFile, "utf8"));
} catch {}

const STATUS = "(verified|failed|unavailable|unconfirmed)";
const BANNERS = [/Indexer only: [^\n]+/g, /The chain holds revision \d+; the indexer lists revision \d+\.[^\n]*/g];

function parse(text) {
  const section = text.split("Revisions and verification")[1] ?? "";
  const historyHash = section.match(new RegExp(`history hash: ${STATUS}`))?.[1] ?? null;
  const revisions = [];
  const parts = section.split(/\nRevision (\d+)\n/);
  for (let i = 1; i < parts.length; i += 2) {
    const body = parts[i + 1];
    const get = (name) => body.match(new RegExp(`(?:^|\\n)${name}: ${STATUS}`))?.[1] ?? null;
    revisions.push({
      revision: parts[i],
      cid: body.match(/baf[a-z2-7]{50,}/)?.[0] ?? null,
      content: get("content"),
      binding: get("binding"),
      history: get("history"),
      recordedOnChain: get("recorded on chain"),
    });
  }
  const banners = BANNERS.flatMap((re) => text.match(re) ?? []);
  return { historyHash, revisions, banners };
}

const settled = (p, count) =>
  p.historyHash &&
  p.revisions.length >= count &&
  p.revisions.every((r) => r.content && r.binding && r.history && r.recordedOnChain);

async function load(browser, name, tokenId, count, { override } = {}) {
  // ONLY_CHAIN=arb|base|sep repeats the loads of one chain (a retry), leaving the others untouched.
  if (process.env.ONLY_CHAIN && !name.endsWith(`-${process.env.ONLY_CHAIN}`)) return null;
  const context = await browser.newContext({ viewport: { width: 1200, height: 1000 } });
  const page = await context.newPage();
  const hits = [];
  if (override) {
    await page.route(`https://${GATEWAY}/ipfs/${override.cid}*`, (route) => {
      hits.push(`gateway answer for ${override.cid} replaced`);
      route.fulfill({
        status: 200,
        headers: { "access-control-allow-origin": "*", "content-type": "application/octet-stream" },
        body: Buffer.from(override.bytes),
      });
    });
  }
  const startedAt = new Date().toISOString();
  await page.goto(`${APP_URL}/passport/${tokenId}`);
  let parsed = { historyHash: null, revisions: [], banners: [] };
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    parsed = parse(await page.locator("body").innerText());
    if (settled(parsed, count)) break;
    await page.waitForTimeout(1_000);
  }
  // Give a late banner or status a moment to render after the last result settles.
  await page.waitForTimeout(2_000);
  const text = await page.locator("body").innerText();
  parsed = parse(text);
  writeFileSync(`${OUT}/${name}.txt`, text);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  await context.close();
  const out = { name, tokenId, startedAt, settled: settled(parsed, count), hits, ...parsed };
  results = results.filter((r) => r.name !== name).concat(out);
  writeFileSync(resultsFile, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(out));
  return out;
}

const STANDIN = process.env.STANDIN_URL ?? "http://localhost:42080";
const decoySwitch = async (on) => {
  const r = await (await fetch(`${STANDIN}/__standin/decoy?on=${on ? 1 : 0}`)).json();
  if (r.decoyOn !== on) throw new Error("stand-in decoy switch failed");
};

const shortChain = { 421614: "arb", 84532: "base", 11155111: "sep" };
const browser = await chromium.launch();
try {
  for (const c of process.argv.slice(2)) {
    await decoySwitch(false);
    if (c === "a1" || c === "a2") {
      for (const r of fixtures[c]) await load(browser, `ds10-${c}-${shortChain[r.chainId]}`, r.tokenId, 1);
    } else if (c === "c") {
      await decoySwitch(false);
      for (const r of fixtures.c) await load(browser, `ds10-c-${shortChain[r.chainId]}`, r.tokenId, 2);
    } else if (c === "decoy") {
      await decoySwitch(true);
      for (const r of fixtures.c) await load(browser, `ds10-decoy-${shortChain[r.chainId]}`, r.tokenId, 2);
    } else if (c === "future") {
      for (const r of fixtures.future)
        await load(browser, `ds10-future-${shortChain[r.chainId]}`, r.tokenId, Number(r.futureRevision) + 1);
    } else if (c === "b") {
      const ids = (process.env.B_TOKENS ?? "").split(",").filter(Boolean);
      // Three subjects, one per chain; a one-chain retry (ONLY_CHAIN) names that chain's subject only.
      if (ids.length < (process.env.ONLY_CHAIN ? 1 : 3)) throw new Error("B_TOKENS needs a token id per chain");
      for (const id of ids) {
        const summary = await (await fetch(`${process.env.INDEXER_URL ?? "http://localhost:42069"}/api/passports/${id}`)).json();
        const chain = shortChain[summary.currentChainId];
        const count = Number(summary.revision) + 1;
        await load(browser, `ds10-b-control-${chain}`, id, count);
        const original = await (await fetch(`https://${GATEWAY}/ipfs/${summary.cid}`)).text();
        const altered = original.replace(/"description":"/, '"description":"ALTERED ');
        if (altered === original) throw new Error(`alteration did not apply to ${summary.cid}`);
        await load(browser, `ds10-b-altered-${chain}`, id, count, {
          override: { cid: summary.cid, bytes: new TextEncoder().encode(altered) },
        });
      }
    } else throw new Error(`unknown case ${c}`);
  }
} finally {
  await decoySwitch(false).catch(() => {});
  writeFileSync(`${OUT}/ds10-standin-hits.json`, await (await fetch(`${STANDIN}/__standin/hits`)).text());
  await browser.close();
}
