import {
  type ChallengeRecord,
  decodeOwnershipChallenge,
  encodeOwnershipChallenge,
  MANIFEST,
  type OwnershipProof,
  ownershipTypedData,
  whiskyDistilleryAbi,
} from "@idpp/passport-config";
import { expect, test } from "@playwright/test";
import { decodeFunctionData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getViemChain } from "../src/lib/chains";
import { installCamera, showCameraCode } from "./camera";
import { installKeyBackedWallet, installMockChain, type MockToken } from "./mock-chain";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const home = MANIFEST.chains[0];
const other = MANIFEST.chains[1];
if (!home || !other) throw new Error("Ownership tests need two manifest chains");
const TOKEN: MockToken = {
  tokenId: BigInt(home.chainId) * 10n ** 12n + 5n,
  chainId: home.chainId,
  owner: account.address,
  issuers: [],
};

test("two devices exchange a challenge and proof, rereading owner after scan", async ({
  page: verifier,
  context,
  isMobile,
}) => {
  test.skip(isMobile, "wallet connection is covered on desktop");
  const holder = await context.newPage();
  await installMockChain(verifier, TOKEN);
  await installMockChain(holder, TOKEN);
  const wallet = await installKeyBackedWallet(holder, TOKEN, account, other.chainId);
  let ownerReads = 0;
  verifier.on("request", (request) => {
    if (request.method() !== "POST") return;
    let body: unknown;
    try {
      body = request.postDataJSON();
    } catch {
      return;
    }
    for (const rpc of Array.isArray(body) ? body : [body]) {
      if (rpc?.method !== "eth_call") continue;
      try {
        const decoded = decodeFunctionData({
          abi: whiskyDistilleryAbi,
          data: rpc.params?.[0]?.data as Hex,
        });
        if (decoded.functionName === "ownerOf") ownerReads++;
      } catch {
        /* balance and multicall requests are unrelated */
      }
    }
  });

  await verifier.goto(`/passport/${TOKEN.tokenId}/verify-owner`);
  await verifier.getByRole("button", { name: "Create ownership challenge" }).click();
  const challengeField = verifier.getByLabel("Ownership challenge JSON", { exact: true });
  await expect(challengeField).toBeVisible();
  const challengeText = await challengeField.inputValue();
  const challenge = JSON.parse(challengeText);
  expect(challenge.tokenId).toBe(TOKEN.tokenId.toString());
  expect(challenge.chainId).toBe(home.chainId);

  await holder.goto("/prove");
  await holder.getByLabel("Ownership challenge text", { exact: true }).fill(challengeText);
  await holder.getByRole("button", { name: "Read ownership challenge" }).click();
  const sign = holder.getByRole("button", { name: "Sign ownership challenge", exact: true });
  if (!(await sign.isVisible())) {
    await holder.getByRole("button", { name: "Connect Wallet" }).first().click();
    await holder.getByRole("dialog").getByText("Mock Wallet").click();
  }
  await expect(sign).toBeEnabled();
  await sign.click();
  const proofField = holder.getByLabel("Ownership proof JSON", { exact: true });
  await expect(proofField).toBeVisible();
  const proofText = await proofField.inputValue();
  expect(wallet.log).toContain(`wallet_switchEthereumChain on ${home.chainId}`);
  expect(wallet.log).toContain(`eth_signTypedData_v4 on ${home.chainId}`);

  const beforeScan = ownerReads;
  await verifier.getByLabel("Ownership proof text", { exact: true }).fill(proofText);
  await verifier.getByRole("button", { name: "Verify ownership proof", exact: true }).click();
  await expect(verifier.getByText(/Ownership verified:/)).toBeVisible();
  expect(ownerReads).toBeGreaterThan(beforeScan);
  const afterSuccess = ownerReads;
  await verifier.getByRole("button", { name: "Verify ownership proof", exact: true }).click();
  await expect(verifier.getByText(/Ownership not verified: already used/)).toBeVisible();
  expect(ownerReads).toBe(afterSuccess);
  await holder.close();
});

