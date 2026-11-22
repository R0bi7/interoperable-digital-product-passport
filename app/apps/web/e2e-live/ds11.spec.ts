import { mkdirSync, writeFileSync } from "node:fs";
import { whiskyDistilleryAbi } from "@idpp/passport-config";
import { expect, type Page, test } from "@playwright/test";
import { contractFor, installWallet, loadAccount, publicClientFor } from "./wallet";

/**
 * DS11 (docs/evaluation/PROTOCOL.md): the bottle lifecycle through the current UI on
 * whisky-v2-eval3. Two existing casks (DS11_CASKS=<id>,<id>, held on Arbitrum Sepolia by the key
 * of OPERATOR_PRIVATE_KEY) feed a bottle with one and a bottle with two `sourceCasks`; the second
 * bottle is revised; both are sent Arbitrum Sepolia -> Base Sepolia and read on the destination.
 * Three rejections (missing cask, non-cask, nonexistent revision) must be refused before any pin
 * or transaction. Spends testnet gas and pins real payloads. Results: DS11_OUT (JSON).
 * Run from apps/web after an indexer-backed build (`NEXT_PUBLIC_INDEXER_URL=… next build`):
 * `DS11_CASKS=<id>,<id> npx playwright test -c playwright.evidence.config.ts e2e-live/ds11.spec.ts`.
 */
const account = loadAccount();
const SOURCE = 421614;
const DESTINATION = 84532;
const SHORT = `${account.address.slice(0, 4)}…${account.address.slice(-4)}`;
const CASKS = (process.env.DS11_CASKS ?? "").split(",").filter(Boolean);
const OUT = process.env.DS11_OUT ?? "e2e-live/out/ds11-results.json";
const MISSING = `${SOURCE}000000999999`;

type Row = Record<string, unknown>;
const results: { header: Row; steps: Row[] } = {
  header: { startedAt: new Date().toISOString(), account: account.address, casks: CASKS },
  steps: [],
};
const save = () => {
  mkdirSync(OUT.replace(/\/[^/]+$/, ""), { recursive: true });
  writeFileSync(OUT, JSON.stringify(results, null, 2));
};

let page: Page;
const bottles: string[] = [];

async function read(
  chainId: number,
  functionName: "ownerOf" | "passportOf" | "nextTokenId",
  id?: string,
) {
  return publicClientFor(chainId).readContract({
    address: contractFor(chainId).address,
    abi: whiskyDistilleryAbi,
    functionName,
    args: id === undefined ? [] : [BigInt(id)],
  } as never);
}

const nonce = (chainId: number) =>
  publicClientFor(chainId).getTransactionCount({ address: account.address, blockTag: "pending" });

async function connect(p: Page = page) {
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

async function fillBottle(
  sources: { tokenId: string; revision: string; volumeMl: string }[],
  tag: string,
) {
  await page.goto("/mint");
  await connect();
  await page.getByLabel("Kind").selectOption("bottle");
  // "Chain" alone also names the wallet's chain button.
  await page.getByRole("combobox", { name: /^Chain/ }).selectOption(String(SOURCE));
  await page.getByLabel("Brand").fill("DS11 Demo");
  await page.getByLabel("Bottle type").fill("Single cask");
  await page.getByLabel("Bottled date").fill("2026-10-20");
  await page.getByLabel("Volume (ml)").fill("700");
  await page.getByLabel("Alcohol by volume (%)").fill("46");
  await page.getByLabel("Description").fill(`DS11 ${tag}`);
  for (const [index, s] of sources.entries()) {
    await page.getByRole("button", { name: "Add source cask" }).click();
    await page.getByLabel(`Source cask ${index + 1} token id`).fill(s.tokenId);
    await page.getByLabel(`Source cask ${index + 1} revision`).fill(s.revision);
    await page.getByLabel(`Source cask ${index + 1} volume in ml`).fill(s.volumeMl);
  }
}

/** Waits until every revision card shows all four results and the passport history hash. */
async function readerResults(p: Page, revisions: number) {
  const deadline = Date.now() + 3 * 60_000;
  let text = "";
  const parse = () => {
    const section = text.split("Revisions and verification")[1] ?? "";
    const parts = section.split(/\nRevision (\d+)\n/);
    const rows = [];
    for (let i = 1; i < parts.length; i += 2) {
      const body = parts[i + 1] ?? "";
      const get = (name: string) =>
        body.match(
          new RegExp(`(?:^|\\n)${name}: (verified|failed|unavailable|unconfirmed)`),
        )?.[1] ?? null;
      rows.push({
        revision: parts[i],
        content: get("content"),
        binding: get("binding"),
        history: get("history"),
        recordedOnChain: get("recorded on chain"),
      });
    }
    return {
      historyHash:
        section.match(/history hash: (verified|failed|unavailable|unconfirmed)/)?.[1] ?? null,
      rows,
    };
  };
  let parsed = parse();
  while (Date.now() < deadline) {
    text = await p.locator("body").innerText();
    parsed = parse();
    const done =
      parsed.historyHash &&
      parsed.rows.length >= revisions &&
      parsed.rows.every((r) => r.content && r.binding && r.history && r.recordedOnChain);
    if (done) break;
    await p.waitForTimeout(2_000);
    if (Date.now() % 20_000 < 2_000) await p.reload();
  }
  return parsed;
}

const allVerified = (r: Awaited<ReturnType<typeof readerResults>>, revisions: number) =>
  r.historyHash === "verified" &&
  r.rows.length === revisions &&
  r.rows.every(
    (x) =>
      x.content === "verified" &&
      x.binding === "verified" &&
      x.history === "verified" &&
      x.recordedOnChain === "verified",
  );

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser, baseURL }) => {
  expect(CASKS, "DS11_CASKS names two casks").toHaveLength(2);
  page = await (
    await browser.newContext({ baseURL, viewport: { width: 1200, height: 1000 } })
  ).newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  await installWallet(page, account);
  for (const id of CASKS) {
    const record = (await read(SOURCE, "passportOf", id)) as { revision: bigint; cid: string };
    results.header[`cask ${id}`] = { revision: record.revision.toString(), cid: record.cid };
  }
  save();
});

