import { whiskyDistilleryAbi } from "@idpp/passport-config";
import { expect, type Page, test } from "@playwright/test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createTimingRecorder, finishTiming, transactionHash } from "./timing-browser";
import { contractFor, installWallet, loadAccount, publicClientFor } from "./wallet";

/**
 * The read pages, the scan page and the mint refusal against a running indexer. Ground truth is
 * the indexer's own HTTP API (which `apps/indexer/tests-live` checks against the chains), so a
 * mismatch here is a rendering or wiring fault. `LIVE_SPEND=1` adds one cross-chain send.
 */

const INDEXER_URL = (process.env.INDEXER_URL ?? "http://localhost:42069").replace(/\/$/, "");

type Entry = { kind: string; chainId: number; guid?: string; txHash: string };
type Summary = {
  tokenId: string;
  originChainId: number;
  currentChainId: number | null;
  status: "held" | "in_flight" | "incomplete";
  owner: string | null;
  revision: string | null;
  cid: string | null;
  revisions: { revision: string; conflict: boolean }[];
  timeline: Entry[];
};

const KIND_LABEL: Record<string, string> = {
  issued: "Issued",
  revised: "Revised",
  transferred: "Ownership transferred",
  sent: "Sent",
  received: "Received",
};
const CHAIN_NAME: Record<number, string> = {
  421614: "Arbitrum Sepolia",
  84532: "Base Sepolia",
  11155111: "Sepolia",
};

