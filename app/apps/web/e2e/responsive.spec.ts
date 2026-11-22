import { MANIFEST } from "@idpp/passport-config";
import { expect, test } from "@playwright/test";
import { installAddressOnlyWallet, installMockChain, type MockToken } from "./mock-chain";

const account = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const token: MockToken = {
  tokenId: 421614000000000001n,
  chainId: MANIFEST.chains[0]?.chainId ?? 421614,
  owner: account,
  issuers: [account],
  balanceWei: 95_000_000_000_000_000n,
};

// Explicit CSS-pixel sizes cover phones, the two header breakpoints and the reported wide screen.
for (const width of [320, 390, 768, 1024, 1280, 2052]) {
  for (const connected of [false, true]) {
    test.describe(`wallet ${connected ? "connected" : "disconnected"} at ${width}px`, () => {
      test.use({
        viewport: { width, height: 900 },
        // The app stays dark even when the connected device prefers light mode.
        colorScheme: connected ? "light" : "dark",
        isMobile: width < 768,
        hasTouch: width < 1024,
      });

      test("passport flows fit without overlapping header controls", async ({ page }, info) => {
        await installMockChain(page, token);
        await page.route("**/api/readiness*", (route) =>
          route.fulfill({
            json: {
              publicationConfigured: true,
              allowlisted: connected ? true : null,
            },
          }),
        );
        if (connected) await installAddressOnlyWallet(page, token, account);
        await page.goto("/mint");
        await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
        await expect(page.locator("body")).toHaveCSS("background-color", "rgb(8, 9, 11)");
        if (connected) {
          const sign = page.getByRole("button", { name: "Sign and mint", exact: true });
          const reconnected = await sign
            .waitFor({ timeout: 2000 })
            .then(() => true)
            .catch(() => false);
          if (!reconnected) {
            await page.getByRole("button", { name: "Connect Wallet", exact: true }).first().click();
            await page.getByRole("dialog").getByText("Mock Wallet", { exact: true }).click();
          }
          await expect(sign).toBeEnabled();
        }

        let challengeText: string | undefined;
        const routes = [
          ["mint", "/mint"],
          ["list", "/"],
          ["detail", `/passport/${token.tokenId}`],
          ...(connected
            ? ([
                ["revise", `/passport/${token.tokenId}/revise`],
                ["send", `/passport/${token.tokenId}/send`],
                ["transfer", `/passport/${token.tokenId}/transfer`],
                ["verify-owner", `/passport/${token.tokenId}/verify-owner`],
                ["prove-owner", "/prove"],
              ] as const)
            : []),
        ] as const;
        for (const [name, path] of routes) {
          if (name !== "mint") await page.goto(path);
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          const header = page.getByRole("banner");
          if (connected)
            await expect(header.getByRole("button", { name: "Chain Selector" })).toBeVisible();
          else
            await expect(
              header.getByRole("button", { name: "Connect Wallet", exact: true }),
            ).toBeVisible();
          // Wallet controls are secondary navigation: keep both connected and disconnected
          // states white-on-black, including on devices that prefer a light theme.
          for (const button of await header.getByRole("button").all()) {
            if (!(await button.isVisible())) continue;
            await expect(button).toHaveCSS("color", "rgb(245, 245, 245)");
            await expect(button).toHaveCSS("background-color", "rgb(8, 9, 11)");
          }
          if (name === "list") {
            await page.getByRole("button", { name: "Check readiness", exact: true }).click();
            await expect(
              page.getByText("Fixture mode: live discovery and catch-up are not checked."),
            ).toBeVisible();
            await expect(
              page.getByText("Some checks need attention before the live demonstration."),
            ).toBeVisible();
          }
          if (name === "list")
            await expect(
              page.getByRole("link", { name: "421614000000000001", exact: true }),
            ).toBeVisible();
          if (name === "detail")
            await expect(
              page.getByRole("heading", { name: "Revisions and verification", exact: true }),
            ).toBeVisible();

          if (name === "revise") {
            await expect(
              page.getByRole("button", { name: "Pin and revise", exact: true }),
            ).toBeEnabled();
            await expect(page.getByLabel("Distillery", { exact: false })).toHaveValue(
              "Demo Distillery",
            );
          }
          if (name === "send") {
            await expect(page.getByText(/Native fee:/)).toBeVisible();
            await expect(page.getByText(/0.001 ETH/)).toBeVisible();
            await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
          }
          if (name === "transfer") {
            await page
              .getByLabel("New holder address")
              .fill("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
            await page.getByRole("checkbox").check();
            await expect(
              page.getByRole("button", { name: "Transfer ownership", exact: true }),
            ).toBeEnabled();
          }
          if (name === "verify-owner") {
            await page
              .getByRole("button", { name: "Create ownership challenge", exact: true })
              .click();
            await expect(
              page.getByRole("img", { name: "Ownership challenge QR code", exact: true }),
            ).toBeVisible();
            challengeText = await page
              .getByLabel("Ownership challenge JSON", { exact: true })
              .inputValue();
            await page.getByLabel("Ownership proof text", { exact: true }).fill("{}");
            await page.getByRole("button", { name: "Verify ownership proof", exact: true }).click();
            await expect(page.getByText(/Ownership not verified: invalid proof/)).toBeVisible();
          }
          if (name === "prove-owner") {
            if (!challengeText) throw new Error("No verifier challenge was created");
            await page.getByLabel("Ownership challenge text", { exact: true }).fill(challengeText);
            await page
              .getByRole("button", { name: "Read ownership challenge", exact: true })
              .click();
            await expect(
              page.getByRole("button", { name: "Sign ownership challenge", exact: true }),
            ).toBeEnabled();
          }

          if (
            (name === "mint" ||
              name === "revise" ||
              name === "send" ||
              name === "transfer" ||
              name === "prove-owner") &&
            width >= 1024
          ) {
            await page.evaluate(() => window.scrollTo(0, 350));
            const panel = await page
              .getByRole("complementary", {
                name:
                  name === "revise"
                    ? "Review revision"
                    : name === "send"
                      ? "Review transfer"
                      : name === "transfer"
                        ? "Review ownership transfer"
                        : name === "prove-owner"
                          ? "Review and sign"
                          : "Review and mint",
                exact: true,
              })
              .boundingBox();
            const banner = await header.boundingBox();
            expect(panel).not.toBeNull();
            expect(banner).not.toBeNull();
            if (panel && banner)
              expect(panel.y, "sticky panel must clear the header").toBeGreaterThanOrEqual(
                banner.y + banner.height,
              );
            await page.evaluate(() => window.scrollTo(0, 0));
          }

          // Form interaction scrolls focused controls into view. Capture the settled page from
          // its origin so sticky headers do not appear in the middle of full-page screenshots.
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({
            path: info.outputPath(`${name}-${width}.png`),
            fullPage: true,
            animations: "disabled",
          });
          const geometry = await page.evaluate(() => {
            const rect = (element: Element) => {
              const r = element.getBoundingClientRect();
              return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
            };
            const header = document.querySelector("header");
            if (!header) throw new Error("missing header");
            const brand = header.querySelector("a");
            const nav = header.querySelector("nav");
            if (!brand || !nav) throw new Error("missing brand or navigation");
            return {
              overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              viewport: document.documentElement.clientWidth,
              brand: rect(brand),
              nav: rect(nav),
              buttons: [...header.querySelectorAll("button")]
                .filter((e) => e.getBoundingClientRect().width > 0)
                .map(rect),
            };
          });
          expect(geometry.overflow, `${path}: horizontal overflow`).toBeLessThanOrEqual(0);
          for (const button of geometry.buttons) {
            expect(button.left, `${path}: wallet left edge`).toBeGreaterThanOrEqual(0);
            expect(button.right, `${path}: wallet right edge`).toBeLessThanOrEqual(
              geometry.viewport,
            );
            const overlapsNav =
              button.left < geometry.nav.right &&
              button.right > geometry.nav.left &&
              button.top < geometry.nav.bottom &&
              button.bottom > geometry.nav.top;
            expect(overlapsNav, `${path}: wallet overlaps navigation`).toBe(false);
            if (width >= 1280) {
              expect(
                Math.max(button.top, geometry.brand.top, geometry.nav.top),
                `${path}: wide header should occupy one row`,
              ).toBeLessThan(Math.min(button.bottom, geometry.brand.bottom, geometry.nav.bottom));
            }
          }
        }
      });
    });
  }
}
