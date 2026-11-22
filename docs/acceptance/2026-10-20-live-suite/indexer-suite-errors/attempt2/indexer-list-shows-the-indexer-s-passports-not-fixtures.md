# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: indexer.spec.ts >> list >> shows the indexer's passports, not fixtures
- Location: e2e-live/indexer.spec.ts:88:3

# Error details

```
Test timeout of 900000ms exceeded.
```

```
Error: locator.click: Test timeout of 900000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Load more' })
    - locator resolved to <button tabindex="0" type="button" data-slot="button" class="group/button inline-flex shrink-0 items-center justify-center rounded-lg border bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:bor…>Load more</button>
  - attempting click action
    - waiting for element to be visible, enabled and stable
    - element is not stable
  - retrying click action
    - waiting for element to be visible, enabled and stable
  - element was detached from the DOM, retrying

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
                - option "All chains" [selected]
                - option "Arbitrum Sepolia"
                - option "Base Sepolia"
                - option "Sepolia"
            - generic [ref=e39]:
              - text: Status
              - combobox "Status" [ref=e40]:
                - option "All statuses" [selected]
                - option "held"
                - option "in flight"
                - option "incomplete"
          - table [ref=e43]:
            - rowgroup [ref=e44]:
              - row [ref=e45]:
                - columnheader "Token id" [ref=e46]
                - columnheader "Status" [ref=e47]
                - columnheader "Chain" [ref=e48]
                - columnheader "Origin" [ref=e49]
                - columnheader "Revision" [ref=e50]
            - rowgroup [ref=e51]:
              - row [ref=e52]:
                - cell [ref=e53]:
                  - link "84532000000000000" [ref=e54] [cursor=pointer]:
                    - /url: /passport/84532000000000000
                - cell "held" [ref=e55]
                - cell "Base Sepolia" [ref=e60]
                - cell "Base Sepolia" [ref=e61]
                - cell "1" [ref=e62]
              - row [ref=e63]:
                - cell [ref=e64]:
                  - link "84532000000000001" [ref=e65] [cursor=pointer]:
                    - /url: /passport/84532000000000001
                - cell "held" [ref=e66]
                - cell "Base Sepolia" [ref=e71]
                - cell "Base Sepolia" [ref=e72]
                - cell "1" [ref=e73]
              - row [ref=e74]:
                - cell [ref=e75]:
                  - link "84532000000000002" [ref=e76] [cursor=pointer]:
                    - /url: /passport/84532000000000002
                - cell "held" [ref=e77]
                - cell "Base Sepolia" [ref=e82]
                - cell "Base Sepolia" [ref=e83]
                - cell "10" [ref=e84]
              - row [ref=e85]:
                - cell [ref=e86]:
                  - link "84532000000000003" [ref=e87] [cursor=pointer]:
                    - /url: /passport/84532000000000003
                - cell "held" [ref=e88]
                - cell "Base Sepolia" [ref=e93]
                - cell "Base Sepolia" [ref=e94]
                - cell "0" [ref=e95]
              - row [ref=e96]:
                - cell [ref=e97]:
                  - link "84532000000000004" [ref=e98] [cursor=pointer]:
                    - /url: /passport/84532000000000004
                - cell "held" [ref=e99]
                - cell "Base Sepolia" [ref=e104]
                - cell "Base Sepolia" [ref=e105]
                - cell "0" [ref=e106]
              - row [ref=e107]:
                - cell [ref=e108]:
                  - link "84532000000000005" [ref=e109] [cursor=pointer]:
                    - /url: /passport/84532000000000005
                - cell "held" [ref=e110]
                - cell "Base Sepolia" [ref=e115]
                - cell "Base Sepolia" [ref=e116]
                - cell "0" [ref=e117]
              - row [ref=e118]:
                - cell [ref=e119]:
                  - link "84532000000000006" [ref=e120] [cursor=pointer]:
                    - /url: /passport/84532000000000006
                - cell "held" [ref=e121]
                - cell "Base Sepolia" [ref=e126]
                - cell "Base Sepolia" [ref=e127]
                - cell "0" [ref=e128]
              - row [ref=e129]:
                - cell [ref=e130]:
                  - link "84532000000000007" [ref=e131] [cursor=pointer]:
                    - /url: /passport/84532000000000007
                - cell "held" [ref=e132]
                - cell "Base Sepolia" [ref=e137]
                - cell "Base Sepolia" [ref=e138]
                - cell "0" [ref=e139]
              - row [ref=e140]:
                - cell [ref=e141]:
                  - link "84532000000000008" [ref=e142] [cursor=pointer]:
                    - /url: /passport/84532000000000008
                - cell "held" [ref=e143]
                - cell "Base Sepolia" [ref=e148]
                - cell "Base Sepolia" [ref=e149]
                - cell "0" [ref=e150]
              - row [ref=e151]:
                - cell [ref=e152]:
                  - link "84532000000000009" [ref=e153] [cursor=pointer]:
                    - /url: /passport/84532000000000009
                - cell "held" [ref=e154]
                - cell "Base Sepolia" [ref=e159]
                - cell "Base Sepolia" [ref=e160]
                - cell "0" [ref=e161]
              - row [ref=e162]:
                - cell [ref=e163]:
                  - link "84532000000000010" [ref=e164] [cursor=pointer]:
                    - /url: /passport/84532000000000010
                - cell "held" [ref=e165]
                - cell "Base Sepolia" [ref=e170]
                - cell "Base Sepolia" [ref=e171]
                - cell "0" [ref=e172]
              - row [ref=e173]:
                - cell [ref=e174]:
                  - link "84532000000000011" [ref=e175] [cursor=pointer]:
                    - /url: /passport/84532000000000011
                - cell "held" [ref=e176]
                - cell "Base Sepolia" [ref=e181]
                - cell "Base Sepolia" [ref=e182]
                - cell "0" [ref=e183]
              - row [ref=e184]:
                - cell [ref=e185]:
                  - link "84532000000000012" [ref=e186] [cursor=pointer]:
                    - /url: /passport/84532000000000012
                - cell "held" [ref=e187]
                - cell "Base Sepolia" [ref=e192]
                - cell "Base Sepolia" [ref=e193]
                - cell "0" [ref=e194]
              - row [ref=e195]:
                - cell [ref=e196]:
                  - link "84532000000000013" [ref=e197] [cursor=pointer]:
                    - /url: /passport/84532000000000013
                - cell "held" [ref=e198]
                - cell "Base Sepolia" [ref=e203]
                - cell "Base Sepolia" [ref=e204]
                - cell "0" [ref=e205]
              - row [ref=e206]:
                - cell [ref=e207]:
                  - link "84532000000000014" [ref=e208] [cursor=pointer]:
                    - /url: /passport/84532000000000014
                - cell "held" [ref=e209]
                - cell "Base Sepolia" [ref=e214]
                - cell "Base Sepolia" [ref=e215]
                - cell "0" [ref=e216]
              - row [ref=e217]:
                - cell [ref=e218]:
                  - link "84532000000000015" [ref=e219] [cursor=pointer]:
                    - /url: /passport/84532000000000015
                - cell "held" [ref=e220]
                - cell "Base Sepolia" [ref=e225]
                - cell "Base Sepolia" [ref=e226]
                - cell "0" [ref=e227]
              - row [ref=e228]:
                - cell [ref=e229]:
                  - link "84532000000000016" [ref=e230] [cursor=pointer]:
                    - /url: /passport/84532000000000016
                - cell "held" [ref=e231]
                - cell "Base Sepolia" [ref=e236]
                - cell "Base Sepolia" [ref=e237]
                - cell "0" [ref=e238]
              - row [ref=e239]:
                - cell [ref=e240]:
                  - link "84532000000000017" [ref=e241] [cursor=pointer]:
                    - /url: /passport/84532000000000017
                - cell "held" [ref=e242]
                - cell "Base Sepolia" [ref=e247]
                - cell "Base Sepolia" [ref=e248]
                - cell "1" [ref=e249]
              - row [ref=e250]:
                - cell [ref=e251]:
                  - link "84532000000000018" [ref=e252] [cursor=pointer]:
                    - /url: /passport/84532000000000018
                - cell "held" [ref=e253]
                - cell "Base Sepolia" [ref=e258]
                - cell "Base Sepolia" [ref=e259]
                - cell "0" [ref=e260]
              - row [ref=e261]:
                - cell [ref=e262]:
                  - link "421614000000000000" [ref=e263] [cursor=pointer]:
                    - /url: /passport/421614000000000000
                - cell "held" [ref=e264]
                - cell "Arbitrum Sepolia" [ref=e269]
                - cell "Arbitrum Sepolia" [ref=e270]
                - cell "1" [ref=e271]
              - row [ref=e272]:
                - cell [ref=e273]:
                  - link "421614000000000001" [ref=e274] [cursor=pointer]:
                    - /url: /passport/421614000000000001
                - cell "held" [ref=e275]
                - cell "Arbitrum Sepolia" [ref=e280]
                - cell "Arbitrum Sepolia" [ref=e281]
                - cell "1" [ref=e282]
              - row [ref=e283]:
                - cell [ref=e284]:
                  - link "421614000000000002" [ref=e285] [cursor=pointer]:
                    - /url: /passport/421614000000000002
                - cell "held" [ref=e286]
                - cell "Arbitrum Sepolia" [ref=e291]
                - cell "Arbitrum Sepolia" [ref=e292]
                - cell "2" [ref=e293]
              - row [ref=e294]:
                - cell [ref=e295]:
                  - link "421614000000000003" [ref=e296] [cursor=pointer]:
                    - /url: /passport/421614000000000003
                - cell "held" [ref=e297]
                - cell "Arbitrum Sepolia" [ref=e302]
                - cell "Arbitrum Sepolia" [ref=e303]
                - cell "2" [ref=e304]
              - row [ref=e305]:
                - cell [ref=e306]:
                  - link "421614000000000004" [ref=e307] [cursor=pointer]:
                    - /url: /passport/421614000000000004
                - cell "held" [ref=e308]
                - cell "Arbitrum Sepolia" [ref=e313]
                - cell "Arbitrum Sepolia" [ref=e314]
                - cell "10" [ref=e315]
              - row [ref=e316]:
                - cell [ref=e317]:
                  - link "421614000000000005" [ref=e318] [cursor=pointer]:
                    - /url: /passport/421614000000000005
                - cell "held" [ref=e319]
                - cell "Arbitrum Sepolia" [ref=e324]
                - cell "Arbitrum Sepolia" [ref=e325]
                - cell "0" [ref=e326]
              - row [ref=e327]:
                - cell [ref=e328]:
                  - link "421614000000000006" [ref=e329] [cursor=pointer]:
                    - /url: /passport/421614000000000006
                - cell "held" [ref=e330]
                - cell "Arbitrum Sepolia" [ref=e335]
                - cell "Arbitrum Sepolia" [ref=e336]
                - cell "0" [ref=e337]
              - row [ref=e338]:
                - cell [ref=e339]:
                  - link "421614000000000007" [ref=e340] [cursor=pointer]:
                    - /url: /passport/421614000000000007
                - cell "held" [ref=e341]
                - cell "Arbitrum Sepolia" [ref=e346]
                - cell "Arbitrum Sepolia" [ref=e347]
                - cell "0" [ref=e348]
              - row [ref=e349]:
                - cell [ref=e350]:
                  - link "421614000000000008" [ref=e351] [cursor=pointer]:
                    - /url: /passport/421614000000000008
                - cell "held" [ref=e352]
                - cell "Arbitrum Sepolia" [ref=e357]
                - cell "Arbitrum Sepolia" [ref=e358]
                - cell "0" [ref=e359]
              - row [ref=e360]:
                - cell [ref=e361]:
                  - link "421614000000000009" [ref=e362] [cursor=pointer]:
                    - /url: /passport/421614000000000009
                - cell "held" [ref=e363]
                - cell "Arbitrum Sepolia" [ref=e368]
                - cell "Arbitrum Sepolia" [ref=e369]
                - cell "0" [ref=e370]
              - row [ref=e371]:
                - cell [ref=e372]:
                  - link "421614000000000010" [ref=e373] [cursor=pointer]:
                    - /url: /passport/421614000000000010
                - cell "held" [ref=e374]
                - cell "Arbitrum Sepolia" [ref=e379]
                - cell "Arbitrum Sepolia" [ref=e380]
                - cell "0" [ref=e381]
              - row [ref=e382]:
                - cell [ref=e383]:
                  - link "421614000000000011" [ref=e384] [cursor=pointer]:
                    - /url: /passport/421614000000000011
                - cell "held" [ref=e385]
                - cell "Arbitrum Sepolia" [ref=e390]
                - cell "Arbitrum Sepolia" [ref=e391]
                - cell "0" [ref=e392]
              - row [ref=e393]:
                - cell [ref=e394]:
                  - link "421614000000000012" [ref=e395] [cursor=pointer]:
                    - /url: /passport/421614000000000012
                - cell "held" [ref=e396]
                - cell "Arbitrum Sepolia" [ref=e401]
                - cell "Arbitrum Sepolia" [ref=e402]
                - cell "0" [ref=e403]
              - row [ref=e404]:
                - cell [ref=e405]:
                  - link "421614000000000013" [ref=e406] [cursor=pointer]:
                    - /url: /passport/421614000000000013
                - cell "held" [ref=e407]
                - cell "Arbitrum Sepolia" [ref=e412]
                - cell "Arbitrum Sepolia" [ref=e413]
                - cell "0" [ref=e414]
              - row [ref=e415]:
                - cell [ref=e416]:
                  - link "421614000000000014" [ref=e417] [cursor=pointer]:
                    - /url: /passport/421614000000000014
                - cell "held" [ref=e418]
                - cell "Arbitrum Sepolia" [ref=e423]
                - cell "Arbitrum Sepolia" [ref=e424]
                - cell "0" [ref=e425]
              - row [ref=e426]:
                - cell [ref=e427]:
                  - link "421614000000000015" [ref=e428] [cursor=pointer]:
                    - /url: /passport/421614000000000015
                - cell "held" [ref=e429]
                - cell "Arbitrum Sepolia" [ref=e434]
                - cell "Arbitrum Sepolia" [ref=e435]
                - cell "0" [ref=e436]
              - row [ref=e437]:
                - cell [ref=e438]:
                  - link "421614000000000016" [ref=e439] [cursor=pointer]:
                    - /url: /passport/421614000000000016
                - cell "held" [ref=e440]
                - cell "Arbitrum Sepolia" [ref=e445]
                - cell "Arbitrum Sepolia" [ref=e446]
                - cell "0" [ref=e447]
              - row [ref=e448]:
                - cell [ref=e449]:
                  - link "421614000000000017" [ref=e450] [cursor=pointer]:
                    - /url: /passport/421614000000000017
                - cell "held" [ref=e451]
                - cell "Arbitrum Sepolia" [ref=e456]
                - cell "Arbitrum Sepolia" [ref=e457]
                - cell "0" [ref=e458]
              - row [ref=e459]:
                - cell [ref=e460]:
                  - link "421614000000000018" [ref=e461] [cursor=pointer]:
                    - /url: /passport/421614000000000018
                - cell "held" [ref=e462]
                - cell "Arbitrum Sepolia" [ref=e467]
                - cell "Arbitrum Sepolia" [ref=e468]
                - cell "0" [ref=e469]
              - row [ref=e470]:
                - cell [ref=e471]:
                  - link "421614000000000019" [ref=e472] [cursor=pointer]:
                    - /url: /passport/421614000000000019
                - cell "held" [ref=e473]
                - cell "Arbitrum Sepolia" [ref=e478]
                - cell "Arbitrum Sepolia" [ref=e479]
                - cell "0" [ref=e480]
              - row [ref=e481]:
                - cell [ref=e482]:
                  - link "421614000000000020" [ref=e483] [cursor=pointer]:
                    - /url: /passport/421614000000000020
                - cell "held" [ref=e484]
                - cell "Arbitrum Sepolia" [ref=e489]
                - cell "Arbitrum Sepolia" [ref=e490]
                - cell "0" [ref=e491]
              - row [ref=e492]:
                - cell [ref=e493]:
                  - link "421614000000000021" [ref=e494] [cursor=pointer]:
                    - /url: /passport/421614000000000021
                - cell "held" [ref=e495]
                - cell "Arbitrum Sepolia" [ref=e500]
                - cell "Arbitrum Sepolia" [ref=e501]
                - cell "0" [ref=e502]
              - row [ref=e503]:
                - cell [ref=e504]:
                  - link "421614000000000022" [ref=e505] [cursor=pointer]:
                    - /url: /passport/421614000000000022
                - cell "held" [ref=e506]
                - cell "Arbitrum Sepolia" [ref=e511]
                - cell "Arbitrum Sepolia" [ref=e512]
                - cell "1" [ref=e513]
              - row [ref=e514]:
                - cell [ref=e515]:
                  - link "421614000000000023" [ref=e516] [cursor=pointer]:
                    - /url: /passport/421614000000000023
                - cell "held" [ref=e517]
                - cell "Base Sepolia" [ref=e522]
                - cell "Arbitrum Sepolia" [ref=e523]
                - cell "0" [ref=e524]
              - row [ref=e525]:
                - cell [ref=e526]:
                  - link "421614000000000024" [ref=e527] [cursor=pointer]:
                    - /url: /passport/421614000000000024
                - cell "held" [ref=e528]
                - cell "Sepolia" [ref=e533]
                - cell "Arbitrum Sepolia" [ref=e534]
                - cell "0" [ref=e535]
              - row [ref=e536]:
                - cell [ref=e537]:
                  - link "421614000000000025" [ref=e538] [cursor=pointer]:
                    - /url: /passport/421614000000000025
                - cell "held" [ref=e539]
                - cell "Arbitrum Sepolia" [ref=e544]
                - cell "Arbitrum Sepolia" [ref=e545]
                - cell "0" [ref=e546]
              - row [ref=e547]:
                - cell [ref=e548]:
                  - link "421614000000000026" [ref=e549] [cursor=pointer]:
                    - /url: /passport/421614000000000026
                - cell "held" [ref=e550]
                - cell "Arbitrum Sepolia" [ref=e555]
                - cell "Arbitrum Sepolia" [ref=e556]
                - cell "1" [ref=e557]
              - row [ref=e558]:
                - cell [ref=e559]:
                  - link "421614000000000027" [ref=e560] [cursor=pointer]:
                    - /url: /passport/421614000000000027
                - cell "held" [ref=e561]
                - cell "Arbitrum Sepolia" [ref=e566]
                - cell "Arbitrum Sepolia" [ref=e567]
                - cell "1" [ref=e568]
              - row [ref=e569]:
                - cell [ref=e570]:
                  - link "421614000000000028" [ref=e571] [cursor=pointer]:
                    - /url: /passport/421614000000000028
                - cell "held" [ref=e572]
                - cell "Arbitrum Sepolia" [ref=e577]
                - cell "Arbitrum Sepolia" [ref=e578]
                - cell "1" [ref=e579]
              - row [ref=e580]:
                - cell [ref=e581]:
                  - link "421614000000000029" [ref=e582] [cursor=pointer]:
                    - /url: /passport/421614000000000029
                - cell "held" [ref=e583]
                - cell "Arbitrum Sepolia" [ref=e588]
                - cell "Arbitrum Sepolia" [ref=e589]
                - cell "1" [ref=e590]
              - row [ref=e591]:
                - cell [ref=e592]:
                  - link "421614000000000030" [ref=e593] [cursor=pointer]:
                    - /url: /passport/421614000000000030
                - cell "held" [ref=e594]
                - cell "Arbitrum Sepolia" [ref=e599]
                - cell "Arbitrum Sepolia" [ref=e600]
                - cell "1" [ref=e601]
              - row [ref=e602]:
                - cell [ref=e603]:
                  - link "421614000000000031" [ref=e604] [cursor=pointer]:
                    - /url: /passport/421614000000000031
                - cell "held" [ref=e605]
                - cell "Arbitrum Sepolia" [ref=e610]
                - cell "Arbitrum Sepolia" [ref=e611]
                - cell "1" [ref=e612]
              - row [ref=e613]:
                - cell [ref=e614]:
                  - link "421614000000000032" [ref=e615] [cursor=pointer]:
                    - /url: /passport/421614000000000032
                - cell "held" [ref=e616]
                - cell "Arbitrum Sepolia" [ref=e621]
                - cell "Arbitrum Sepolia" [ref=e622]
                - cell "1" [ref=e623]
              - row [ref=e624]:
                - cell [ref=e625]:
                  - link "421614000000000033" [ref=e626] [cursor=pointer]:
                    - /url: /passport/421614000000000033
                - cell "held" [ref=e627]
                - cell "Arbitrum Sepolia" [ref=e632]
                - cell "Arbitrum Sepolia" [ref=e633]
                - cell "1" [ref=e634]
              - row [ref=e635]:
                - cell [ref=e636]:
                  - link "421614000000000034" [ref=e637] [cursor=pointer]:
                    - /url: /passport/421614000000000034
                - cell "held" [ref=e638]
                - cell "Arbitrum Sepolia" [ref=e643]
                - cell "Arbitrum Sepolia" [ref=e644]
                - cell "1" [ref=e645]
              - row [ref=e646]:
                - cell [ref=e647]:
                  - link "421614000000000035" [ref=e648] [cursor=pointer]:
                    - /url: /passport/421614000000000035
                - cell "held" [ref=e649]
                - cell "Arbitrum Sepolia" [ref=e654]
                - cell "Arbitrum Sepolia" [ref=e655]
                - cell "2" [ref=e656]
              - row [ref=e657]:
                - cell [ref=e658]:
                  - link "11155111000000000000" [ref=e659] [cursor=pointer]:
                    - /url: /passport/11155111000000000000
                - cell "held" [ref=e660]
                - cell "Sepolia" [ref=e665]
                - cell "Sepolia" [ref=e666]
                - cell "1" [ref=e667]
              - row [ref=e668]:
                - cell [ref=e669]:
                  - link "11155111000000000001" [ref=e670] [cursor=pointer]:
                    - /url: /passport/11155111000000000001
                - cell "held" [ref=e671]
                - cell "Sepolia" [ref=e676]
                - cell "Sepolia" [ref=e677]
                - cell "1" [ref=e678]
              - row [ref=e679]:
                - cell [ref=e680]:
                  - link "11155111000000000002" [ref=e681] [cursor=pointer]:
                    - /url: /passport/11155111000000000002
                - cell "held" [ref=e682]
                - cell "Sepolia" [ref=e687]
                - cell "Sepolia" [ref=e688]
                - cell "2" [ref=e689]
              - row [ref=e690]:
                - cell [ref=e691]:
                  - link "11155111000000000003" [ref=e692] [cursor=pointer]:
                    - /url: /passport/11155111000000000003
                - cell "held" [ref=e693]
                - cell "Sepolia" [ref=e698]
                - cell "Sepolia" [ref=e699]
                - cell "2" [ref=e700]
              - row [ref=e701]:
                - cell [ref=e702]:
                  - link "11155111000000000004" [ref=e703] [cursor=pointer]:
                    - /url: /passport/11155111000000000004
                - cell "held" [ref=e704]
                - cell "Sepolia" [ref=e709]
                - cell "Sepolia" [ref=e710]
                - cell "10" [ref=e711]
              - row [ref=e712]:
                - cell [ref=e713]:
                  - link "11155111000000000005" [ref=e714] [cursor=pointer]:
                    - /url: /passport/11155111000000000005
                - cell "held" [ref=e715]
                - cell "Sepolia" [ref=e720]
                - cell "Sepolia" [ref=e721]
                - cell "0" [ref=e722]
              - row [ref=e723]:
                - cell [ref=e724]:
                  - link "11155111000000000006" [ref=e725] [cursor=pointer]:
                    - /url: /passport/11155111000000000006
                - cell "held" [ref=e726]
                - cell "Sepolia" [ref=e731]
                - cell "Sepolia" [ref=e732]
                - cell "0" [ref=e733]
              - row [ref=e734]:
                - cell [ref=e735]:
                  - link "11155111000000000007" [ref=e736] [cursor=pointer]:
                    - /url: /passport/11155111000000000007
                - cell "held" [ref=e737]
                - cell "Sepolia" [ref=e742]
                - cell "Sepolia" [ref=e743]
                - cell "0" [ref=e744]
              - row [ref=e745]:
                - cell [ref=e746]:
                  - link "11155111000000000008" [ref=e747] [cursor=pointer]:
                    - /url: /passport/11155111000000000008
                - cell "held" [ref=e748]
                - cell "Sepolia" [ref=e753]
                - cell "Sepolia" [ref=e754]
                - cell "0" [ref=e755]
              - row [ref=e756]:
                - cell [ref=e757]:
                  - link "11155111000000000009" [ref=e758] [cursor=pointer]:
                    - /url: /passport/11155111000000000009
                - cell "held" [ref=e759]
                - cell "Sepolia" [ref=e764]
                - cell "Sepolia" [ref=e765]
                - cell "0" [ref=e766]
              - row [ref=e767]:
                - cell [ref=e768]:
                  - link "11155111000000000010" [ref=e769] [cursor=pointer]:
                    - /url: /passport/11155111000000000010
                - cell "held" [ref=e770]
                - cell "Sepolia" [ref=e775]
                - cell "Sepolia" [ref=e776]
                - cell "0" [ref=e777]
              - row [ref=e778]:
                - cell [ref=e779]:
                  - link "11155111000000000011" [ref=e780] [cursor=pointer]:
                    - /url: /passport/11155111000000000011
                - cell "held" [ref=e781]
                - cell "Sepolia" [ref=e786]
                - cell "Sepolia" [ref=e787]
                - cell "0" [ref=e788]
              - row [ref=e789]:
                - cell [ref=e790]:
                  - link "11155111000000000012" [ref=e791] [cursor=pointer]:
                    - /url: /passport/11155111000000000012
                - cell "held" [ref=e792]
                - cell "Sepolia" [ref=e797]
                - cell "Sepolia" [ref=e798]
                - cell "0" [ref=e799]
              - row [ref=e800]:
                - cell [ref=e801]:
                  - link "11155111000000000013" [ref=e802] [cursor=pointer]:
                    - /url: /passport/11155111000000000013
                - cell "held" [ref=e803]
                - cell "Sepolia" [ref=e808]
                - cell "Sepolia" [ref=e809]
                - cell "0" [ref=e810]
              - row [ref=e811]:
                - cell [ref=e812]:
                  - link "11155111000000000014" [ref=e813] [cursor=pointer]:
                    - /url: /passport/11155111000000000014
                - cell "held" [ref=e814]
                - cell "Sepolia" [ref=e819]
                - cell "Sepolia" [ref=e820]
                - cell "0" [ref=e821]
              - row [ref=e822]:
                - cell [ref=e823]:
                  - link "11155111000000000015" [ref=e824] [cursor=pointer]:
                    - /url: /passport/11155111000000000015
                - cell "held" [ref=e825]
                - cell "Sepolia" [ref=e830]
                - cell "Sepolia" [ref=e831]
                - cell "0" [ref=e832]
              - row [ref=e833]:
                - cell [ref=e834]:
                  - link "11155111000000000016" [ref=e835] [cursor=pointer]:
                    - /url: /passport/11155111000000000016
                - cell "held" [ref=e836]
                - cell "Sepolia" [ref=e841]
                - cell "Sepolia" [ref=e842]
                - cell "1" [ref=e843]
  - alert [ref=e844]
```

# Test source

```ts
  1   | import { whiskyDistilleryAbi } from "@idpp/passport-config";
  2   | import { expect, type Page, test } from "@playwright/test";
  3   | import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
  4   | import { createTimingRecorder, finishTiming, transactionHash } from "./timing-browser";
  5   | import { contractFor, installWallet, loadAccount, publicClientFor } from "./wallet";
  6   | 
  7   | /**
  8   |  * The read pages, the scan page and the mint refusal against a running indexer. Ground truth is
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
> 95  |       await page.getByRole("button", { name: "Load more" }).click();
      |                                                             ^ Error: locator.click: Test timeout of 900000ms exceeded.
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
```