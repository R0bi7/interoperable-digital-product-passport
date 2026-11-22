# DS2: cross-chain delivery on whisky-v2-eval3

**Evidence label: LIVE (whisky-v2-eval3).** Collected 2026-10-19–20 under [PROTOCOL.md](PROTOCOL.md), with window starts at least three hours apart. The smoke run and other generations supply no observation to this dataset. The final generated tables are `smart_contracts/e2e_reports/latency-pooled-whisky-v2-eval3.{json,md,tex}` and `-cost.tex`.

## Runs and coverage

Each run used `e2e:latency --networks arbitrum-sepolia,base-sepolia,sepolia --hops 8 --timeout 1800 --window <label>` through `scripts/live.sh`. Fresh balances, Pinata inventory and mesh Scan health passed before each run; all six application-pathway nonce preflights passed. Raw reports are listed in [the run index](data-index.md); the console logs of the three windows are `smart_contracts/e2e_reports/live---command-1792443391358347000.log`, `…1792453915580112000.log` and `…1792464815397119000.log`.

| Window | Actual header start (UTC) | Clean commit | Run | Delivered |
| --- | --- | --- | --- | ---: |
| w1 | 2026-10-19 20:56:42.276Z | `f115ab7` | `latency-1792443397016` | 24/24 |
| w2 | 2026-10-19 23:56:53.837Z | `a87f9ca` | `latency-1792454208270` | 24/24 |
| w3 | 2026-10-20 02:57:04.939Z | `5c442d5` | `latency-1792465019048` | 24/24 |

The actual start gaps are 10,811.561 and 10,811.102 seconds, both above three hours. Collection ended at 2026-10-20 03:48:04Z. The labels w1–w3 identify windows; the timestamps establish spacing and the two UTC dates. This is one overnight collection period, not independent sampling across days.

All headers record public RPC hosts (`sepolia-rollup.arbitrum.io`, `sepolia.base.org`, `ethereum-sepolia-rpc.publicnode.com`), Node 24.10.0, Hardhat 2.29.1, ethers 5.8.0 and Forge 1.8.5, with the unchanged low-tip fee policy and 1,000,000-wei floor. Addresses and runtime hashes match the eval3 manifest and the [deployment readback](../../smart_contracts/e2e_reports/eval3-deployment-readback-1792440181462.json); the source configurations descend from the clean smoke run. No manifest, bytecode, fee policy, enforced gas or peer configuration changed between windows.

Three tokens per window, one per unordered pair, make eight alternating hops without revision: four observations per direction and window, 12 pooled. All 72 sends delivered; all 72 destination `ONFTReceived` receipts, primary clocks and continuity clocks are present. All 81 source transactions (nine mints plus 72 sends) have inclusion-block timestamps and receipt-observation clocks; all 27 Base transactions preserve supplementary L1 charges. Every content/binding/history read and expected history hash passed. The nine tokens are in [the ledger](../../smart_contracts/fixtures/ledger.md). No failure, timeout, recovery or extra window occurred.

## Delivery time

Primary clock: source `ONFTSent` block timestamp to destination `ONFTReceived` block timestamp, seconds, n = 12 per direction. Outliers remain in the sample; the generated table also supplies p95, means and both intervals.

| Direction | Median | Q1–Q3 | Min–max | Outliers | Median 95% CI |
| --- | ---: | --- | --- | ---: | --- |
| Arbitrum Sepolia → Base Sepolia | 46.0 | 39.5–51.0 | 29–56 | 0 | 39.0–51.0 |
| Base Sepolia → Arbitrum Sepolia | 35.0 | 28.8–42.3 | 26–52 | 0 | 28.5–42.5 |
| Arbitrum Sepolia → Sepolia | 145.0 | 138.8–155.3 | 127–162 | 0 | 138.5–155.5 |
| Sepolia → Arbitrum Sepolia | 77.5 | 66.3–88.3 | 61–97 | 0 | 65.5–88.5 |
| Base Sepolia → Sepolia | 146.0 | 144.0–157.0 | 138–184 | 3 | 144.0–164.0 |
| Sepolia → Base Sepolia | 89.0 | 84.0–94.0 | 64–102 | 1 | 84.0–94.0 |

The continuity clock ends at the first successful destination poll rather than the receive block. Its direction medians are 48.0, 38.5, 150.0, 83.5, 150.0 and 94.0 seconds in the row order above. The two clocks remain separate. Per-window n = 4 supports raw values only; the generated report retains those values and each window's first hop.

In these windows, delivery into Sepolia took longer than delivery between the L2 testnets. The data do not identify a cause; confirmation configuration, block timing and off-chain message handling are possible contributors. Source ULN confirmations were Arbitrum 5, Base 2 and Sepolia 2; those settings and block timestamps do not establish consensus finality.

## Gas and fees

All source coins are testnet ETH. Each direction paid one LayerZero quote value throughout its 12 sends: Arbitrum→Base 0.000101831703710967, Base→Arbitrum 0.000108472967710967, either L2→Sepolia 0.000098985508365383, Sepolia→Arbitrum 0.000142248695540558 and Sepolia→Base 0.000104562368596558 ETH. The harness supplies exactly the quote as `msg.value`; equality of quoted and paid fee follows by construction. It is not a prediction of future quotes.

Source receipt gas used was 234,531 for every L2 send and 272,415 for every Sepolia send. The [generated pooled report](../../smart_contracts/e2e_reports/latency-pooled-whisky-v2-eval3.md) gives the receipt gas fee range beside LayerZero fees. `feeWei = gasUsed × effectiveGasPrice` excludes Base's separate L1 data charge, which remains in raw JSON; it is not the complete Base transaction cost. Receiving-transaction fees are paid by the executor and are outside these source-side fields. There is no fiat conversion or mainnet-cost inference.

## Limits and preserved observations

The four observations of a direction in one window are back to back on one token, and paired directions alternate on it. They are dependent; pooled intervals are optimistic and describe these three windows rather than general pathway reliability or latency. Chain-clock skew is unmeasured, and block-time resolution and public-RPC polling affect the clocks. A 72/72 result establishes these observed deliveries, not a guaranteed delivery rate.

Ethers block-poll warnings remain in the full logs. Explicit receipt/event lookup found all required metadata, so no value is filled or discarded. Scan sometimes still said INFLIGHT when destination reads and event receipts already established delivery; its original status remains unchanged. None of the five-minute no-record or later stop bounds censored a hop in these runs.

The first hop of each window is retained as a within-window observation. The cold-nonce first deliveries into Sepolia occurred in the earlier [smoke run](../../smart_contracts/e2e_reports/flows-1792440313119.md); they are never added to DS2. These reports verify carried passport state and history hashes, not physical authenticity, storage availability or the trustworthiness of every possible peer or DVN configuration.
