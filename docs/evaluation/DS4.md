# DS4: minimal scale confirmation on whisky-v2-eval3

**Evidence label: LIVE (whisky-v2-eval3).** Collected once on 2026-10-22 under the [predeclared DS4 row](PROTOCOL.md). The 20 mints and 10 sends are the measured sizes; larger inventories below are arithmetic, not measurements.

## Run and coverage

Run [`scale-1792677430419`](../../smart_contracts/e2e_reports/scale-1792677430419.json), window `ds4`, began at 13:57:12.886Z from clean commit `f11953d`, as its header records. Command: `pnpm eval:run DS4`, which invoked `e2e:scale` for 20 issuer mints to self on Base Sepolia (84532 / eid 40245), followed by ten Base Sepolia → Arbitrum Sepolia (40231) sends, with a 1,800 s delivery timeout. The [watchdog log](../../smart_contracts/e2e_reports/live-e2e-scale-1792677428021667000.log) records Scan health on all three chains, pathway preflight and a Base balance of 0.095876855399805888 ETH against twice the quoted batch cost of 0.00231993719421934 ETH. The argument, clean-tree, window and capacity gates (299 + 0 of 500 pins) passed in the orchestrator's console transcript, which is not archived with the run. The Base nonce was 106 at both `latest` and `pending`. The run completed without a rerun.

The header records public RPC hosts `sepolia.base.org` and `sepolia-rollup.arbitrum.io`, Node 24.10.0, Hardhat 2.29.1, ethers 5.8.0 and Forge 1.8.5, the low-tip fee policy with a 1,000,000-wei priority floor, and runtime hashes matching the [eval3 manifest](../../smart_contracts/deployments/manifest.json). The source mints used nonces 106–125 and the sends 126–135. All 30 source transactions mined with status 1, 20 mints were filed in [the ledger](../../smart_contracts/fixtures/ledger.md), and all ten destination receipts and both delivery clocks were found. Each of the 30 content, binding and history reads and expected history-hash checks passed. CIDs were computed from local payload bytes; no payload was pinned.

## Predeclared comparisons

| Criterion | DS1 or DS2 reference and pass band | DS4 observation | Result |
| --- | --- | --- | --- |
| Mint gas | DS1 Base later mint to self 155,874 gas; 148,081–163,667 | 20/20 at 155,874 gas, mined with status 1 | Met |
| Send source gas | DS2 L2 source send 234,531 gas; 222,805–246,257 | 10/10 at 234,531 gas, mined with status 1 | Met |
| LayerZero fee paid | DS2 Base → Arbitrum 108,472,967,710,967 wei; 103,049,319,325,419–113,896,616,096,515 wei | 10/10 at 108,472,967,710,967 wei (0.000108472967710967 ETH), equal to each quote | Met |
| Delivery | All ten delivered with primary clocks; last delivery 26–52 s from first `ONFTSent` | 10/10; last delivery 45 s | Met |
| Integrity | Content, binding, history and expected on-chain history hash for every mint and delivered token | 30/30 of each check | Met |

The [DS1 raw run](../../smart_contracts/e2e_reports/ops-1792442510606.json) supplies the mint median; the three DS2 windows ([w1](../../smart_contracts/e2e_reports/latency-1792443397016.json), [w2](../../smart_contracts/e2e_reports/latency-1792454208270.json), [w3](../../smart_contracts/e2e_reports/latency-1792465019048.json)) supply the send gas, fee and delivery range. DS1 contains no send. DS2 paid one fee value throughout this direction, so the fee band is the ±5% band set before the run, not a measured DS2 spread. Source receipt gas fees were 935,244,000,000 wei per mint and 1,407,186,000,000 wei per send; they had no pass threshold. The separate Base L1 data charges remain in the raw report.

The individual primary delivery clocks had median 41.5 s, quartiles 23.5–43 s, p95 44 s and range 22–44 s. Six of ten were within DS2's 26–52 s range; the other four arrived faster, at 22–25 s. This count is descriptive, not a condition for delivery to pass. The continuity clock, source block to first successful destination poll, had median 45 s, quartiles 26.25–46 s, p95 46 s and range 25–46 s. The batch continuity time to the last delivery was 47 s. The primary and continuity clocks are not pooled. The generated [DS4 table](../../smart_contracts/e2e_reports/scale-1792677430419.tex) and [run rendering](../../smart_contracts/e2e_reports/scale-1792677430419.md) retain the remaining statistics and observations.

