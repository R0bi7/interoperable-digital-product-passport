# DS9: a second copy of eval3 payloads on a local IPFS node

**Evidence label: LIVE (whisky-v2-eval3) for the CIDs and the Pinata gateway; LOCAL for the kubo node.** Protocol: [PROTOCOL.md](PROTOCOL.md) DS9. Script: [`ds9.mjs`](../acceptance/automation/eval3/ds9.mjs). Raw files: [`docs/acceptance/2026-10-20-ds9-ds11/ds9/`](../acceptance/2026-10-20-ds9-ds11/ds9/).

## Run

2026-10-20, kubo 0.43.1 (Homebrew, arm64/darwin, default profile, fresh repository). The ten subjects were fixed by token id from the fixture ledger before any storage operation, and each CID is the token's `passportOf` CID read at 17:01:57 UTC on the chain that held it. With the daemon online (17:01:59), each CID was pinned with `ipfs pin add` from the IPFS network; no copy needed the gateway fallback. The daemon was stopped (17:02:08), and each CID was then read once through the Pinata gateway and once with `ipfs --offline cat`, and each body was hashed against its CID.

| Subject | Token | Held on | Revision | CID | Copy | Pinata gateway | Local node, daemon stopped |
| --- | --- | --- | ---: | --- | --- | --- | --- |
| DS1, Arbitrum Sepolia | `421614000000000007` | Arbitrum Sepolia | 0 | `bafkreic3vditdrpl4srgti4thqlpkzfpjr63kvsli4gahg72tcdoj6vnc4` | network pin, 2.3 s | verified, 380 B | verified, 380 B |
| DS1, Base Sepolia | `84532000000000005` | Base Sepolia | 0 | `bafkreibendbl26im7ixabj5bf3nzq4yhmwinavwo3stffn33yszbkflyaa` | network pin, 0.6 s | verified, 378 B | verified, 378 B |
| DS1, Sepolia | `11155111000000000007` | Sepolia | 0 | `bafkreigszk3yj5f573k6bgg4sgehc6c4luunbpk57hj5nprlyges2dvtei` | network pin, 0.6 s | verified, 384 B | verified, 384 B |
| DS2 w3, Arbitrum and Base, after its last hop | `421614000000000018` | Arbitrum Sepolia | 0 | `bafkreidti262jfo26j7db3pxeiflyjvhslcvvsovykeaumsjmohwigynru` | network pin, 0.9 s | verified, 411 B | verified, 411 B |
| DS2 w3, Arbitrum and Sepolia, after its last hop | `421614000000000019` | Arbitrum Sepolia | 0 | `bafkreicynj4tshgirqy4cn2crs22ifs5ny4xuzix3s3zaboggqasyyz3aq` | network pin, 0.8 s | verified, 406 B | verified, 406 B |
| DS2 w3, Base and Sepolia, after its last hop | `84532000000000014` | Base Sepolia | 0 | `bafkreiffobwu6r4qa3vr5i3xcfzjkhp52jlwirrrhpldezc2o4srm2ourq` | network pin, 0.7 s | verified, 400 B | verified, 400 B |
| DS10, case c | `421614000000000038` | Arbitrum Sepolia | 1 | `bafkreiblnnz3kcpe2qzugrrsbtehsyba63hdump3iheonsmmq2o2cvdzwq` | network pin, 0.7 s | verified, 512 B | verified, 512 B |
| DS11, bottle with two source casks | `421614000000000040` | Base Sepolia | 1 | `bafkreifkppq3ubz4u4urtntwh5l2oy5c63wss55cqdlay4wxti4bek43uq` | network pin, 0.2 s | verified, 550 B | verified, 550 B |
| DS12, round-trip token | `421614000000000035` | Arbitrum Sepolia | 2 | `bafkreigj4q4hywugtg435s2dagdpeksop2nb4e62txgovpnosk7uvxhwom` | network pin, 1.0 s | verified, 443 B | verified, 443 B |
| DS12, sample-3 cask | `421614000000000028` | Arbitrum Sepolia | 1 | `bafkreiaevo53a2xqz2hmkaiexwobxbjzuyxxtrmx4l3ywuprets7ean2wi` | network pin, 0.2 s | verified, 448 B | verified, 448 B |

**10/10 verified on both paths.** The local copy answers with the daemon stopped, so a reader holding the node's repository can verify these payloads without Pinata, and the bytes match the CIDs recorded on chain.

## Limits

One second copy on the author's machine, made minutes after the payloads were published; it shows that the content addressing permits an independent copy that verifies, not that one exists for a real passport or survives over time. No public gateway, second provider, availability window or unpin test was run (PROTOCOL.md DS9). The DS1 and DS2 subjects (minted by the harness) are picked from different DS1/DS2 roles, not at random.
