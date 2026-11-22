# Gas per operation, deployment whisky-v2-eval3

Observations from the live edge reports (`e2e_reports/edge-*.json`). Reverted steps are excluded. State is the slot state that changes the gas; empty where the report did not record it.

| Operation | Chain | State | n | Min | Median | Max |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| approve | arbitrum-sepolia |  | 1 | 48,752 | 48,752 | 48,752 |
| approve | base-sepolia |  | 1 | 48,752 | 48,752 | 48,752 |
| approve | sepolia |  | 1 | 130,772 | 130,772 | 130,772 |
| mint | arbitrum-sepolia | later mint, to self | 1 | 155,874 | 155,874 | 155,874 |
| mint | arbitrum-sepolia | raw 96-byte CID, no payload | 2 | 178,955 | 178,955 | 178,955 |
| mint | base-sepolia | later mint, to self | 1 | 155,874 | 155,874 | 155,874 |
| mint | base-sepolia | raw 96-byte CID, no payload | 1 | 178,955 | 178,955 | 178,955 |
| mint | sepolia | later mint, to self | 1 | 604,074 | 604,074 | 604,074 |
| revise | arbitrum-sepolia | depth 1 | 1 | 72,280 | 72,280 | 72,280 |
| revise | base-sepolia | depth 1 | 1 | 72,280 | 72,280 | 72,280 |
| revise | sepolia | depth 1 | 1 | 175,700 | 175,700 | 175,700 |
| send arbitrum-sepolia -> base-sepolia | arbitrum-sepolia | first arrival | 1 | 237,434 | 237,434 | 237,434 |
| send arbitrum-sepolia -> sepolia | arbitrum-sepolia | first arrival | 1 | 237,434 | 237,434 | 237,434 |
| send base-sepolia -> arbitrum-sepolia | base-sepolia | first arrival | 1 | 237,434 | 237,434 | 237,434 |
| transfer | arbitrum-sepolia | to a new holder, transferFrom, by approved operator | 1 | 60,472 | 60,472 | 60,472 |
| transfer | base-sepolia | to a new holder, transferFrom, by approved operator | 1 | 60,472 | 60,472 | 60,472 |
| transfer | sepolia | to a new holder, transferFrom, by approved operator | 1 | 157,276 | 157,276 | 157,276 |
