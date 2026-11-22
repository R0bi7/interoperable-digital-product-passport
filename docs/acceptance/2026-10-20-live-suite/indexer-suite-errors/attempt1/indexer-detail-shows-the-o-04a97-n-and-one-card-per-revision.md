# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: indexer.spec.ts >> detail >> shows the origin, the current chain and one card per revision
- Location: e2e-live/indexer.spec.ts:135:3

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  getByText(/^content: /)
Expected: 1
Received: 2
Timeout:  240000ms

Call log:
  - Expect "toHaveCount" getByText(/^content: /) with timeout 240000ms
  - waiting for getByText(/^content: /)
    6 × locator resolved to 0 elements
      - unexpected value "0"
    474 × locator resolved to 2 elements
        - unexpected value "2"

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
          - generic [ref=e32]:
            - generic [ref=e33]:
              - paragraph [ref=e34]: Passport
              - heading "84532000000000018" [level=1] [ref=e35]
              - generic [ref=e36]: held
            - generic [ref=e41]:
              - link "Revise" [ref=e42] [cursor=pointer]:
                - /url: /passport/84532000000000018/revise
              - link "Send to another chain" [ref=e43] [cursor=pointer]:
                - /url: /passport/84532000000000018/send
              - link "Verify owner" [ref=e44] [cursor=pointer]:
                - /url: /passport/84532000000000018/verify-owner
              - link "Prove ownership" [ref=e45] [cursor=pointer]:
                - /url: /prove
          - generic [ref=e46]:
            - generic [ref=e47]:
              - term [ref=e48]: Origin (originOf)
              - definition [ref=e49]: Base Sepolia (84532)
            - generic [ref=e50]:
              - term [ref=e51]: Deployment
              - definition [ref=e52]: whisky-v2-eval3
            - generic [ref=e53]:
              - term [ref=e54]: Current chain
              - definition [ref=e55]: Arbitrum Sepolia
            - generic [ref=e56]:
              - term [ref=e57]: Contract
              - definition [ref=e58]:
                - link "0xFE84e01B03Cae9B4AaD5678A5681B70bA77435C2" [ref=e59] [cursor=pointer]:
                  - /url: https://sepolia.arbiscan.io/address/0xFE84e01B03Cae9B4AaD5678A5681B70bA77435C2
            - generic [ref=e60]:
              - term [ref=e61]: Owner
              - definition [ref=e62]:
                - link "0x9415e00f429549a26310c83c1f47db40eb300415" [ref=e63] [cursor=pointer]:
                  - /url: https://sepolia.arbiscan.io/address/0x9415e00f429549a26310c83c1f47db40eb300415
            - generic [ref=e64]:
              - term [ref=e65]: Revision
              - definition [ref=e66]: "0"
            - generic [ref=e67]:
              - term [ref=e68]: CID
              - definition [ref=e69]: bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
        - generic [ref=e70]:
          - heading "Live confirmation" [level=2] [ref=e71]
          - generic [ref=e72]:
            - paragraph [ref=e73]:
              - text: Read
              - code [ref=e74]: ownerOf
              - text: and
              - code [ref=e75]: passportOf
              - text: on Arbitrum Sepolia in one multicall at block 321107059.
            - paragraph [ref=e76]: The live read agrees with the indexer.
        - generic [ref=e77]:
          - heading "Indexer progress" [level=2] [ref=e78]
          - list [ref=e79]:
            - listitem [ref=e80]: "Arbitrum Sepolia: indexed block 321107052 of 321107054 (2 blocks behind)"
        - generic [ref=e81]:
          - heading "QR code" [level=2] [ref=e82]
          - generic [ref=e83]:
            - img "QR code linking to http://localhost:3113/passport/84532000000000018?deployment=whisky-v2-eval3" [ref=e84]
            - generic [ref=e87]:
              - paragraph [ref=e88]: Print this on the cask or bottle. Scanning it opens this passport and its verification.
              - paragraph [ref=e89]: http://localhost:3113/passport/84532000000000018?deployment=whisky-v2-eval3
              - generic [ref=e90]:
                - button "Download PNG" [ref=e91]
                - button "Copy link" [ref=e92]
        - generic [ref=e93]:
          - heading "Timeline" [level=2] [ref=e94]
          - list [ref=e95]:
            - listitem [ref=e96]:
              - generic [ref=e97]: Issued on Base Sepolia
              - generic [ref=e98]:
                - text: 2026-10-20T03:58:06Z, block 48350199,
                - link "0x4cb494b4…9483ee" [ref=e99] [cursor=pointer]:
                  - /url: https://sepolia.basescan.org/tx/0x4cb494b4435e0238efe502b65bc3b96b4efe97cef76fcb96a1c1c87f0c9483ee
            - listitem [ref=e100]:
              - generic [ref=e101]: "Hop: Base Sepolia to Arbitrum Sepolia"
              - generic [ref=e102]:
                - text: Sent 2026-10-20T03:58:10Z, block 48350201,
                - link "0xfef22a70…7fbc80" [ref=e103] [cursor=pointer]:
                  - /url: https://sepolia.basescan.org/tx/0xfef22a7057ec4f31117f09ced8224c5649247512ae1059270dd3ebf22a7fbc80
              - generic [ref=e104]:
                - text: Received 2026-10-20T03:58:40Z, block 320939873,
                - link "0x91970fed…fa06ff" [ref=e105] [cursor=pointer]:
                  - /url: https://sepolia.arbiscan.io/tx/0x91970fed3d2b8b6cc623551e94fb17671f69448d36c7110e65ac12b368fa06ff
              - generic [ref=e106]: "Block interval (approximate): 30 s(difference of the two block timestamps, not a latency measurement)"
              - generic [ref=e107]: guid 0x43fa6ac44e4c329cc9fed836fce4d109fc5b65a46332d6e2980da6781824ba9f
              - link "LayerZero Scan" [ref=e108] [cursor=pointer]:
                - /url: https://testnet.layerzeroscan.com/tx/0xfef22a7057ec4f31117f09ced8224c5649247512ae1059270dd3ebf22a7fbc80
        - generic [ref=e109]:
          - heading "Revisions and verification" [level=2] [ref=e110]
          - paragraph [ref=e111]:
            - text: "Checked in this browser on the raw bytes from the gateway: content (bytes hash to the CID), binding (envelope names this deployment, token and revision), history (each previousCid is the preceding revision's CID), recorded on chain (the emitting contract receipt confirms this CID, revision and author; timestamps remain indexer-sourced), and once for the passport history hash (the CIDs of every revision, in order, recompute the"
            - code [ref=e112]: historyHash
            - text: of the live
            - code [ref=e113]: passportOf
            - text: read).
          - generic [ref=e114]: "history hash: verified"
          - list [ref=e120]:
            - listitem [ref=e121]:
              - generic [ref=e122]:
                - heading "Revision 0" [level=3] [ref=e123]
                - generic [ref=e124]:
                  - text: Base Sepolia, 2026-10-20T03:58:06Z,
                  - link "tx" [ref=e125] [cursor=pointer]:
                    - /url: https://sepolia.basescan.org/tx/0x4cb494b4435e0238efe502b65bc3b96b4efe97cef76fcb96a1c1c87f0c9483ee
              - generic [ref=e126]: bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaCID from passportOf on chain (live read)
              - generic [ref=e127]:
                - 'generic "payload unavailable: CID is not a CIDv1 raw sha2-256 base32 CID" [ref=e128]': "content: unavailable"
                - 'generic "payload unavailable: CID is not a CIDv1 raw sha2-256 base32 CID" [ref=e132]': "binding: unavailable"
                - 'generic "not evaluated: content is unavailable" [ref=e136]': "history: unavailable"
                - generic [ref=e140]: "recorded on chain: verified"
              - list [ref=e144]:
                - listitem [ref=e145]: "content: payload unavailable: CID is not a CIDv1 raw sha2-256 base32 CID"
                - listitem [ref=e146]: "binding: payload unavailable: CID is not a CIDv1 raw sha2-256 base32 CID"
                - listitem [ref=e147]: "history: not evaluated: content is unavailable"
  - alert [ref=e148]