async function api<T>(path: string): Promise<T> {
  const response = await fetch(`${INDEXER_URL}${path}`);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

async function listAll(): Promise<Summary[]> {
  const items: Summary[] = [];
  let cursor: string | null = null;
  do {
    const page: { items: Summary[]; nextCursor: string | null } = await api(
      `/api/passports?limit=100${cursor ? `&cursor=${cursor}` : ""}`,
    );
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

let all: Summary[] = [];
/** A held token that has crossed chains, so its timeline holds a send and a receive. */
let subject: Summary;

test.beforeAll(async () => {
  all = await listAll().catch((error) => {
    throw new Error(`indexer not reachable at ${INDEXER_URL}: ${(error as Error).message}`);
  });
  const wanted = process.env.LIVE_TOKEN_ID;
  const held = all.filter((item) => item.status === "held");
  // Few revisions keep the page light on the public gateway, which rate-limits a burst of fetches;
  // among equals prefer a token away from its origin chain so "origin" and "current chain" differ.
  const crossed = held
    .filter((item) => item.timeline.some((e) => e.kind === "received"))
    .sort(
      (x, y) =>
        x.revisions.length - y.revisions.length ||
        Number(y.originChainId !== y.currentChainId) - Number(x.originChainId !== x.currentChainId),
    );
  const pick = wanted ? all.find((item) => item.tokenId === wanted) : (crossed[0] ?? held.at(-1));
  if (!pick) throw new Error("the indexer holds no passport to test against");
  subject = pick;
  console.log(
    `subject token ${subject.tokenId} (${subject.status}, ${subject.timeline.length} events)`,
  );
});

test.describe("list", () => {
  test("shows the indexer's passports, not fixtures", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Mock data")).toHaveCount(0);
    const rows = page.getByRole("row").filter({ has: page.getByRole("link") });
    await expect(rows.first()).toBeVisible();
    // The page asks for 20 at a time and offers "Load more" for the rest.
    while (await page.getByRole("button", { name: "Load more" }).isVisible()) {
      await page.getByRole("button", { name: "Load more" }).click();
    }
    await expect(rows).toHaveCount(all.length);
    await expect(rows.filter({ hasText: subject.tokenId })).toHaveCount(1);
  });

  test("filters by status and by chain the way the API does", async ({ page }) => {
    await page.goto("/");
    const rows = page.getByRole("row").filter({ has: page.getByRole("link") });
    await expect(rows.first()).toBeVisible();

    const chainId = subject.currentChainId as number;
    const onChain = all.filter((item) => item.currentChainId === chainId);
    await page.getByLabel("Chain").selectOption(String(chainId));
    await expect(rows).toHaveCount(onChain.length);
    await expect(rows.filter({ hasText: CHAIN_NAME[chainId] ?? "" }).first()).toBeVisible();

    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.getByLabel("Status").selectOption("in_flight");
    const inFlight = all.filter((item) => item.status === "in_flight").length;
    if (inFlight === 0) {
      await expect(page.getByText("No passports match these filters.")).toBeVisible();
    } else {
      await expect(rows).toHaveCount(inFlight);
    }
  });
});

test.describe("detail", () => {
  test("renders the indexer's view and the chain confirms it", async ({ page }) => {
    await page.goto(`/passport/${subject.tokenId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(subject.tokenId);
    await expect(page.locator("[data-status]").first()).toHaveAttribute("data-status", "held");
    await expect(page.getByText(subject.owner as string, { exact: false }).first()).toBeVisible();
    await expect(page.getByText("The live read agrees with the indexer.")).toBeVisible({
      timeout: 2 * 60_000,
    });
    await expect(page.getByText("Mock data")).toHaveCount(0);
  });

  test("shows the origin, the current chain and one card per revision", async ({ page }) => {
    await page.goto(`/passport/${subject.tokenId}`);
    const field = (label: string) =>
      page.getByText(label, { exact: true }).locator("xpath=following-sibling::*[1]");
    await expect(field("Origin (originOf)")).toContainText(CHAIN_NAME[subject.originChainId] ?? "");
    await expect(field("Current chain")).toHaveText(
      CHAIN_NAME[subject.currentChainId as number] ?? "",
    );
    await expect(page.getByText(/^content: /)).toHaveCount(subject.revisions.length, {
      timeout: 4 * 60_000,
    });
    const conflicts = subject.revisions.filter((r) => r.conflict).length;
    await expect(page.getByText("The indexer saw conflicting CIDs")).toHaveCount(conflicts);
  });

  test("lists every timeline event the indexer reports, hops merged", async ({ page }) => {
    await page.goto(`/passport/${subject.tokenId}`);
    const timeline = page.locator("section", {
      has: page.getByRole("heading", { name: "Timeline" }),
    });
    await expect(timeline).toBeVisible();
    const count = (kind: string) => subject.timeline.filter((e) => e.kind === kind).length;
    for (const kind of ["issued", "revised"]) {
      await expect(timeline.getByText(new RegExp(`^${KIND_LABEL[kind]} on `))).toHaveCount(
        count(kind),
      );
    }
    await expect(timeline.getByText(/^Hop: /)).toHaveCount(count("sent"));
    // A send and its receive share a guid and render as one hop.
    const guids = new Set(subject.timeline.filter((e) => e.kind === "sent").map((e) => e.guid));
    for (const guid of guids) await expect(timeline.getByText(guid as string)).toHaveCount(1);
  });

  test("verifies every revision's payload against its CID", async ({ page }) => {
    // Payloads come from a public gateway; a rate-limited fetch shows as unavailable, so reload.
    for (let attempt = 0; attempt < 4; attempt++) {
      await page.goto(`/passport/${subject.tokenId}`);
      await expect(page.getByText(/^content: /)).toHaveCount(subject.revisions.length, {
        timeout: 2 * 60_000,
      });
      if ((await page.getByText("content: verified").count()) === subject.revisions.length) break;
      await page.waitForTimeout(20_000);
    }
    await expect(page.getByText("content: verified")).toHaveCount(subject.revisions.length);
    await expect(page.getByText("binding: verified")).toHaveCount(subject.revisions.length);
    await expect(page.getByText("content: failed")).toHaveCount(0);
    await expect(page.getByText("binding: failed")).toHaveCount(0);
  });

  test("tells an unknown token from a malformed one", async ({ page }) => {
    await page.goto("/passport/421614000000999999");
    await expect(page.getByText("The indexer does not know token")).toBeVisible();
    expect((await page.goto("/passport/not-a-number"))?.status()).toBe(404);
  });
});

test.describe("scan", () => {
  test("opens the passport from a bare id and from its URL", async ({ page, baseURL }) => {
    for (const text of [subject.tokenId, `${baseURL}/passport/${subject.tokenId}`]) {
      await page.goto("/scan");
      await page.getByLabel("Token id or passport URL").fill(text);
      await page.getByRole("button", { name: "Open" }).click();
      await expect(page).toHaveURL(`/passport/${subject.tokenId}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(subject.tokenId);
    }
  });
});

test.describe("mint refusal (no gas, nothing pinned)", () => {
  const stranger = privateKeyToAccount(generatePrivateKey());

  test("a wallet outside the allowlist gets no challenge", async ({ request }) => {
    const response = await request.get(`/api/mint/challenge?address=${stranger.address}`);
    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "not_allowlisted" } });
  });

  test("a forged mint request is refused before any pin or transaction", async ({ request }) => {
    const signature = await stranger.signMessage({ message: "IDPP mint challenge: forged" });
    const response = await request.post("/api/mint", {
      data: {
        chainId: 421614,
        to: stranger.address,
        envelopeData: { kind: "cask", granularity: "item", data: {} },
        address: stranger.address,
        signature,
      },
    });
    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "not_allowlisted" } });
  });
});

