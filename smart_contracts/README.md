# WhiskyDistillery (LayerZero V2)

An interoperable digital product passport (IDPP), built as a LayerZero V2 ONFT721.

- **One token, one passport.** Each ERC-721 token is one passport, at item or batch level.
- **Off-chain payload.** The contract stores the payload's CID, a revision counter and a history hash over every revision's CID; the payload itself lives on IPFS.
- **Cross-chain moves.** A token moves between chains under the same token ID, and the passport snapshot travels with it.
- **Token and data rights.** An issuer role, set per chain by the owner with `setIssuer`, alone mints and revises; the holder keeps transfer and `send`. Every revision extends `Passport.historyHash` (P8), which travels with the token. See [shared interfaces](../docs/TECHNICAL-REFERENCE.md).
- **Optimistic concurrency.** `mint(to, expectedTokenId, cid)` (issuer) reverts `UnexpectedTokenId(expected, actual)` unless `expectedTokenId == nextTokenId()`. `revise(tokenId, expectedRevision, cid)` (issuer) reverts `StaleRevision(expected, actual)` unless the stored revision equals `expectedRevision`. There is no unchecked `mint` or `revise`.


The shared model and the interfaces common to the contracts, the app and the indexer are in [`docs/TECHNICAL-REFERENCE.md`](../docs/TECHNICAL-REFERENCE.md). The whisky distillery is only the demonstrator.

| File                                      | Role                                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `contracts/passport/PassportRegistry.sol` | Passport state and rules: ID namespace, revisions, export/import. No LayerZero or ERC-721 code.        |
| `contracts/WhiskyDistillery.sol`          | ONFT721 + `PassportRegistry`. Overrides only `_buildMsgAndOptions` and `_lzReceive`.                   |
| `deploy/WhiskyDistillery.ts`              | hardhat-deploy script. Sets `idPrefix` to the chain ID and asserts `idPrefix`, `endpoint` and `owner`. |
| `layerzero.config.ts`                     | Arbitrum Sepolia, Base Sepolia and Sepolia pathways: DVN, confirmations and enforced gas.                           |
| `tasks/precheck.ts`                       | `lz:precheck`: peer-compatibility check before wiring.                                                 |
| `tasks/deployments.ts`                    | Network, record and manifest resolution; `lz:manifest` writes `deployments/manifest.json`.             |

## Setup

```bash
pnpm install
cp .env.example .env   # PRIVATE_KEY or MNEMONIC; optional RPC_URL_* overrides
```