test("the holder can resume the camera and scan a replacement challenge", async ({ page }) => {
  await installCamera(page);
  const first: ChallengeRecord = {
    tokenId: TOKEN.tokenId.toString(),
    chainId: home.chainId,
    contract: home.address,
    nonce: `0x${"ab".repeat(32)}`,
    expiresAt: String(Math.floor(Date.now() / 1000) + 120),
  };
  const second: ChallengeRecord = {
    ...first,
    tokenId: (TOKEN.tokenId + 1n).toString(),
    nonce: `0x${"cd".repeat(32)}`,
  };
  await page.goto("/prove");
  await showCameraCode(page, encodeOwnershipChallenge(first));
  await expect(page.getByText(`Sign for token ${first.tokenId}`, { exact: false })).toBeVisible();
  const resume = page.getByRole("button", { name: "Scan another code", exact: true });
  await expect(resume).toBeVisible();
  const before = await page.evaluate(() => window.__cameraFrames);
  await showCameraCode(page, encodeOwnershipChallenge(second));
  await expect.poll(() => page.evaluate(() => window.__cameraFrames)).toBeGreaterThan(before + 2);
  await expect(page.getByText(`Sign for token ${first.tokenId}`, { exact: false })).toBeVisible();
  await expect(page.getByText(`Sign for token ${second.tokenId}`, { exact: false })).toHaveCount(0);
  await resume.click();
  await expect(page.getByText(`Sign for token ${second.tokenId}`, { exact: false })).toBeVisible();
  await expect(resume).toBeVisible();
});

test("a verifier can resume the camera and retry after a transient owner read failure", async ({
  page,
}) => {
  await installCamera(page);
  await installMockChain(page, TOKEN);
  let unavailable = false;
  let ownerReads = 0;
  const rpcUrl = getViemChain(home.chainId)?.rpcUrls.default.http[0];
  if (!rpcUrl) throw new Error("missing mock RPC");
  await page.route(rpcUrl, async (route) => {
    const body = route.request().postDataJSON();
    let readsOwner = false;
    try {
      readsOwner =
        body.method === "eth_call" &&
        decodeFunctionData({ abi: whiskyDistilleryAbi, data: body.params?.[0]?.data as Hex })
          .functionName === "ownerOf";
    } catch {
      /* other RPC methods are answered by installMockChain */
    }
    if (readsOwner) ownerReads++;
    if (readsOwner && unavailable) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: body.id,
          jsonrpc: "2.0",
          error: { code: -32603, message: "temporary owner RPC failure" },
        }),
      });
    } else await route.fallback();
  });
  await page.goto(`/passport/${TOKEN.tokenId}/verify-owner`);
  await page.getByRole("button", { name: "Create ownership challenge" }).click();
  const field = page.getByLabel("Ownership challenge JSON", { exact: true });
  await expect(field).toBeVisible();
  const record = decodeOwnershipChallenge(await field.inputValue());
  if (!record) throw new Error("invalid challenge fixture");
  const proof: OwnershipProof = {
    kind: "idpp-ownership-proof",
    v: 1,
    ...record,
    holder: account.address,
    signature: await account.signTypedData(ownershipTypedData(record, account.address)),
  };
  unavailable = true;
  await showCameraCode(page, JSON.stringify(proof));
  await expect(page.getByText(/Ownership not verified: chain unavailable/)).toBeVisible();
  const resume = page.getByRole("button", { name: "Scan another code", exact: true });
  await expect(resume).toBeVisible();
  const failedReads = ownerReads;
  const frames = await page.evaluate(() => window.__cameraFrames);
  await expect.poll(() => page.evaluate(() => window.__cameraFrames)).toBeGreaterThan(frames + 2);
  expect(ownerReads).toBe(failedReads);
  unavailable = false;
  await resume.click();
  await expect(page.getByText(/Ownership verified:/)).toBeVisible();
  expect(ownerReads).toBeGreaterThan(failedReads);
});

test("the default camera scanner still navigates and preserves the label deployment", async ({
  page,
}) => {
  await installCamera(page);
  await page.goto("/scan");
  await showCameraCode(
    page,
    "https://label.example/passport/421614000000000001?deployment=label-generation",
  );
  await expect(page).toHaveURL("/passport/421614000000000001?deployment=label-generation");
  await expect(page.getByText("This label was printed for", { exact: false })).toBeVisible();
});
