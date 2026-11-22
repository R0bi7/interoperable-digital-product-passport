# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: indexer.spec.ts >> list >> filters by status and by chain the way the API does
- Location: e2e-live/indexer.spec.ts:101:3

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  getByRole('row').filter({ has: getByRole('link') })
Expected: 34
Received: 20
Timeout:  60000ms

Call log:
  - Expect "toHaveCount" getByRole('row').filter({ has: getByRole('link') }) with timeout 60000ms
  - waiting for getByRole('row').filter({ has: getByRole('link') })
    - locator resolved to 0 elements
    - unexpected value "0"
    122 × locator resolved to 20 elements
        - unexpected value "20"

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e3]:
    - link "Skip to content" [ref=e4] [cursor=pointer]:
      - /url: "#main"
    - banner [ref=e5]:
      - generic [ref=e6]:
        - generic [ref=e7]:
          - link "Whisky Distillery Interoperable Digital Product Passport" [ref=e8] [cursor=pointer]:
            - /url: /
            - generic [ref=e9]: Whisky Distillery
            - generic [ref=e10]: Interoperable Digital Product Passport
          - navigation "Main" [ref=e11]:
            - link "Passports" [ref=e12] [cursor=pointer]:
              - /url: /
            - link "Scan" [ref=e17] [cursor=pointer]:
              - /url: /scan
            - link "Mint" [ref=e21] [cursor=pointer]:
              - /url: /mint
        - generic [ref=e25]:
          - button "Connect Wallet" [ref=e27] [cursor=pointer]
          - status [ref=e28]: No browser wallet found. Install an Ethereum wallet extension (for example MetaMask) and reload.
    - main [ref=e29]:
      - generic [ref=e30]:
        - generic [ref=e31]:
          - heading "Passports" [level=1] [ref=e33]
          - paragraph [ref=e34]: Casks and bottles of the distillery, tracked across chains. Open one to verify its payload against the chain.
        - generic [ref=e35]:
          - generic [ref=e36]:
            - generic [ref=e37]:
              - text: Chain
              - combobox "Chain" [ref=e38]:
                - option "All chains"
                - option "Arbitrum Sepolia" [selected]
                - option "Base Sepolia"
                - option "Sepolia"
            - generic [ref=e39]:
              - text: Status
              - combobox "Status" [ref=e40]:
                - option "All statuses" [selected]
                - option "held"
                - option "in flight"
                - option "incomplete"
            - button "Clear filters" [ref=e41]
          - table [ref=e44]:
            - rowgroup [ref=e45]:
              - row [ref=e46]:
                - columnheader "Token id" [ref=e47]
                - columnheader "Status" [ref=e48]
                - columnheader "Chain" [ref=e49]
                - columnheader "Origin" [ref=e50]
                - columnheader "Revision" [ref=e51]
            - rowgroup [ref=e52]:
              - row [ref=e53]:
                - cell [ref=e54]:
                  - link "421614000000000000" [ref=e55] [cursor=pointer]:
                    - /url: /passport/421614000000000000
                - cell "held" [ref=e56]
                - cell "Arbitrum Sepolia" [ref=e61]
                - cell "Arbitrum Sepolia" [ref=e62]
                - cell "1" [ref=e63]
              - row [ref=e64]:
                - cell [ref=e65]:
                  - link "421614000000000001" [ref=e66] [cursor=pointer]:
                    - /url: /passport/421614000000000001
                - cell "held" [ref=e67]
                - cell "Arbitrum Sepolia" [ref=e72]
                - cell "Arbitrum Sepolia" [ref=e73]
                - cell "1" [ref=e74]
              - row [ref=e75]:
                - cell [ref=e76]:
                  - link "421614000000000002" [ref=e77] [cursor=pointer]:
                    - /url: /passport/421614000000000002
                - cell "held" [ref=e78]
                - cell "Arbitrum Sepolia" [ref=e83]
                - cell "Arbitrum Sepolia" [ref=e84]
                - cell "2" [ref=e85]
              - row [ref=e86]:
                - cell [ref=e87]:
                  - link "421614000000000003" [ref=e88] [cursor=pointer]:
                    - /url: /passport/421614000000000003
                - cell "held" [ref=e89]
                - cell "Arbitrum Sepolia" [ref=e94]
                - cell "Arbitrum Sepolia" [ref=e95]
                - cell "2" [ref=e96]
              - row [ref=e97]:
                - cell [ref=e98]:
                  - link "421614000000000004" [ref=e99] [cursor=pointer]:
                    - /url: /passport/421614000000000004
                - cell "held" [ref=e100]
                - cell "Arbitrum Sepolia" [ref=e105]
                - cell "Arbitrum Sepolia" [ref=e106]
                - cell "10" [ref=e107]
              - row [ref=e108]:
                - cell [ref=e109]:
                  - link "421614000000000005" [ref=e110] [cursor=pointer]:
                    - /url: /passport/421614000000000005
                - cell "held" [ref=e111]
                - cell "Arbitrum Sepolia" [ref=e116]
                - cell "Arbitrum Sepolia" [ref=e117]
                - cell "0" [ref=e118]
              - row [ref=e119]:
                - cell [ref=e120]:
                  - link "421614000000000006" [ref=e121] [cursor=pointer]:
                    - /url: /passport/421614000000000006
                - cell "held" [ref=e122]
                - cell "Arbitrum Sepolia" [ref=e127]
                - cell "Arbitrum Sepolia" [ref=e128]
                - cell "0" [ref=e129]
              - row [ref=e130]:
                - cell [ref=e131]:
                  - link "421614000000000007" [ref=e132] [cursor=pointer]:
                    - /url: /passport/421614000000000007
                - cell "held" [ref=e133]
                - cell "Arbitrum Sepolia" [ref=e138]
                - cell "Arbitrum Sepolia" [ref=e139]
                - cell "0" [ref=e140]
              - row [ref=e141]:
                - cell [ref=e142]:
                  - link "421614000000000008" [ref=e143] [cursor=pointer]:
                    - /url: /passport/421614000000000008
                - cell "held" [ref=e144]
                - cell "Arbitrum Sepolia" [ref=e149]
                - cell "Arbitrum Sepolia" [ref=e150]
                - cell "0" [ref=e151]
              - row [ref=e152]:
                - cell [ref=e153]:
                  - link "421614000000000009" [ref=e154] [cursor=pointer]:
                    - /url: /passport/421614000000000009
                - cell "held" [ref=e155]
                - cell "Arbitrum Sepolia" [ref=e160]
                - cell "Arbitrum Sepolia" [ref=e161]
                - cell "0" [ref=e162]
              - row [ref=e163]:
                - cell [ref=e164]:
                  - link "421614000000000010" [ref=e165] [cursor=pointer]:
                    - /url: /passport/421614000000000010
                - cell "held" [ref=e166]
                - cell "Arbitrum Sepolia" [ref=e171]
                - cell "Arbitrum Sepolia" [ref=e172]
                - cell "0" [ref=e173]
              - row [ref=e174]:
                - cell [ref=e175]:
                  - link "421614000000000011" [ref=e176] [cursor=pointer]:
                    - /url: /passport/421614000000000011
                - cell "held" [ref=e177]
                - cell "Arbitrum Sepolia" [ref=e182]
                - cell "Arbitrum Sepolia" [ref=e183]
                - cell "0" [ref=e184]
              - row [ref=e185]:
                - cell [ref=e186]:
                  - link "421614000000000012" [ref=e187] [cursor=pointer]:
                    - /url: /passport/421614000000000012
                - cell "held" [ref=e188]
                - cell "Arbitrum Sepolia" [ref=e193]
                - cell "Arbitrum Sepolia" [ref=e194]
                - cell "0" [ref=e195]
              - row [ref=e196]:
                - cell [ref=e197]:
                  - link "421614000000000013" [ref=e198] [cursor=pointer]:
                    - /url: /passport/421614000000000013
                - cell "held" [ref=e199]
                - cell "Arbitrum Sepolia" [ref=e204]
                - cell "Arbitrum Sepolia" [ref=e205]
                - cell "0" [ref=e206]
              - row [ref=e207]:
                - cell [ref=e208]:
                  - link "421614000000000014" [ref=e209] [cursor=pointer]:
                    - /url: /passport/421614000000000014
                - cell "held" [ref=e210]
                - cell "Arbitrum Sepolia" [ref=e215]
                - cell "Arbitrum Sepolia" [ref=e216]
                - cell "0" [ref=e217]
              - row [ref=e218]:
                - cell [ref=e219]:
                  - link "421614000000000015" [ref=e220] [cursor=pointer]:
                    - /url: /passport/421614000000000015
                - cell "held" [ref=e221]
                - cell "Arbitrum Sepolia" [ref=e226]
                - cell "Arbitrum Sepolia" [ref=e227]
                - cell "0" [ref=e228]
              - row [ref=e229]:
                - cell [ref=e230]:
                  - link "421614000000000016" [ref=e231] [cursor=pointer]:
                    - /url: /passport/421614000000000016
                - cell "held" [ref=e232]
                - cell "Arbitrum Sepolia" [ref=e237]
                - cell "Arbitrum Sepolia" [ref=e238]
                - cell "0" [ref=e239]
              - row [ref=e240]:
                - cell [ref=e241]:
                  - link "421614000000000017" [ref=e242] [cursor=pointer]:
                    - /url: /passport/421614000000000017
                - cell "held" [ref=e243]
                - cell "Arbitrum Sepolia" [ref=e248]
                - cell "Arbitrum Sepolia" [ref=e249]
                - cell "0" [ref=e250]
              - row [ref=e251]:
                - cell [ref=e252]:
                  - link "421614000000000018" [ref=e253] [cursor=pointer]:
                    - /url: /passport/421614000000000018
                - cell "held" [ref=e254]
                - cell "Arbitrum Sepolia" [ref=e259]
                - cell "Arbitrum Sepolia" [ref=e260]
                - cell "0" [ref=e261]
              - row [ref=e262]:
                - cell [ref=e263]:
                  - link "421614000000000019" [ref=e264] [cursor=pointer]:
                    - /url: /passport/421614000000000019
                - cell "held" [ref=e265]
                - cell "Arbitrum Sepolia" [ref=e270]
                - cell "Arbitrum Sepolia" [ref=e271]
                - cell "0" [ref=e272]
          - button "Load more" [ref=e273]
  - alert [ref=e274]
