# DS3: live rule checks on whisky-v2-eval3

**Evidence label: LIVE (whisky-v2-eval3).** One observation per case and chain, as prescribed by [PROTOCOL.md](PROTOCOL.md). Runs of other generations are not pooled.

## Run and coverage

Run [`edge-1792468448106`](../../smart_contracts/e2e_reports/edge-1792468448106.json), window `ds3`, started 2026-10-20 03:54:11.720Z and finished 04:03:51Z from clean commit `7ca650a`. Command: `e2e:edge --networks arbitrum-sepolia,base-sepolia,sepolia --repeats 1 --timeout 1800 --window ds3`, through the watchdog after completed DS2, fresh balance/pin-capacity checks and green mesh Scan health. The required three application-pathway nonce checks also passed. The [full log](../../smart_contracts/e2e_reports/live---command-1792468443454438000.log) preserves preflight, operator funding and every check.

The header records Node 24.10.0, Hardhat 2.29.1, ethers 5.8.0 and Forge 1.8.5; public RPC hosts `sepolia-rollup.arbitrum.io`, `sepolia.base.org` and `ethereum-sepolia-rpc.publicnode.com`; and the unchanged low-tip fee policy with a 1,000,000-wei floor. Addresses/runtime hashes match the eval3 manifest and the [deployment readback](../../smart_contracts/e2e_reports/eval3-deployment-readback-1792440181462.json). The second account was funded for its cases; funding is preparation, outside the flow-operation samples.

All 18 flows passed, with zero verification failures and 39 flow transactions. Every named authorization/input rejection had a matching decoded simulation and a mined status-0 receipt; expected state stayed unchanged. Fifteen configuration/direct-receive calls were refused by simulation only. Three approved-operator transfers succeeded. All 18 payload-backed verification steps passed content, binding and history. All 12 created tokens are in [the ledger](../../smart_contracts/fixtures/ledger.md), and 15 payload pins were logged. No failure, interruption, provisional receipt, recovery or rerun occurred.

| Case | Evidence per chain | Result |
| --- | --- | --- |
| Non-issuer mint | One decoded simulation and mined revert | `NotIssuer` on all three |
| Holder revise without issuer role | One decoded simulation and mined revert | `NotIssuer` on all three |
| Wrong expected mint id | One decoded simulation and mined revert | `UnexpectedTokenId` on all three |
| Stale revision | One decoded simulation and mined revert | `StaleRevision` on all three |
| Non-owner setIssuer, setPeer, setEnforcedOptions, setBaseURI | One `eth_call` per method | `OwnableUnauthorizedAccount`, all 12 calls |
| Direct contract lzReceive by a non-endpoint | One `eth_call` | `OnlyEndpoint`, all three calls |
| Approved-operator transferFrom | One mined success | All three; new holder's revise refused as `NotIssuer` |

These are n = 1 cells, not distributions or estimated failure rates. The stale-input checks are serial calls prepared against the same earlier state; they do not constitute a simultaneous live race. The [generated edge table](../../smart_contracts/e2e_reports/edge-cases-whisky-v2-eval3.md) retains each chain, error name and rejected-transaction gas value separately; decoded arguments remain in the raw report.

## Maximum-length carriage and replay

Each route sent one synthetic 96-byte string at revision 0. The cheapest other source follows the fee quotes taken at deployment. All deliveries have destination `ONFTReceived` receipts and matching owner, revision, string and history hash.

| Route | Delivered | Primary clock (s) | Whole destination transaction gas | Enforced receive gas | Replay |
| --- | ---: | ---: | ---: | ---: | --- |
| Base Sepolia → Arbitrum Sepolia | 1/1 | 30 | 211,733 | 286,000 | Rejected |
| Arbitrum Sepolia → Base Sepolia | 1/1 | 45 | 211,733 | 286,000 | Rejected |
| Arbitrum Sepolia → Sepolia | 1/1 | 153 | 749,637 | 1,291,000 | Rejected |

Each replay found the delivered payload hash cleared, reverted `LZ_PayloadHashNotFound` in simulation and mined with status 0. No replay succeeded, and no recovery was needed. Scan still showed INFLIGHT at the final Sepolia arrival; destination events and reads establish delivery, and its original status is preserved.

The synthetic strings have **no payload behind them by design**. Their verification is explicitly skipped; they are evidence of contract-state carriage, not content verification or successful IPFS retrieval. The 18 payload-backed checks above are separate.

Whole destination transaction gas includes the endpoint/executor transaction and is not gas consumed by `lzReceive`; subtracting it from enforced gas would not measure headroom. These revision-0 sends also follow earlier pathway deliveries. The cold-nonce, revised-passport worst-case receive-gas simulations and their at-least-25% margin remain the separate result in [SEPOLIA-GAS.md](SEPOLIA-GAS.md); smoke's first cold-nonce deliveries into Sepolia are separate provenance, never DS3 samples.

## Limits

The results show the named rules in these observations on three public testnets. They do not establish issuer truth, physical authenticity, universal transport safety or behavior under forged peers, compromised keys/DVNs or source reorganisations. The owner appoints issuers and configures the mesh; holders and approved operators do not acquire passport-write rights by owning or moving the token.

Own-namespace import validation (S1) remains LOCAL Foundry evidence: `test_S1_importRejectsAnIdOfTheOwnNamespaceThatWasNeverIssued`, `test_S1_importAcceptsTheIdsTheChainIssued` and `test_S1_importStillTrustsIdsOfOtherNamespaces`. No hostile peer was introduced into this mesh. A rejected transaction's receipt gas is an observation of that failed transaction, not the cost of enforcing a security property. Source receipt gas fees exclude Base's separately preserved L1 charge; receipt observation and block-difference clocks do not prove finality.