test.describe("send, observed by the indexer", () => {
  test.skip(!process.env.LIVE_SPEND, "set LIVE_SPEND=1 to send a token (testnet gas)");

  test("the indexer places the token on the destination and the panel cites it", async ({
    browser,
    baseURL,
  }) => {
    const account = loadAccount();
    const timings = createTimingRecorder(INDEXER_URL);
    const short = `${account.address.slice(0, 4)}…${account.address.slice(-4)}`;
    const page: Page = await (await browser.newContext({ baseURL })).newPage();
    await installWallet(page, account);

    const from = subject.currentChainId as number;
    const to = from === 84532 ? 421614 : 84532;
    const owner = await publicClientFor(from).readContract({
      address: contractFor(from).address,
      abi: whiskyDistilleryAbi,
      functionName: "ownerOf",
      args: [BigInt(subject.tokenId)],
    } as never);
    test.skip(owner !== account.address, "the test wallet does not hold the subject token");

    await page.goto(`/passport/${subject.tokenId}/send`);
    await page
      .getByRole("button", { name: short })
      .first()
      .waitFor({ timeout: 15_000 })
      .catch(async () => {
        await page.getByRole("button", { name: "Connect Wallet" }).first().click();
        await page.getByRole("dialog").getByText("Test Wallet").click();
      });
    await page.getByLabel("Destination chain").selectOption(String(to));
    await expect(page.getByText(/Native fee:/)).toBeVisible({ timeout: 60_000 });
    const timing = timings.append({
      operation: "send",
      direction: `${from}->${to}`,
      tokenId: subject.tokenId,
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
      {
        tokenId: subject.tokenId,
        revision: subject.revision as string,
        cid: subject.cid as string,
        chainId: to,
      },
      true,
    );

    // The indexer settles the token on the destination (the in-flight window is too short to poll for).
    await expect
      .poll(async () => (await api<Summary>(`/api/passports/${subject.tokenId}`)).currentChainId, {
        timeout: 12 * 60_000,
        intervals: [3_000],
      })
      .toBe(to);
    const after = await api<Summary>(`/api/passports/${subject.tokenId}`);
    expect(after.status).toBe("held");
    expect(after.revision).toBe(subject.revision);
    expect(after.timeline.filter((e) => e.kind === "received").length).toBe(
      subject.timeline.filter((e) => e.kind === "received").length + 1,
    );

    await expect(page.getByText(/Indexer: received entry on chain/)).toBeVisible({
      timeout: 2 * 60_000,
    });
    await expect(
      page.getByText("Delivered: the token is held on the destination chain."),
    ).toBeVisible();
    await page.context().close();
  });
});