The Foundry tests need [Foundry](https://getfoundry.sh).

## Build and test

```bash
pnpm compile
npx hardhat size-contracts
forge test -vv                                  # P1–P8 core properties
forge test --isolate --match-test Gas -vv       # lzReceive gas used for the enforced options
pnpm test:mutation                                           # 30 hand-made mutants of the contracts; each must make the suite fail (about 30 s)
pnpm test:hardhat                               # smoke test of the ethers deploy path
```

`pnpm test:mutation` (`scripts/mutation.ts`, mutants in `tasks/mutation-lib.ts`) applies one mutant at a time, runs `forge build` and `forge test --json --fuzz-seed 1`, and classifies it. The mutants are applied in a temporary copy of the project (with a link to `node_modules`), never in the working tree, so stopping the script at any point cannot leave a mutant in the sources. A mutant is *killed* if it compiles and at least one test fails (the first failing test is printed and, with `--write`, all of them are stored in `e2e_reports/mutation.json`), *survived* if the suite passes (a hole in the tests or an equivalent mutant, to be judged by a person: the script exits 1, `--allow-survivors` only reports), *invalid* if it does not compile, and an *error* if forge crashed, timed out (10 minutes) or printed nothing usable; neither of the last two counts as a kill. `--only M05,M21` runs a subset and refuses an unknown id. A unit test checks that every mutant applies exactly once to the current sources. Four mutants that an earlier version of the suite let survive (no `PassportIssued`, no `ONFTReceived`, no inspector call, `_safeMint`) and three on the import checks are among the 30; M26 to M30 cover the issuer role and the history hash. The first failing test shows what caught a mutant, not that it is the test meant to: read it against the property in the second column of the output.

The Gas tests print the minimum `endpoint.lzReceive` gas that the enforced options in `layerzero.config.ts` are derived from. The figures depend on the forge version; name it (`forge --version`) next to any figure that is quoted. With forge 1.8.5 a first arrival needs 185,277 (59-byte CID), 208,149 (96-byte CID) and 228,365 (96-byte CID at revision 1, the worst case), so `layerzero.config.ts` sets 286,000 into each L2 (228,365 x 1.25 rounded up). Into Sepolia it sets 1,291,000 (the simulated worst case of 1,032,799 x 1.25 rounded up). The eval3 calibration before wiring measures 1,032,799 on Sepolia and measures 228,149 on both L2s ([`docs/evaluation/SEPOLIA-GAS.md`](../docs/evaluation/SEPOLIA-GAS.md)). `scripts/live.sh --node scripts/sepolia-lzreceive-gas.js --network <network>` simulates a destination.

## Deploy and wire

```bash
npx hardhat lz:deploy --tags WhiskyDistillery
npx hardhat lz:manifest --deployment-id <generation-id>       # deployments/manifest.json from the records
npx hardhat lz:precheck                                       # mandatory before wiring
npx hardhat lz:oapp:wire --oapp-config layerzero.config.ts
npx hardhat lz:oapp:wire --oapp-config layerzero.config.ts --assert
npx hardhat lz:oapp:config:get --oapp-config layerzero.config.ts
```

`scripts/live.sh --command bash scripts/eval3-verify.sh` re-runs the read-only checks of the deployed generation: the wiring assert, the configuration read-out, `lz:precheck` and `scripts/eval3-deployment-readback.js`, which writes `e2e_reports/eval3-deployment-readback-<ms>.json`. The readback requires the configured account to own the deployed contracts and hold the issuer role on all three chains; the [filed readback](e2e_reports/eval3-deployment-readback-1792440181462.json) holds the original result.

`lz:manifest` derives `deployments/manifest.json` (address, chain ID, eid, deployment block) from the hardhat-deploy records; never edit it by hand. `lz:precheck` reads `onftVersion()`, `idPrefix()` and `peers()` of every contract in `layerzero.config.ts` and fails unless every contract reports the WhiskyDistillery interface and message version, every `idPrefix` equals its network's chain ID, all prefixes are distinct, the manifest matches the records and lists exactly these contracts, and no contract is already peered outside the mesh (for example with another deployment generation). Peers do not re-validate the passport they import, so only contracts that pass it may be wired.

`deploy/WhiskyDistillery.ts` skips networks that already have a record in `deployments/<network>/`. A new deployment generation therefore starts by moving those records, and `deployments/manifest.json`, out of `deployments/`; the new contracts are then never wired to the old ones. Use `lz:deploy --ci --tags WhiskyDistillery --networks arbitrum-sepolia,base-sepolia,sepolia`, because without `--networks` the task asks which networks to deploy.

## Live core flows

`tasks/flows.ts` runs the core user flows against the contracts recorded in `deployments/` (generation `deploymentId` from `deployments/manifest.json`; the task refuses to run if the manifest and the records disagree). It covers only the core actions.

| Flow         | What it does                                                                                                                                                                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `local`      | On each network: `mint`, then `revise`, then an ERC-721 transfer to a fresh address. Each transfer leaves one token with an address nobody holds the key for.                                                                                                                      |
| `stale`      | On each network: `mint`; two revisions prepared against the same revision; the first `revise` succeeds, the second must revert `StaleRevision(0, 1)`. Then a `mint` with a wrong `expectedTokenId` must revert `UnexpectedTokenId`. Both errors are decoded from the contract ABI. |
| `crosschain` | For each pair of networks: mint and revise on A, send to B, revise on B, then send back to A.                                                                                                                                                                                      |
| `cycle`      | Arbitrum Sepolia to Base Sepolia to Sepolia to Arbitrum Sepolia: mint on Arbitrum, send, revise on Base, send, revise on Sepolia, send back. Needs all three networks. Records delivery seconds and the LayerZero Scan status per hop.                                                                    |

Calls use the final signatures: `mint(to, expectedTokenId, cid)` with `expectedTokenId = nextTokenId()` read just before, and `revise(tokenId, expectedRevision, cid)` with the revision read just before. An expected revert is checked twice: the `eth_call` must fail with the named custom error and arguments, and the same call is then broadcast with a fixed gas limit so that the failure is also on chain (a mined transaction with status 0; a node that refuses the transaction with the same error is recorded as such).

**Real payloads.** `tasks/payload.ts` builds an `idpp-passport/1` envelope per revision (`deploymentId` from the manifest, `tokenId`, `revision`, `previousCid`, `kind: "cask"`, `granularity: "item"`, small `data`), canonicalizes it (RFC 8785), computes the CID (CIDv1, raw, sha2-256, base32), uploads the bytes to Pinata, asserts the returned CID equals the prediction, and fetches the bytes back through `PINATA_GATEWAY` and compares them. Only then does the CID go on chain. A different CID or different bytes fails the flow; a returned CID is never adopted.

**Verification columns.** After every step that reads `passportOf` (mint, revise, transfer, the stale revise, and the destination of each send), the harness downloads the bytes behind the CID and reports three results, each `verified`, `failed` or `skipped`:

- `content`: the downloaded bytes hash to the CID (checked before parsing).
- `binding`: the envelope's `deploymentId`, `tokenId` and `revision` equal the on-chain record.
- `history`: the `previousCid` chain, followed back to revision 0, is unbroken and equals the CIDs this run wrote on chain.

A step whose three results are not all `verified` fails its flow and is counted as a verification failure. The reports carry the three columns for each step and one summary line, `N flows run, P passed, V verification failures`; the process exits non-zero if a flow failed or `V > 0`.

```bash
scripts/live.sh e2e:flows                                   # all four flows on all three testnets
scripts/live.sh e2e:flows --flows local,stale --networks arbitrum-sepolia
scripts/live.sh e2e:flows --flows crosschain --networks arbitrum-sepolia,base-sepolia --timeout 3600
scripts/live.sh e2e:flows --flows cycle --timeout 3600            # Arbitrum -> Base -> Sepolia -> Arbitrum
scripts/live.sh e2e:latency --networks arbitrum-sepolia,base-sepolia --hops 8 --window 2026-10-20T08:00Z  # 8 alternating sends, delivery-time statistics -> e2e_reports/latency-<runId>.{json,md,tex}
scripts/live.sh e2e:scale --window ds4                    # DS4: 20 pipelined Base mints, 10 Base -> Arbitrum sends, no pins -> e2e_reports/scale-<runId>.{json,md,tex}
npx hardhat e2e:ops --repeats 10                              # DS1: mint, revise, transferFrom, 10 observations each per chain -> e2e_reports/ops-<runId>.{json,md}
npx hardhat e2e:edge                                          # DS3, each case once: non-owner configuration, non-issuer mint, holder revise, approved operator, stale, 96-byte CID, replay -> e2e_reports/edge-<runId>.{json,md}
npx hardhat e2e:fixtures [--check]                            # write (or check for drift) the evaluation fixtures in fixtures/
npx hardhat e2e:storage [--render-only]                      # DS5: on-chain storage baseline (Foundry, forge 1.8.5) -> e2e_reports/storage-baseline.{json,md,tex}
```

It writes `e2e_reports/flows-<runId>.json` and `.md`.

`e2e:latency` mints one token per pair of chains and sends it back and forth `--hops` times (an even number, default 8, so 4 observations per direction; the protocol pools three windows to 12), through the same `sendStep` and payload verification as the core flows. Its report `e2e_reports/latency-<runId>.{json,md,tex}` gives per direction the sent and delivered counts and, for two clocks that are never pooled, n, median, quartiles, p95, min, max, mean and the Tukey outlier count. The primary clock runs from the block timestamp of `ONFTSent` on the source to the block timestamp of `ONFTReceived` on the destination (the harness locates the event with `eth_getLogs` in 1,000-block ranges, or 100-block ranges on an RPC that refuses more); the continuity clock is the one of the earlier reports (source block timestamp to the first 5 s poll). Intervals (Student t for the mean, bootstrap for the median) are printed only from n = 10. `--window` labels the observation window. Every flow, latency and gas report starts with a run header (commit and dirty flag, deployment id, runtime code hash per chain, RPC host and class, tool versions, window, parameters; `tasks/run-header.ts`), and every transaction step records `effectiveGasPrice`, the fee in wei, block number and timestamp, two same-chain times (submission to first receipt; block-timestamp difference), payload bytes, CID length and a slot state (`depth N` of a revise, `first arrival` or `return` of a send). The statistics are in `tasks/statistics.ts`. The protocol these reports follow is `docs/evaluation/PROTOCOL.md`. Each hop pays the LayerZero fee; 8 hops over three pairs is 24 sends.

`e2e:ops` (DS1) and `e2e:edge` (DS3) follow `docs/evaluation/PROTOCOL.md`. `e2e:edge` needs a second account for the approved-operator, non-issuer and non-owner cases: it is derived from the owner key (`tasks/operator.ts`, the same address on every chain) and topped up from the owner for the gas it needs, so nothing new is stored. The harness account must be an issuer (the deploy script makes the deployer one). `e2e:ops` mints, revises the first token (revision depths 1 to `--repeats`) and moves each token with the holder's `transferFrom` to a fresh address; `e2e:edge` (once per case by default) checks with `eth_call`s that the second account cannot call `setIssuer`, `setPeer`, `setEnforcedOptions`, `setBaseURI` (`OwnableUnauthorizedAccount`) or the contract's `lzReceive` (`OnlyEndpoint`), has it call `mint` (must revert `NotIssuer`), hold a token and revise it (must revert `NotIssuer` on chain), and `transferFrom` as an approved operator (the new holder's `revise` must revert `NotIssuer`, and the former owner and the operator can no longer move the token), runs the `stale` flow (`StaleRevision`, `UnexpectedTokenId`), delivers a 96-byte CID string to each chain and executes the delivered packet once more (the packet is read from the `PacketSent` event; it must revert `LZ_PayloadHashNotFound`). The 96-byte CID case has no payload behind it by design, so its steps are not payload-verified. Both tasks append every token id they create to `fixtures/ledger.md`. The dry run (`pnpm test:dryrun`) covers ops, edge and the 96-byte delivery on the in-process mock endpoint; the replay needs a real endpoint, because the mock emits no `PacketSent`.

The tasks that send (`e2e:flows`, `e2e:latency`, `e2e:edge`) use LayerZero Scan's API as the primary source on LayerZero itself (`tasks/lz-scan.ts`, `PROTOCOL.md` section 1.1). Before the first transaction, a preflight compares, for every pathway the run will send on, the source endpoint's outbound nonce with Scan's newest message on that pathway. The run does not start if the endpoint has sent a nonce Scan does not have, or if Scan's newest message is failed or not delivered 15 minutes after it was sent. While a hop waits, Scan's record is read every 30 seconds alongside ownerOf and inboundPayloadHash. Two cases fail the hop and start no further flow that sends, each after one more read of the destination: no record 5 minutes after the send, or a record not delivered 15 minutes after it. A terminal status (FAILED, BLOCKED, PAYLOAD_STORED, ...) fails the hop at once. They also refuse a send whose LayerZero fee is quoted above `--max-send-fee` (default 0.1 of the source chain's coin) before paying anything, and a step that waits ten minutes for a receipt fails with that cause. The run header records the ceiling, the fee-policy formula and its floor.

All live tasks send with the fee policy of `tasks/fees.ts` (priority fee 0.001 gwei, raised to the chain's minimum price; the floor is recorded as `priorityFeeFloorWei` in the run header) instead of ethers' 1.5 gwei default, which was about a thousand times the base fee on Sepolia. On `whisky-v2-eval3`, `e2e:edge` uses Arbitrum as source into Base and Sepolia, and Base as source into Arbitrum, following the fee quotes recorded at the deployment readback (`e2e_reports/eval3-deployment-readback-1792440181462.json`); DS2 uses 8 hops per pair and window.

`e2e:storage` (DS5) answers the one comparison behind "efficiently" in the hypothesis: what it costs to keep the passport state as `(revision, cid)` against keeping the payload as `bytes`. `test/foundry/StorageBaseline.t.sol` issues and revises with `PassportRegistry` (through a harness that exposes its internal functions) and with a `BytesStore` (latest payload, or every revision in an array), for each fixture payload and for the depth-20 revision chain at 1, 5 and 20 revisions. It runs under the `ds5` Foundry profile (`isolate = true`, so every call is a transaction with cold storage and the figure is the gas of that transaction, as `emptyCallGas` in the output shows), asserts the criteria written beforehand (the registry's cost is flat over payload sizes; the cost of bytes grows with their size; keeping history grows with the revisions) and, with `WRITE_STORAGE_BASELINE=1`, writes `e2e_reports/storage-baseline.json` byte for byte reproducibly. The task runs forge with that environment and renders the Markdown and LaTeX tables; `--render-only` renders the committed JSON, and `pnpm test:tasks` checks that the committed tables are exactly what the committed JSON renders to. Plain `forge test` also runs the assertions, without writing and without the cold-storage figures. ERC-721 ownership is the same in both designs and is left out; the cost of pinning off chain is outside gas.

`npx hardhat e2e:fixtures` writes the fixture set of the protocol to `fixtures/`: single payloads (cask minimal, full and batch; bottles with 1, 3 and 10 source casks; a bottle batch; payloads of exactly 2 KiB and 64 KiB), the depth-20 revision chain (depths 1, 5 and 10 are its prefixes), a hostile set (token and deployment mismatch, altered bytes, broken chain, decoy predecessor, future revision) and `sizes.json` with the canonical length, CID and SHA-256 of each. The payload files hold the canonical bytes exactly as they are hashed (no trailing newline), so Foundry reads them with `vm.readFileBinary`. `--check` fails on any difference; `pnpm test:tasks` runs the same check. `e2e:tables --source ops|edge` builds the gas table of those reports.

`npx hardhat e2e:tables [--deployment <generation-id>]` gathers gas per operation, chain and slot state from the flow reports of one deployment into `e2e_reports/gas-per-operation-<deployment>.{json,md,tex}`; reverted steps are excluded. The latency report also writes a `.tex` file. The `.tex` files are booktabs tables for `\input` (needs `\usepackage{booktabs}`). `--source ops|edge|latency` builds the tables of DS1, DS3 and DS2 (pooled over windows) only from the runs that `docs/evaluation/runs.json` lists for that dataset, and `--source all` regenerates every table, the DS5 render and `docs/evaluation/data-index.md`; running it twice gives no diff.

Environment (`.env`, see `.env.example`):

| Key                             | Meaning                                                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PRIVATE_KEY` or `MNEMONIC`     | The account must own the contracts and be an issuer on every network used (the harness checks both before its first transaction; the deploy script makes the deployer the owner and the first issuer), and hold native balance on every network used. |
| `RPC_URL_*`                     | Optional RPC overrides.                                                                                                                                                              |
| `PINATA_JWT`                    | Pinata API key (JWT) used to pin the payloads.                                                                                                                                       |
| `PINATA_GATEWAY`                | Gateway host for the read-back and the verification, for example `gateway.pinata.cloud` or `<name>.mypinata.cloud`.                                                                  |
| `PINATA_UPLOAD_PATH` (optional) | `v3` (default): `POST uploads.pinata.cloud/v3/files` with `network=public`, `cid_version=v1`, the request of the `pinata` 2.5.6 SDK. `legacy`: `pinFileToIPFS` with `cidVersion: 1`. |

Offline tests, none of which need a key, an RPC or Pinata:

```bash
pnpm test:tasks    # CID shared test vector, canonicalization, envelope, verification columns (mocked gateway), custom-error decoding, report
pnpm test:dryrun   # the flows themselves on the in-process Hardhat network with mock endpoints and a fake Pinata and gateway
```

`pnpm test:dryrun` runs the same flow code as `e2e:flows`, but is not live evidence. The CID profile is implemented in `tasks/payload.ts` with `multiformats` 9.9.0 and `canonicalize` 2.1.0, pinned without ranges: Hardhat 2 runs these tasks as CommonJS on Node 18, and later versions of both packages are ESM only. For the envelope's string values their output equals `multiformats` 14.0.5 and `canonicalize` 5.1.0 in `app`; both sides are tested against the same vector.

## Notes

The scripts deploy one contract per chain. Never peer contracts from different deployment generations: a redeployed contract re-issues token IDs.

LayerZero provides transport, not truthfulness. Whether passport data is valid still depends on authorized issuers, signatures and the link between physical product and digital record.

## Live execution

Run live tasks through `scripts/live.sh <hardhat task args>`; read-only calibration uses `scripts/live.sh --node scripts/sepolia-lzreceive-gas.js --network <network>`. The wrapper keeps its active log outside git until the run header is captured and archives it to `e2e_reports/live-*.log` on exit, prints status every 30 seconds and sends SIGINT after 300 seconds without a new child line or 480 seconds of repeated waiting/404 output, then SIGKILL after a 30-second checkpoint grace. Watchdog status lines do not reset the silence clock. Before flows, latency or edge, it requires `scripts/scan-health.sh` to find the newest sampled message to another eval3 chain under one hour old and DELIVERED/INFLIGHT on every eval3 source.

Flows, latency, ops and edge checkpoint JSON/Markdown on SIGINT or SIGTERM with `status: "interrupted"`, preserving pending transaction hashes and already-paid sends. They start no further write or pin after interruption. Unknown pathway Scan preflight refuses a run unless `--allow-unknown-scan` is explicitly recorded; this flag does not bypass the wrapper's source-health gate. Three consecutive Scan HTTP/network errors after the five-minute grace stop a hop after a final destination read; the report distinguishes Scan unavailability from an observed absent record. Pinata uploads have a 60-second deadline per request and at most three retries (transient errors only); gateway requests have ten-second deadlines including response bodies. RPCs have 20-second request limits, receipt observation a ten-minute limit and a 30-second heartbeat. A timeout never cancels a submitted transaction.
