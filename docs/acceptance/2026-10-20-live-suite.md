# Live suite on the current UI, 2026-10-20 (DS12)

Label: LIVE (whisky-v2-eval3). The runs used commit `cc92544`, with the app source unchanged from the other app runs (DS9 to DS11). The DS12 figure set and the proof of ownership ran from the test-only harness commits `2f8109e` to `e64240e`, which add specs under `app/apps/web/e2e-live/` and change no app source. Raw files are in [`2026-10-20-live-suite/`](2026-10-20-live-suite/). Protocol: [`PROTOCOL.md`](../evaluation/PROTOCOL.md) DS12.

## Before the runs

Read-only at 2026-10-20 14:44 to 14:46 UTC, account `0x9415E00f429549A26310C83c1F47db40eb300415` (the harness key; the web app's `OPERATOR_PRIVATE_KEY` is the same address):

| Item | Value |
| --- | --- |
| Balances | Arbitrum Sepolia 0.09666 ETH, Base Sepolia 0.09698 ETH, Sepolia 2.24264 ETH |
| `quoteSend` per pathway | 0.000099 to 0.000142 ETH (Arbitrum to Base 0.000102, Base to Arbitrum 0.000108) |
| Pinata | 455 public files, 500 allowed (499 after the DS9 to DS12 runs) |
| LayerZero Scan | healthy on all three eval3 chains (`scripts/scan-health.sh`) |

After the DS9 to DS12 runs (17:05 UTC): 0.09521 / 0.09588 / 2.24264 ETH and 499 of 500 Pinata files. The Pinata margin is used up; see "Limits".

The indexer ran locally from this checkout on a fresh PGlite schema (`eval3_ds12_<UTC>`), and the suites started only after all 61 eval3 ledger ids were listed as `held` with every chain caught up.

## Results

| Suite | Command | Result |
| --- | --- | --- |
| Indexer HTTP API against the chains | `pnpm --filter indexer test:live` | **17/17 passed** ([log](2026-10-20-live-suite/indexer-test-live.log)) |
| Pinata round trip | `pnpm --filter @idpp/passport-config test:int` | **1/1 passed** ([log](2026-10-20-live-suite/passport-config-test-int.log)) |
| Live flows, `LIVE_REPEAT=10`, `INDEXER_URL` set | `pnpm --filter web test:e2e:live` | **42/42 passed** in 40.3 min, clean tree ([log](2026-10-20-live-suite/flows.log), [timings](2026-10-20-live-suite/ui-timings.json)) |
| Read pages, scan, mint refusal, `LIVE_SPEND=1` | `pnpm --filter web test:e2e:indexer` | **7 passed, 4 failed** ([log](2026-10-20-live-suite/indexer-suite-attempt1.log)); causes below |
| Same suite, read-only, `LIVE_TOKEN_ID=421614000000000035` | as above | 8 passed, 2 failed, 1 skipped ([log](2026-10-20-live-suite/indexer-suite-attempt2.log)) |
| Figure set and proof of ownership | `playwright test -c playwright.evidence.config.ts e2e-live/evidence.spec.ts` | **2/2 passed** ([log](2026-10-20-live-suite/evidence.log)) |

### Timings

Run header: start 2026-10-20T15:01:58.714Z, commit `cc92544`, `gitDirty: false`, deployment `whisky-v2-eval3`, Node 24.10.0, Playwright 1.64.0, indexer `http://localhost:42069`. Mint and revise on Arbitrum Sepolia; the round trips use one token, `421614000000000035`. The table is generated from [`ui-timings.json`](2026-10-20-live-suite/ui-timings.json) by [`ds12-table.cts`](automation/eval3/ds12-table.cts) with the harness statistics (PROTOCOL.md rules 5 and 9); its copy is [`ui-timings-table.md`](2026-10-20-live-suite/ui-timings-table.md).

DS12 UI timings, LIVE (whisky-v2-eval3), one run started 2026-10-20T15:01:58.714Z from commit `cc92544`, window ds12. Seconds. Observations: 41 verified. Quartiles and p95 by linear interpolation; outliers outside the Tukey fences, reported, not removed; median 95% CI by percentile bootstrap (2,000 resamples, seed 1), only for n ≥ 10.

| Operation | Measure | Clock | n | min | Q1 | median | Q3 | p95 | max | outliers | median 95% CI |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| mint | click to confirmed | Playwright | 10 | 3.85 | 4.38 | 4.63 | 4.88 | 4.89 | 4.89 | 0 | 4.37 to 4.88 |
| mint | confirmed to verified | Playwright | 10 | 0.94 | 0.95 | 1.15 | 4.73 | 6.15 | 6.34 | 0 | 0.95 to 5.92 |
| revise | click to confirmed | Playwright | 11 | 4.37 | 4.37 | 4.38 | 4.38 | 4.87 | 4.88 | 2 | 4.37 to 4.38 |
| revise | confirmed to verified | Playwright | 11 | 0.94 | 0.95 | 1.15 | 6.14 | 6.25 | 6.34 | 0 | 0.95 to 6.15 |
| send, Arbitrum Sepolia to Base Sepolia | click to confirmed | Playwright | 10 | 2.34 | 2.84 | 2.85 | 3.22 | 3.35 | 3.35 | 0 | 2.84 to 3.34 |
| send, Arbitrum Sepolia to Base Sepolia | confirmed to verified | Playwright | 10 | 25.93 | 30.93 | 45.93 | 50.94 | 51.13 | 51.13 | 0 | 25.94 to 50.94 |
| send, Arbitrum Sepolia to Base Sepolia | panel mounted to delivered | browser | 10 | 25.91 | 30.83 | 45.22 | 51.45 | 51.89 | 52.23 | 0 | 26.06 to 51.45 |
| send, Base Sepolia to Arbitrum Sepolia | click to confirmed | Playwright | 10 | 1.82 | 1.83 | 1.83 | 1.84 | 1.84 | 1.84 | 0 | 1.83 to 1.84 |
| send, Base Sepolia to Arbitrum Sepolia | confirmed to verified | Playwright | 10 | 40.93 | 42.32 | 46.04 | 49.79 | 53.79 | 55.94 | 0 | 41.12 to 50.93 |
| send, Base Sepolia to Arbitrum Sepolia | panel mounted to delivered | browser | 10 | 44.40 | 44.43 | 44.50 | 50.73 | 54.22 | 57.02 | 0 | 44.42 to 50.74 |

The revise row holds ten sample revisions and the successful second-tab revision of the stale race; the stale revise itself was refused with "Out of date" and the chain stayed at revision 2. "Confirmed" is the UI's confirmation message (the source receipt); "verified" is the reader page showing every check verified against the indexer-backed build. For a send, verified means the destination reader agrees, so it contains the delivery. Each operation and each send direction has n ≥ 10, as DS12 requires. Each measure stays on one clock: the panel's mounted and delivered times are browser-clock attributes and are not subtracted from the Playwright clock (the panel mounts 0.4 to 0.5 s before the Playwright-observed confirmation in every send). Resolution: click to confirmed and confirmed to verified are observed by Playwright's assertion polling, so their values fall on steps of about 0.5 s (the Base to Arbitrum click-to-confirmed values all lie between 1.82 and 1.84 s); the panel polls every 6 s and settled stale reader pages reload every 5 s (PROTOCOL.md DS12). These are UI observation clocks, not block timestamps.

### Indexer suite failures and their causes

All four failures of the first run are assumptions of the specs that the data of 2026-10-20 no longer meets; none is a fault of the app:

- **"shows the indexer's passports, not fixtures"** (timed out after 15 min) and **"filters by status and by chain"** (35 rows expected on Arbitrum, 20 shown): both expect the list to show every passport of a filter without paging through, or click "Load more" in a tight loop. The indexer lists 72 tokens (35 on Arbitrum Sepolia) and the page shows 20 at a time. The error context at the timeout shows all 72 rows and no "Load more" button: the spec's loop outlived the button (an `isVisible`-then-`click` race after the last page), and the filter spec counts the first page only. A separate check with [`loadmore.mjs`](automation/eval3/loadmore.mjs) at 17:30 UTC ([`loadmore.json`](2026-10-20-live-suite/loadmore.json); by then 83 tokens) paged 20, 40, 60, 80, 83 with one click each (the click action itself took 12 to 46 ms; rows counted 3 s later) until the button was gone and saw no DOM change while idle, so a user reaches every passport. The specs need paging, not the app.
- **"one card per revision"** and **"verifies every revision's payload"**: the suite picks the held, crossed token with the fewest revisions, here `84532000000000018`, a DS3 maximum-length fixture whose on-chain CID is the synthetic 96-byte string. The reader correctly shows `content: unavailable` ("CID is not a CIDv1 raw sha2-256 base32 CID") plus its reason line, so the locator `^content: ` finds two elements where the spec counts one. The read-only rerun with `LIVE_TOKEN_ID=421614000000000035` (real payloads, 43 timeline events) passed all six detail tests.
- The `LIVE_SPEND=1` send (subject `84532000000000018`, Arbitrum Sepolia to Base Sepolia) passed: the indexer placed the token on the destination and the delivery panel cited it. Its timing record says `timed-out` for confirmed-to-verified, because the reader of a synthetic-CID token never reaches "verified"; it is not one of the DS12 samples above ([timing](2026-10-20-live-suite/ui-timings-indexer-live-spend.json)). The token is a DS3 fixture already in the ledger; the send moved it to Base Sepolia.

The error contexts of both runs are in [`indexer-suite-errors/`](2026-10-20-live-suite/indexer-suite-errors/).

### Proof of ownership

On `421614000000000035` (held on Arbitrum Sepolia): the verifier page created a challenge (chain 421614, 120 s expiry), the holder page signed it with `eth_signTypedData_v4` (the only wallet request), the verifier read `ownerOf` afresh and showed "Ownership verified: 0x9415E00f429549A26310C83c1F47db40eb300415 signed this challenge and owns the token at the fresh chain read. The challenge is now consumed."; presenting the same proof again gave "Ownership not verified: already used." Record: [`ownership.json`](2026-10-20-live-suite/ownership.json). No transaction.

### Figure set

[`figures/`](2026-10-20-live-suite/figures/): list, detail with the verification results, QR code, filled mint form (not submitted), quoted send form (not submitted), the three ownership steps; the delivery panel in flight and delivered is in the DS11 record ([`2026-10-20-ds9-ds11/ds11/`](2026-10-20-ds9-ds11/ds11/)). All from the indexer-backed production build.

## Attempts not counted

- **Live flows, attempt 1** (14:59 UTC): stopped after its first mint because the run header recorded `gitDirty: true` (log files of this report sat untracked in the tree). Token `421614000000000025` (revision 0, one pin) is in the ledger as an aborted attempt; the raw timing file is kept ([`ui-timings-attempt1-aborted.json`](2026-10-20-live-suite/ui-timings-attempt1-aborted.json)).
- Two runs of the figure spec failed on harness locators (the list subject sat on page 2; the send form's destinations render after the token is located) before any signature; fixed in `c7e36ee` and `e64240e`.

## Limits

- The wallet is the injected EIP-1193 provider that signs in the Node process with the operator key; no wallet extension (Hana or another), WalletConnect or camera was exercised.
- Every write came from one key, which is the issuer, the operator of the mint API and the holder. Holder-only and stranger paths are covered by the mint refusal tests and by DS1/DS3, not by this run.
- Mint and revise ran on Arbitrum Sepolia and sends between Arbitrum and Base Sepolia only (the suite's fixed pathway). The browser's default Sepolia RPC answered 429 to most requests on this day (see DS10), so a Sepolia reader would not have reached its live read.
- The UI run headers record commit, dirty flag, deployment id, chain addresses, tool versions and the indexer URL, but not the deployed bytecode hash per chain or the RPC provider class that PROTOCOL.md rule 7 asks for. The app reads the manifest it was built with (unchanged since the deployment readback of the eval3 bytecode); the browser used viem's public default RPCs; the indexer's endpoints come from the ignored `apps/indexer/.env.local` and their class is not recorded.
- Pinata held 499 of its 500 Free-plan files after these runs.

## How this was run

From `app/`, with `apps/web/.env.local` and `apps/indexer/.env.local` configured for eval3 (not committed):

```bash
DATABASE_SCHEMA=eval3_ds12_<UTC> pnpm --filter indexer start      # wait for 61 held ids, chains caught up
INDEXER_URL=http://localhost:42069 pnpm --filter indexer test:live
pnpm --filter @idpp/passport-config test:int                       # PINATA_JWT from the web env
INDEXER_URL=http://localhost:42069 LIVE_REPEAT=10 pnpm --filter web test:e2e:live
INDEXER_URL=http://localhost:42069 LIVE_SPEND=1 pnpm --filter web test:e2e:indexer
INDEXER_URL=http://localhost:42069 LIVE_TOKEN_ID=421614000000000035 pnpm --filter web test:e2e:indexer
NEXT_PUBLIC_INDEXER_URL=http://localhost:42069 pnpm --filter web exec next build
EVIDENCE_TOKEN=421614000000000035 pnpm --filter web exec playwright test -c playwright.evidence.config.ts e2e-live/evidence.spec.ts
```

Paging check, from the repository root, against a production build on another port (here the DS10 stand-in build: its list has the indexer's rows, with the revision and CID of the three future-case tokens rewritten; the row count is unaffected):

```bash
APP_URL=http://localhost:3120 node docs/acceptance/automation/eval3/loadmore.mjs > docs/acceptance/2026-10-20-live-suite/loadmore.json
```
