# Interoperable Digital Product Passport demonstrator

An Interoperable Digital Product Passport (IDPP) is a digital product passport that can move between blockchains. This repository holds a demonstrator built for a master's thesis: each passport is an ERC-721 token whose record (`revision`, `historyHash`, `cid`) stays on chain, with the passport data on IPFS. Tokens move between chains as a LayerZero V2 ONFT721 and carry their record with them. A whisky distillery (casks and bottles) serves as the example domain.

This is a feasibility demonstrator on public testnets, not a production system.

| Directory | Contents |
| --- | --- |
| [`smart_contracts/`](smart_contracts/README.md) | `WhiskyDistillery` contract, Foundry and Hardhat tests, deployment records of `whisky-v2-eval3` (Sepolia, Arbitrum Sepolia, Base Sepolia), the measurement harness and its raw reports |
| [`app/`](app/README.md) | Next.js web app (create, revise, transfer, send and verify passports), Ponder indexer and the shared `@idpp/passport-config` package |
| [`docs/`](docs/README.md) | Technical reference, evaluation protocol, dataset write-ups and acceptance records |

Start with the [app guide](app/README.md) to run the demonstrator, or the [contracts guide](smart_contracts/README.md) to build and test the contracts.