## Batches and derived inventory figures

| Batch | First submission to last observed source receipt (polling bound) | First to last inclusion timestamp | Distinct inclusion blocks | Most transactions in one block |
| --- | ---: | ---: | ---: | ---: |
| 20 mints | 4.636 s | 3 s | 16 | 2 |
| 10 sends | 4.423 s | 2 s | 8 | 2 |

For the ten sends, the first source `ONFTSent` to the last destination `ONFTReceived` was 45 s; the corresponding continuity clock was 47 s. These are batch observations, not the sum of ten delivery times. The mint receipt-observation median was 2.9275 s (quartiles 2.1905–3.67925 s, p95 4.25845 s, range 0.266–4.438 s). The ten sends' receipt-observation median was 3.5 s. From the first submission, the first mint receipt was observed at 266 ms and the other 19 at 4,595–4,636 ms; the first send receipt was observed at 390 ms and the other nine at 4,409–4,423 ms. Mint submissions spread over 3,016 ms and send submissions over 1,458 ms. These clustered observations reflect RPC receipt polling, so the batch receipt times are bounded by the polling schedule. Inclusion timestamps describe the on-chain batch span more directly. DS1's sequential Base mint receipt-observation median of 0.125 s is not pooled with DS4's polling-bound sample.

**Derived, not measured at larger N:** for an inventory of N separate mints at the observed DS1/DS4 later-mint gas, source gas arithmetic is N × 155,874; for N separate L2 sends at the observed DS2/DS4 source gas it is N × 234,531, plus N × 108,472,967,710,967 wei at the observed Base → Arbitrum LayerZero quote. At N = 20 and N = 10, these products are 3,117,480 mint gas, 2,345,310 send gas and 1,084,729,677,109,670 wei (0.001084729677109670 ETH) in LayerZero fees. They are sums of separate operations, with no ERC-721 batch amortisation. They do not forecast future quotes or market gas prices. A block gas limit bounds how many transactions can fit in one block, but this run does not measure that ceiling or inventory-scale throughput. ERC-1155's batch primitives remain a qualitative rejected alternative, not a measured comparator.

The predeclared sequential derivation was 20 × the DS1 Base mint block-difference median of 2 s = 40 s, without a pass threshold. In [DS1's raw mint rows](../../smart_contracts/e2e_reports/ops-1792442510606.json), the first and last Base mints occupied blocks 48337405 and 48337429: 24 block increments over 48 s, or 2 s per block; consecutive mint timestamps were 4–10 s apart. In DS4, 16 mint inclusion blocks, 48777828–48777843, have timestamps spanning 3 s (1792677434–1792677437, four distinct seconds). The 2 s interval underlying the sequential derivation therefore did not hold on the DS4 day. Mint submissions were about 0.16 s apart; inclusion blocks advanced at a comparable rate, and at most two mints shared a block. The predicted many mints per block did not occur. The raw files establish the changed timing, not its cause.

## Limits

This is one run on one day, one account, one chain and one direction, at N = 20 and N = 10. Back-to-back observations are dependent; the generated intervals are optimistic descriptions of this sample, not confidence in general testnet performance. Public RPC polling affects receipt observation; chain-clock skew between Base and Arbitrum was not measured. Base `feeWei` is `gasUsed × effectiveGasPrice` and excludes its separately recorded L1 data charge; neither it nor the LayerZero fee is a fiat or mainnet cost. Once broadcast, sends cannot be recalled.

The 59-character CIDv1 values bind to bytes cached by the task for verification, but no payload was pinned or made gateway-retrievable. The `tokenURI` values therefore point to CIDs that no gateway serves; this run does not test storage availability. The append-only ledger records the twenty tokens; any reconciliation notes belong to the report, not to the ledger (there were none in this run). Delivery, history and local payload checks do not establish physical authenticity, larger-inventory behaviour or a future delivery rate.
