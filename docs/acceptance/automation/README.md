# Acceptance automation

Browser and chain scripts behind the DS9 to DS12 records in [`docs/acceptance/`](..): the [live-suite report](../2026-10-20-live-suite.md) and the raw files in [`2026-10-20-ds9-ds11/`](../2026-10-20-ds9-ds11/). They are evidence tooling, not part of the app or the contracts, and they are not run in any test suite. Each script's header states what it does, how to run it and what it writes.

## Prerequisites

- `app/`: `pnpm install`. The browser and chain scripts load Playwright and viem from `app/apps/web` (Chromium via `pnpm --filter web exec playwright install chromium`). Web app on `APP_URL` (`pnpm build`, then `pnpm exec next start -p <port>` in `app/apps/web`) and indexer on `INDEXER_URL` (`pnpm exec ponder start --port <port> --schema <name>` in `app/apps/indexer`), both with the env files described in [`app/README.md`](../../../app/README.md).
- Secrets only from the environment or git-ignored files, never from the repository: `PRIVATE_KEY` (or `MNEMONIC`), `PINATA_JWT` and `PINATA_GATEWAY`. Output goes to `ACCEPTANCE_OUT` (default `eval3/out` next to the scripts, git-ignored); create that folder first, because only `ds10-chain.cts` creates it itself.
- `ds9.mjs` imports the built `@idpp/passport-config`: run `pnpm --filter @idpp/passport-config build` in `app/` first.

## Scripts by dataset

| Dataset | Scripts in `eval3/` | Record |
| --- | --- | --- |
| DS9 | `ds9.mjs` | [`DS9.md`](../../evaluation/DS9.md) |
| DS10 | `ds10-chain.cts` (fixtures), `ds10-standin.mjs` (indexer stand-in), `ds10-ui.mjs` (reader loads), `rpc-probe.sh` | [`DS10.md`](../../evaluation/DS10.md) |
| DS11 | `ds11-absence.mjs` | [`DS11.md`](../../evaluation/DS11.md) |
| DS12 | `loadmore.mjs`, `ds12-table.cts` | [live-suite report](../2026-10-20-live-suite.md) |
| all | `ledger.cts` (fixture ledger rows), `index-records.mjs` (`ui-<run id>.json` records for the data index) | [data index](../../evaluation/data-index.md) |

The `.cts` scripts use the helpers of `smart_contracts/tasks/`. They run from `smart_contracts/` (after `pnpm install` there), not from this folder. `ds10-chain.cts` also imports `viem`, which it takes from the web app's dependencies through `NODE_PATH`:

```bash
cd smart_contracts
NODE_PATH=../app/apps/web/node_modules npx ts-node --transpile-only --project tsconfig.json ../docs/acceptance/automation/eval3/<script>.cts <args>
```

## Warning

`ds10-chain.cts` sends real transactions on public testnets and pins files. Read a script before running it. Re-running a script that writes creates new fixtures.
