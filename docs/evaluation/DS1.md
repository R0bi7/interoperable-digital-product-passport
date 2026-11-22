# DS1: single-chain operations on whisky-v2-eval3

**Evidence label: LIVE (whisky-v2-eval3).** Collected 2026-10-19 under [PROTOCOL.md](PROTOCOL.md), including its rules on Base receipt metadata and fee components. Runs of other deployment generations contribute no observation to this dataset.

## Run and coverage

Run [`ops-1792442510606`](../../smart_contracts/e2e_reports/ops-1792442510606.json), window `ds1`, began at 20:41:50Z and finished at 20:53:55Z from clean commit `366d9cc`. Command: `e2e:ops --networks sepolia,arbitrum-sepolia,base-sepolia --repeats 10 --window ds1`, through the watchdog after balance, pin-capacity and mesh Scan health checks. The [complete log](../../smart_contracts/e2e_reports/live---command-1792442505694419000.log) preserves these checks and execution.

The header records Node 24.10.0, Hardhat 2.29.1, ethers 5.8.0 and Forge 1.8.5, public RPC hosts `ethereum-sepolia-rpc.publicnode.com`, `sepolia-rollup.arbitrum.io` and `sepolia.base.org`, and the low-tip fee policy with a 1,000,000-wei priority floor. Its addresses and runtime hashes match the [deployment readback](../../smart_contracts/e2e_reports/eval3-deployment-readback-1792440181462.json) and [manifest](../../smart_contracts/deployments/manifest.json).

| Chain | Mint to self | Issuer revise | Holder transferFrom |
| --- | ---: | ---: | ---: |
| Arbitrum Sepolia | 10/10 | 10/10, depths 1–10 | 10/10 |
| Base Sepolia | 10/10 | 10/10, depths 1–10 | 10/10 |
| Sepolia | 10/10 | 10/10, depths 1–10 | 10/10 |

All nine flows passed: 90 transactions, 90 verified content/binding/history reads and 90 matching history-hash checks, with no failure or rerun. All 90 inclusion-block timestamps and both same-chain clocks are present. The task recorded all 30 minted tokens in [the fixture ledger](../../smart_contracts/fixtures/ledger.md); these are test data, not product passports.

The smoke had already minted on each chain. DS1 therefore contains **no untouched-chain first mint**; those three single observations remain separate smoke provenance and are excluded from DS1. Revisions use one token per chain, one observation at each depth. Transfer recipients are fresh addresses; the new holder's revision is refused without issuer status, and the former holder can no longer move the token.

## Results

The generated [gas table](../../smart_contracts/e2e_reports/gas-per-operation-whisky-v2-eval3-ops.md) retains every operation, chain and slot state separately.

| Gas used | Arbitrum Sepolia | Base Sepolia | Sepolia |
| --- | ---: | ---: | ---: |
| Later mint to self, n = 10 | 155,874 | 155,874 | 604,074 |
| First revision, n = 1 | 72,280 | 72,280 | 175,700 |
| Revision depths 2–10, n = 1 at each depth | 55,192 each | 55,192 each | 77,792 each |
| Transfer to a new holder, n = 10, min–max | 59,949–59,961 | 59,961 | 156,369–156,381 |

The repeatable operation counts meet ten per operation and chain. Each revision-depth cell has n = 1 and supplies an observation, not a distribution or interval; there is no untouched-chain first-mint cell. Equal gas in these rows does not make an operation's gas universal or explain chain pricing.

The [same-chain table](../../smart_contracts/e2e_reports/gas-per-operation-whisky-v2-eval3-ops.md) keeps receipt-observation and block-difference clocks separate. Receipt-observation medians are about 4.4 s on Arbitrum, 0.1–0.3 s on Base and 8.1–12.1 s on Sepolia, depending on operation. Base may return a preconfirmation receipt before its block is sealed: the first observation time is preserved while sealed metadata is obtained separately. RPC polling and endpoint semantics also contribute to receipt observation. These times do not measure finality or demonstrate that Base finalizes in a fraction of a second.

`feeWei` is the predefined **receipt gas fee**, `gasUsed × effectiveGasPrice`. On Base it excludes the separate L1 data charge and is not the complete transaction cost. All 30 Base steps preserve a matching sealed receipt's supplementary `l1FeeWei` value separately; no new fee metric is pooled into the predefined tables. DS1 sends no LayerZero message.

## Limits

This is one window on three public testnet RPCs, one issuer account and fixed 59-byte CIDs. Observations are back to back, with revision depths on the same token; they are not independent draws from general chain performance. Any interval describes only these observations; no missing value was filled and no outlier is removed. The results do not establish mainnet cost, application latency, storage availability or physical authenticity. DS2 measures transport; DS5 addresses the local storage-representation comparison.
