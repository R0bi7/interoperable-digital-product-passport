import { MANIFEST } from "@idpp/passport-config";
import { expect, type Page, test } from "@playwright/test";
import { toHex } from "viem";
import { generatePrivateKey, type PrivateKeyAccount, privateKeyToAccount } from "viem/accounts";
import {
  installAddressOnlyWallet,
  installKeyBackedWallet,
  installMockChain,
  MINED_BLOCK,
  type MockToken,
} from "./mock-chain";

// A same-chain ownership transfer is a holder right; issuers revise but do not transfer.
const HOLDER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const ISSUER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const RECEIVER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as const;
const home = MANIFEST.chains[0];
if (!home) throw new Error("manifest has no chains");
const TOKEN: MockToken = {
  tokenId: BigInt(home.chainId) * 10n ** 12n + 7n,
  chainId: home.chainId,
  owner: HOLDER,
  issuers: [ISSUER],
};
const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

async function openTransferAs(
  page: Page,
  address: `0x${string}`,
  token: MockToken = TOKEN,
  signer?: PrivateKeyAccount,
) {
  await installMockChain(page, token);
  if (signer) await installKeyBackedWallet(page, token, signer);
  else await installAddressOnlyWallet(page, token, address);
  await page.goto(`/passport/${token.tokenId}/transfer`);
  await expect(page.getByText(`held by ${token.owner}`, { exact: false })).toBeVisible();
  const connected = page.getByRole("button", { name: short(address) }).first();
  // wagmi reconnects an injected wallet that already reports its account; connect only otherwise.
  const reconnected = await connected
    .waitFor({ timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!reconnected) {
    await page.getByRole("button", { name: "Connect Wallet" }).first().click();
    await page.getByRole("dialog").getByText("Mock Wallet").click();
  }
  await expect(connected).toBeVisible();
}

test.describe("same-chain ownership transfer is a holder right", () => {
  test.skip(({ isMobile }) => isMobile, "the connect flow is covered on desktop");

  test("the holder may submit only with a valid new holder and the confirmation", async ({
    page,
  }) => {
    await openTransferAs(page, HOLDER);
    const submit = page.getByRole("button", { name: "Transfer ownership", exact: true });
    const receiver = page.getByLabel("New holder address");
    await expect(page.getByText("Enter the new holder's address.").first()).toBeVisible();
    await expect(submit).toBeDisabled();

    await receiver.fill("0x1234");
    await expect(page.getByText(/not a valid address/)).toBeVisible();
    await receiver.fill(HOLDER);
    await expect(page.getByText("The new holder is already the holder.")).toBeVisible();
    await receiver.fill(RECEIVER);
    await expect(page.getByText(/Confirm that you give up control/)).toBeVisible();
    await expect(submit).toBeDisabled();

    await page.getByRole("checkbox").check();
    await expect(submit).toBeEnabled();
  });

  test("an issuer who does not hold the token is refused", async ({ page }) => {
    await openTransferAs(page, ISSUER);
    await page.getByLabel("New holder address").fill(RECEIVER);
    await page.getByRole("checkbox").check();
    await expect(
      page.getByText(`Only the holder can transfer. The holder is ${HOLDER}.`),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Transfer ownership", exact: true }),
    ).toBeDisabled();
  });

  test("a submitted transfer is confirmed by the receipt event and a read-back", async ({
    page,
  }) => {
    const signer = privateKeyToAccount(generatePrivateKey());
    const token: MockToken = { ...TOKEN, owner: signer.address };
    await openTransferAs(page, signer.address, token, signer);
    await page.getByLabel("New holder address").fill(RECEIVER);
    await page.getByRole("checkbox").check();
    const submit = page.getByRole("button", { name: "Transfer ownership", exact: true });
    await submit.click();

    await expect(
      page.getByText(
        `Confirmed by a read at the transaction's block: ${RECEIVER} holds the token.`,
      ),
    ).toBeVisible();
    await expect(page.getByText("The passport record is unchanged at revision 0.")).toBeVisible();
    expect(token.owner).toBe(RECEIVER);
    expect(token.transactions).toHaveLength(1);
    // The read-back is pinned to the receipt's block on the holding chain's contract.
    const readBack = (token.reads ?? []).filter((read) => read.block === toHex(MINED_BLOCK));
    expect(readBack.map((read) => read.functionName).sort()).toEqual(["ownerOf", "passportOf"]);
    for (const read of readBack)
      expect(read.contract.toLowerCase()).toBe(home.address.toLowerCase());
    await expect(page.getByText(token.transactions?.[0]?.hash ?? "missing")).toBeVisible();
    await expect(submit).toBeDisabled();
    await expect(page.getByLabel("New holder address")).toBeDisabled();
    await expect(page.getByRole("link", { name: "Open the passport" })).toHaveAttribute(
      "href",
      `/passport/${token.tokenId}`,
    );
  });

  test("a mined but reverted transfer keeps its hash and offers no second transaction", async ({
    page,
  }) => {
    const signer = privateKeyToAccount(generatePrivateKey());
    const token: MockToken = { ...TOKEN, owner: signer.address, revert: true };
    await openTransferAs(page, signer.address, token, signer);
    await page.getByLabel("New holder address").fill(RECEIVER);
    await page.getByRole("checkbox").check();
    const submit = page.getByRole("button", { name: "Transfer ownership", exact: true });
    await submit.click();

    await expect(page.getByText(/was mined but reverted/)).toBeVisible();
    await expect(page.getByText(token.transactions?.[0]?.hash ?? "missing")).toBeVisible();
    expect(token.owner).toBe(signer.address);
    await expect(submit).toBeDisabled();
    await expect(page.getByText(/Confirmed by a read/)).toHaveCount(0);
  });

  test("editing the receiver clears the confirmation", async ({ page }) => {
    await openTransferAs(page, HOLDER);
    await page.getByLabel("New holder address").fill(RECEIVER);
    await page.getByRole("checkbox").check();
    await page.getByLabel("New holder address").fill(ISSUER);
    await expect(page.getByRole("checkbox")).not.toBeChecked();
    await expect(
      page.getByRole("button", { name: "Transfer ownership", exact: true }),
    ).toBeDisabled();
  });

  test("the passport page links to the transfer page", async ({ page }) => {
    await page.goto(`/passport/421614000000000001`);
    await expect(page.getByRole("link", { name: "Transfer ownership" })).toHaveAttribute(
      "href",
      "/passport/421614000000000001/transfer",
    );
  });
});
