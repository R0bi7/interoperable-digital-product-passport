# Documentation and evidence

| Document | Contents |
| --- | --- |
| [Technical reference](TECHNICAL-REFERENCE.md) | Shared model and interfaces of the contracts, the app and the indexer; local tests for selected requirements |
| [Evaluation protocol](evaluation/PROTOCOL.md) | What each dataset measures, how, how often, and its pass criterion |
| [Data index](evaluation/data-index.md) | Every run with its dataset, window, commit, deployment and raw files (generated from [`runs.json`](evaluation/runs.json)) |
| Dataset write-ups | [DS1](evaluation/DS1.md) single-chain operations, [DS2](evaluation/DS2.md) cross-chain delivery, [DS3](evaluation/DS3.md) rule checks, [DS4](evaluation/DS4.md) minimal scale, [DS5](evaluation/DS5.md) storage baseline, [DS9](evaluation/DS9.md) second copy on IPFS, [DS10](evaluation/DS10.md) tamper cases, [DS11](evaluation/DS11.md) bottle from casks |
| [Live suite on the UI](acceptance/2026-10-20-live-suite.md) | DS12: the app's live Playwright and indexer suites, UI timings and figures |
| [Receive gas per destination](evaluation/SEPOLIA-GAS.md) | Simulated `lzReceive` gas per destination behind the enforced options in `smart_contracts/layerzero.config.ts` |
| [Acceptance automation](acceptance/automation/README.md) | Scripts behind the DS9 to DS12 records |

Raw reports and generated tables are in [`smart_contracts/e2e_reports/`](../smart_contracts/e2e_reports/); test tokens are listed in the [fixture ledger](../smart_contracts/fixtures/ledger.md) and are not product inventory.

## Reproduce the tables without new measurements

From `smart_contracts/`, with Node 24.10.0 (the version the run headers record):

```bash
pnpm install --frozen-lockfile
npx hardhat e2e:tables --source all
git status --short ../docs ./e2e_reports   # no output: every table regenerates from the committed raw reports
```

Rendering reads committed reports only; it sends no transaction and needs no key.

The commit hashes in run headers and in the data index refer to the original development repository, whose history is not part of this one.

In the console logs, absolute local paths are replaced by `<repo>` (the repository root) and `<tmp>` (a temporary directory), and the dedicated Pinata gateway host by `<gateway>`; nothing else in them was changed.