```

# Test source

```ts
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
  109 |     await expect(rows).toHaveCount(onChain.length);
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
> 143 |     await expect(page.getByText(/^content: /)).toHaveCount(subject.revisions.length, {
      |                                                ^ Error: expect(locator).toHaveCount(expected) failed
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
  210 |   });
  211 | 
  212 |   test("a forged mint request is refused before any pin or transaction", async ({ request }) => {
  213 |     const signature = await stranger.signMessage({ message: "IDPP mint challenge: forged" });
  214 |     const response = await request.post("/api/mint", {
  215 |       data: {
  216 |         chainId: 421614,
  217 |         to: stranger.address,
  218 |         envelopeData: { kind: "cask", granularity: "item", data: {} },
  219 |         address: stranger.address,
  220 |         signature,
  221 |       },
  222 |     });
  223 |     expect(response.status()).toBe(403);
  224 |     expect(await response.json()).toMatchObject({ error: { code: "not_allowlisted" } });
  225 |   });
  226 | });
  227 | 
  228 | test.describe("send, observed by the indexer", () => {
  229 |   test.skip(!process.env.LIVE_SPEND, "set LIVE_SPEND=1 to send a token (testnet gas)");
  230 | 
  231 |   test("the indexer places the token on the destination and the panel cites it", async ({
  232 |     browser,
  233 |     baseURL,
  234 |   }) => {
  235 |     const account = loadAccount();
  236 |     const timings = createTimingRecorder(INDEXER_URL);
  237 |     const short = `${account.address.slice(0, 4)}…${account.address.slice(-4)}`;
  238 |     const page: Page = await (await browser.newContext({ baseURL })).newPage();
  239 |     await installWallet(page, account);
  240 | 
  241 |     const from = subject.currentChainId as number;
  242 |     const to = from === 84532 ? 421614 : 84532;
  243 |     const owner = await publicClientFor(from).readContract({
```