```

# Test source

```ts
  9   |  * the indexer's own HTTP API (which `apps/indexer/tests-live` checks against the chains), so a
  10  |  * mismatch here is a rendering or wiring fault. `LIVE_SPEND=1` adds one cross-chain send.
  11  |  */
  12  | 
  13  | const INDEXER_URL = (process.env.INDEXER_URL ?? "http://localhost:42069").replace(/\/$/, "");
  14  | 
  15  | type Entry = { kind: string; chainId: number; guid?: string; txHash: string };
  16  | type Summary = {
  17  |   tokenId: string;
  18  |   originChainId: number;
  19  |   currentChainId: number | null;
  20  |   status: "held" | "in_flight" | "incomplete";
  21  |   owner: string | null;
  22  |   revision: string | null;
  23  |   cid: string | null;
  24  |   revisions: { revision: string; conflict: boolean }[];
  25  |   timeline: Entry[];
  26  | };
  27  | 
  28  | const KIND_LABEL: Record<string, string> = {
  29  |   issued: "Issued",
  30  |   revised: "Revised",
  31  |   transferred: "Ownership transferred",
  32  |   sent: "Sent",
  33  |   received: "Received",
  34  | };
  35  | const CHAIN_NAME: Record<number, string> = {
  36  |   421614: "Arbitrum Sepolia",
  37  |   84532: "Base Sepolia",
  38  |   11155111: "Sepolia",
  39  | };
  40  | 
  41  | async function api<T>(path: string): Promise<T> {
  42  |   const response = await fetch(`${INDEXER_URL}${path}`);
  43  |   if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  44  |   return (await response.json()) as T;
  45  | }
  46  | 
  47  | async function listAll(): Promise<Summary[]> {
  48  |   const items: Summary[] = [];
  49  |   let cursor: string | null = null;
  50  |   do {
  51  |     const page: { items: Summary[]; nextCursor: string | null } = await api(
  52  |       `/api/passports?limit=100${cursor ? `&cursor=${cursor}` : ""}`,
  53  |     );
  54  |     items.push(...page.items);
  55  |     cursor = page.nextCursor;
  56  |   } while (cursor);
  57  |   return items;
  58  | }
  59  | 
  60  | let all: Summary[] = [];
  61  | /** A held token that has crossed chains, so its timeline holds a send and a receive. */
  62  | let subject: Summary;
  63  | 
  64  | test.beforeAll(async () => {
  65  |   all = await listAll().catch((error) => {
  66  |     throw new Error(`indexer not reachable at ${INDEXER_URL}: ${(error as Error).message}`);
  67  |   });
  68  |   const wanted = process.env.LIVE_TOKEN_ID;
  69  |   const held = all.filter((item) => item.status === "held");
  70  |   // Few revisions keep the page light on the public gateway, which rate-limits a burst of fetches;
  71  |   // among equals prefer a token away from its origin chain so "origin" and "current chain" differ.
  72  |   const crossed = held
  73  |     .filter((item) => item.timeline.some((e) => e.kind === "received"))
  74  |     .sort(
  75  |       (x, y) =>
  76  |         x.revisions.length - y.revisions.length ||
  77  |         Number(y.originChainId !== y.currentChainId) - Number(x.originChainId !== x.currentChainId),
  78  |     );
  79  |   const pick = wanted ? all.find((item) => item.tokenId === wanted) : (crossed[0] ?? held.at(-1));
  80  |   if (!pick) throw new Error("the indexer holds no passport to test against");
  81  |   subject = pick;
  82  |   console.log(
  83  |     `subject token ${subject.tokenId} (${subject.status}, ${subject.timeline.length} events)`,
  84  |   );
  85  | });
  86  | 
  87  | test.describe("list", () => {
  88  |   test("shows the indexer's passports, not fixtures", async ({ page }) => {
  89  |     await page.goto("/");
  90  |     await expect(page.getByText("Mock data")).toHaveCount(0);
  91  |     const rows = page.getByRole("row").filter({ has: page.getByRole("link") });
  92  |     await expect(rows.first()).toBeVisible();
  93  |     // The page asks for 20 at a time and offers "Load more" for the rest.
  94  |     while (await page.getByRole("button", { name: "Load more" }).isVisible()) {
  95  |       await page.getByRole("button", { name: "Load more" }).click();
  96  |     }
  97  |     await expect(rows).toHaveCount(all.length);
  98  |     await expect(rows.filter({ hasText: subject.tokenId })).toHaveCount(1);
  99  |   });
  100 | 
  101 |   test("filters by status and by chain the way the API does", async ({ page }) => {
  102 |     await page.goto("/");
  103 |     const rows = page.getByRole("row").filter({ has: page.getByRole("link") });
  104 |     await expect(rows.first()).toBeVisible();
  105 | 
  106 |     const chainId = subject.currentChainId as number;
  107 |     const onChain = all.filter((item) => item.currentChainId === chainId);
  108 |     await page.getByLabel("Chain").selectOption(String(chainId));
> 109 |     await expect(rows).toHaveCount(onChain.length);
      |                        ^ Error: expect(locator).toHaveCount(expected) failed
  110 |     await expect(rows.filter({ hasText: CHAIN_NAME[chainId] ?? "" }).first()).toBeVisible();
  111 | 
  112 |     await page.getByRole("button", { name: "Clear filters" }).click();
  113 |     await page.getByLabel("Status").selectOption("in_flight");
  114 |     const inFlight = all.filter((item) => item.status === "in_flight").length;
  115 |     if (inFlight === 0) {
  116 |       await expect(page.getByText("No passports match these filters.")).toBeVisible();
  117 |     } else {
  118 |       await expect(rows).toHaveCount(inFlight);
  119 |     }
  120 |   });
  121 | });
  122 | 
  123 | test.describe("detail", () => {
  124 |   test("renders the indexer's view and the chain confirms it", async ({ page }) => {
  125 |     await page.goto(`/passport/${subject.tokenId}`);
  126 |     await expect(page.getByRole("heading", { level: 1 })).toHaveText(subject.tokenId);
  127 |     await expect(page.locator("[data-status]").first()).toHaveAttribute("data-status", "held");
  128 |     await expect(page.getByText(subject.owner as string, { exact: false }).first()).toBeVisible();
  129 |     await expect(page.getByText("The live read agrees with the indexer.")).toBeVisible({
  130 |       timeout: 2 * 60_000,
  131 |     });
  132 |     await expect(page.getByText("Mock data")).toHaveCount(0);
  133 |   });
  134 | 
  135 |   test("shows the origin, the current chain and one card per revision", async ({ page }) => {
  136 |     await page.goto(`/passport/${subject.tokenId}`);
  137 |     const field = (label: string) =>
  138 |       page.getByText(label, { exact: true }).locator("xpath=following-sibling::*[1]");
  139 |     await expect(field("Origin (originOf)")).toContainText(CHAIN_NAME[subject.originChainId] ?? "");
  140 |     await expect(field("Current chain")).toHaveText(
  141 |       CHAIN_NAME[subject.currentChainId as number] ?? "",
  142 |     );
  143 |     await expect(page.getByText(/^content: /)).toHaveCount(subject.revisions.length, {
  144 |       timeout: 4 * 60_000,
  145 |     });
  146 |     const conflicts = subject.revisions.filter((r) => r.conflict).length;
  147 |     await expect(page.getByText("The indexer saw conflicting CIDs")).toHaveCount(conflicts);
  148 |   });
  149 | 
  150 |   test("lists every timeline event the indexer reports, hops merged", async ({ page }) => {
  151 |     await page.goto(`/passport/${subject.tokenId}`);
  152 |     const timeline = page.locator("section", {
  153 |       has: page.getByRole("heading", { name: "Timeline" }),
  154 |     });
  155 |     await expect(timeline).toBeVisible();
  156 |     const count = (kind: string) => subject.timeline.filter((e) => e.kind === kind).length;
  157 |     for (const kind of ["issued", "revised"]) {
  158 |       await expect(timeline.getByText(new RegExp(`^${KIND_LABEL[kind]} on `))).toHaveCount(
  159 |         count(kind),
  160 |       );
  161 |     }
  162 |     await expect(timeline.getByText(/^Hop: /)).toHaveCount(count("sent"));
  163 |     // A send and its receive share a guid and render as one hop.
  164 |     const guids = new Set(subject.timeline.filter((e) => e.kind === "sent").map((e) => e.guid));
  165 |     for (const guid of guids) await expect(timeline.getByText(guid as string)).toHaveCount(1);
  166 |   });
  167 | 
  168 |   test("verifies every revision's payload against its CID", async ({ page }) => {
  169 |     // Payloads come from a public gateway; a rate-limited fetch shows as unavailable, so reload.
  170 |     for (let attempt = 0; attempt < 4; attempt++) {
  171 |       await page.goto(`/passport/${subject.tokenId}`);
  172 |       await expect(page.getByText(/^content: /)).toHaveCount(subject.revisions.length, {
  173 |         timeout: 2 * 60_000,
  174 |       });
  175 |       if ((await page.getByText("content: verified").count()) === subject.revisions.length) break;
  176 |       await page.waitForTimeout(20_000);
  177 |     }
  178 |     await expect(page.getByText("content: verified")).toHaveCount(subject.revisions.length);
  179 |     await expect(page.getByText("binding: verified")).toHaveCount(subject.revisions.length);
  180 |     await expect(page.getByText("content: failed")).toHaveCount(0);
  181 |     await expect(page.getByText("binding: failed")).toHaveCount(0);
  182 |   });
  183 | 
  184 |   test("tells an unknown token from a malformed one", async ({ page }) => {
  185 |     await page.goto("/passport/421614000000999999");
  186 |     await expect(page.getByText("The indexer does not know token")).toBeVisible();
  187 |     expect((await page.goto("/passport/not-a-number"))?.status()).toBe(404);
  188 |   });
  189 | });
  190 | 
  191 | test.describe("scan", () => {
  192 |   test("opens the passport from a bare id and from its URL", async ({ page, baseURL }) => {
  193 |     for (const text of [subject.tokenId, `${baseURL}/passport/${subject.tokenId}`]) {
  194 |       await page.goto("/scan");
  195 |       await page.getByLabel("Token id or passport URL").fill(text);
  196 |       await page.getByRole("button", { name: "Open" }).click();
  197 |       await expect(page).toHaveURL(`/passport/${subject.tokenId}`);
  198 |       await expect(page.getByRole("heading", { level: 1 })).toHaveText(subject.tokenId);
  199 |     }
  200 |   });
  201 | });
  202 | 
  203 | test.describe("mint refusal (no gas, nothing pinned)", () => {
  204 |   const stranger = privateKeyToAccount(generatePrivateKey());
  205 | 
  206 |   test("a wallet outside the allowlist gets no challenge", async ({ request }) => {
  207 |     const response = await request.get(`/api/mint/challenge?address=${stranger.address}`);
  208 |     expect(response.status()).toBe(403);
  209 |     expect(await response.json()).toMatchObject({ error: { code: "not_allowlisted" } });
```