test.afterAll(async () => {
  results.header.finishedAt = new Date().toISOString();
  save();
  if (page) await page.context().close();
});

const casks = () =>
  CASKS.map((id) => ({
    id,
    revision: (results.header[`cask ${id}`] as { revision: string }).revision,
  }));

for (const [tag, pick] of [
  ["bottle with one source cask", (c: ReturnType<typeof casks>) => c.slice(0, 1)],
  ["bottle with two source casks", (c: ReturnType<typeof casks>) => c],
] as const) {
  test(`mints a ${tag}`, async () => {
    const sources = pick(casks()).map((c) => ({
      tokenId: c.id,
      revision: c.revision,
      volumeMl: "350",
    }));
    await fillBottle(sources, tag);
    const clickAt = new Date().toISOString();
    await page.getByRole("button", { name: "Sign and mint" }).click();
    const success = page.getByText(/Token id:/);
    await expect(success).toBeVisible({ timeout: 4 * 60_000 });
    const tokenId = (await success.innerText()).replace(/\D+/g, "");
    const txHash = (await page.locator('a[href*="/tx/"]').first().textContent())?.trim();
    const cid = await page.getByText(/^CID:/).locator("span").innerText();
    bottles.push(tokenId);
    results.steps.push({
      step: `mint ${tag}`,
      tokenId,
      chainId: SOURCE,
      txHash,
      cid,
      sources,
      clickAt,
      confirmedAt: new Date().toISOString(),
    });
    save();
    expect(await read(SOURCE, "ownerOf", tokenId)).toBe(account.address);
  });
}

test("revises the bottle with two source casks", async () => {
  const tokenId = bottles[1];
  await page.goto(`/passport/${tokenId}/revise`);
  await connect();
  const submit = page.getByRole("button", { name: "Pin and revise" });
  for (let attempt = 0; attempt < 8 && !(await submit.isVisible().catch(() => false)); attempt++) {
    await page.waitForTimeout(15_000);
    await page.reload();
    await connect();
  }
  await expect(submit).toBeEnabled({ timeout: 60_000 });
  await page.getByLabel("Description").fill("DS11 bottle revised; source casks unchanged.");
  await submit.click();
  await expect(page.getByText("Revision 1 recorded.", { exact: false })).toBeVisible({
    timeout: 5 * 60_000,
  });
  const txHash = (await page.locator('a[href*="/tx/"]').first().textContent())?.trim();
  const cid = await page
    .getByText(/^New CID:/)
    .locator("span")
    .innerText();
  results.steps.push({
    step: "revise bottle with two source casks",
    tokenId,
    chainId: SOURCE,
    txHash,
    cid,
    revision: "1",
  });
  save();
  const record = (await read(SOURCE, "passportOf", tokenId)) as { revision: bigint };
  expect(record.revision).toBe(1n);
});

for (const index of [0, 1]) {
  test(`sends bottle ${index + 1} to Base Sepolia and reads it there`, async () => {
    const tokenId = bottles[index];
    const before = (await read(SOURCE, "passportOf", tokenId)) as { revision: bigint; cid: string };
    await page.goto(`/passport/${tokenId}/send`);
    await connect();
    await page.getByLabel("Destination chain").selectOption(String(DESTINATION));
    await expect(page.getByText(/Native fee:/)).toBeVisible({ timeout: 60_000 });
    const clickAt = new Date().toISOString();
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText(/Source transaction:/)).toBeVisible({ timeout: 4 * 60_000 });
    const txHash = (await page.locator('a[href*="/tx/"]').first().textContent())?.trim();
    const step: Row = {
      step: `send bottle ${index + 1}`,
      tokenId,
      from: SOURCE,
      to: DESTINATION,
      txHash,
      clickAt,
    };
    results.steps.push(step);
    save();
    const shot = (suffix: string) =>
      page.screenshot({
        path: OUT.replace(/\.json$/, `-bottle${index + 1}-${suffix}.png`),
        fullPage: true,
      });
    await shot("panel-in-flight");
    await expect
      .poll(
        async () =>
          (await read(DESTINATION, "ownerOf", tokenId).catch(() => null)) as string | null,
        {
          timeout: 10 * 60_000,
          intervals: [10_000],
        },
      )
      .toBe(account.address);
    step.deliveredObservedAt = new Date().toISOString();
    await expect(page.locator("[data-delivered-at]")).toHaveAttribute("data-delivered-at", /.+/, {
      timeout: 60_000,
    });
    await shot("panel-delivered");
    const after = (await read(DESTINATION, "passportOf", tokenId)) as {
      revision: bigint;
      cid: string;
    };
    expect(after.revision).toBe(before.revision);
    expect(after.cid).toBe(before.cid);
    // Absent on the source: the burn, not an RPC failure.
    await expect(read(SOURCE, "ownerOf", tokenId)).rejects.toThrow(/ERC721NonexistentToken/);

    // The reader on the destination: wait for the indexer to place it there, then all checks.
    const reader = await page.context().newPage();
    await reader.goto(`/passport/${tokenId}`);
    await expect
      .poll(
        async () =>
          (await reader.locator("body").innerText()).includes("Current chain\nBase Sepolia"),
        {
          timeout: 5 * 60_000,
          intervals: [5_000],
        },
      )
      .toBe(true);
    const revisions = Number(after.revision) + 1;
    const verification = await readerResults(reader, revisions);
    step.reader = verification;
    step.readerText = (await reader.locator("body").innerText()).slice(0, 4000);
    save();
    await reader.screenshot({
      path: OUT.replace(/\.json$/, `-bottle${index + 1}-destination.png`),
      fullPage: true,
    });
    await reader.close();
    expect(allVerified(verification, revisions), JSON.stringify(verification)).toBe(true);
  });
}

for (const [name, source, expected] of [
  [
    "missing cask",
    () => ({ tokenId: MISSING, revision: "0", volumeMl: "350" }),
    `source cask ${MISSING}: not held on any chain of the deployment`,
  ],
  [
    "non-cask",
    () => ({ tokenId: bottles[0] ?? "", revision: "0", volumeMl: "350" }),
    "is a bottle, not a cask",
  ],
  [
    "nonexistent revision",
    () => ({ tokenId: CASKS[0] ?? "", revision: "9", volumeMl: "350" }),
    "revision 9 does not exist",
  ],
] as const) {
  test(`refuses a bottle with a ${name} before any pin or transaction`, async () => {
    const s = source();
    const nonces = { [SOURCE]: await nonce(SOURCE), [DESTINATION]: await nonce(DESTINATION) };
    const next = (await read(SOURCE, "nextTokenId")) as bigint;
    const pinRequests: string[] = [];
    page.on("request", (r) => {
      if (/\/api\/(pin|mint)$/.test(new URL(r.url()).pathname) && r.method() === "POST")
        pinRequests.push(r.url());
    });
    await fillBottle([s], `rejection ${name}`);
    await page.getByRole("button", { name: "Sign and mint" }).click();
    const message = page.getByText(expected, { exact: false }).first();
    await expect(message).toBeVisible({ timeout: 2 * 60_000 });
    const shown = await message.innerText();
    const after = {
      next: (await read(SOURCE, "nextTokenId")) as bigint,
      [SOURCE]: await nonce(SOURCE),
      [DESTINATION]: await nonce(DESTINATION),
    };
    results.steps.push({
      step: `rejection: ${name}`,
      source: s,
      expected,
      shown,
      mintRequests: pinRequests.length,
      nextTokenIdBefore: next.toString(),
      nextTokenIdAfter: after.next.toString(),
      noncesBefore: nonces,
      noncesAfter: { [SOURCE]: after[SOURCE], [DESTINATION]: after[DESTINATION] },
    });
    save();
    expect(after.next).toBe(next);
    expect(after[SOURCE]).toBe(nonces[SOURCE]);
    expect(after[DESTINATION]).toBe(nonces[DESTINATION]);
  });
}
