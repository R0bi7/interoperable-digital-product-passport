# Gas per operation, deployment whisky-v2-eval3

Observations from the live ops reports (`e2e_reports/ops-*.json`). Reverted steps are excluded. State is the slot state that changes the gas; empty where the report did not record it.

| Operation | Chain | State | n | Min | Median | Max |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| mint | arbitrum-sepolia | later mint, to self | 10 | 155,874 | 155,874 | 155,874 |
| mint | base-sepolia | later mint, to self | 10 | 155,874 | 155,874 | 155,874 |
| mint | sepolia | later mint, to self | 10 | 604,074 | 604,074 | 604,074 |
| revise | arbitrum-sepolia | depth 1 | 1 | 72,280 | 72,280 | 72,280 |
| revise | arbitrum-sepolia | depth 2 | 1 | 55,192 | 55,192 | 55,192 |
| revise | arbitrum-sepolia | depth 3 | 1 | 55,192 | 55,192 | 55,192 |
| revise | arbitrum-sepolia | depth 4 | 1 | 55,192 | 55,192 | 55,192 |
| revise | arbitrum-sepolia | depth 5 | 1 | 55,192 | 55,192 | 55,192 |
| revise | arbitrum-sepolia | depth 6 | 1 | 55,192 | 55,192 | 55,192 |
| revise | arbitrum-sepolia | depth 7 | 1 | 55,192 | 55,192 | 55,192 |
| revise | arbitrum-sepolia | depth 8 | 1 | 55,192 | 55,192 | 55,192 |
| revise | arbitrum-sepolia | depth 9 | 1 | 55,192 | 55,192 | 55,192 |
| revise | arbitrum-sepolia | depth 10 | 1 | 55,192 | 55,192 | 55,192 |
| revise | base-sepolia | depth 1 | 1 | 72,280 | 72,280 | 72,280 |
| revise | base-sepolia | depth 2 | 1 | 55,192 | 55,192 | 55,192 |
| revise | base-sepolia | depth 3 | 1 | 55,192 | 55,192 | 55,192 |
| revise | base-sepolia | depth 4 | 1 | 55,192 | 55,192 | 55,192 |
| revise | base-sepolia | depth 5 | 1 | 55,192 | 55,192 | 55,192 |
| revise | base-sepolia | depth 6 | 1 | 55,192 | 55,192 | 55,192 |
| revise | base-sepolia | depth 7 | 1 | 55,192 | 55,192 | 55,192 |
| revise | base-sepolia | depth 8 | 1 | 55,192 | 55,192 | 55,192 |
| revise | base-sepolia | depth 9 | 1 | 55,192 | 55,192 | 55,192 |
| revise | base-sepolia | depth 10 | 1 | 55,192 | 55,192 | 55,192 |
| revise | sepolia | depth 1 | 1 | 175,700 | 175,700 | 175,700 |
| revise | sepolia | depth 2 | 1 | 77,792 | 77,792 | 77,792 |
| revise | sepolia | depth 3 | 1 | 77,792 | 77,792 | 77,792 |
| revise | sepolia | depth 4 | 1 | 77,792 | 77,792 | 77,792 |
| revise | sepolia | depth 5 | 1 | 77,792 | 77,792 | 77,792 |
| revise | sepolia | depth 6 | 1 | 77,792 | 77,792 | 77,792 |
| revise | sepolia | depth 7 | 1 | 77,792 | 77,792 | 77,792 |
| revise | sepolia | depth 8 | 1 | 77,792 | 77,792 | 77,792 |
| revise | sepolia | depth 9 | 1 | 77,792 | 77,792 | 77,792 |
| revise | sepolia | depth 10 | 1 | 77,792 | 77,792 | 77,792 |
| transfer | arbitrum-sepolia | to a new holder, transferFrom | 10 | 59,949 | 59,961 | 59,961 |
| transfer | base-sepolia | to a new holder, transferFrom | 10 | 59,961 | 59,961 | 59,961 |
| transfer | sepolia | to a new holder, transferFrom | 10 | 156,369 | 156,381 | 156,381 |

## Same-chain time (submission to first receipt, seconds)

Wall clock of the harness, all slot states of an operation together; the block-timestamp difference (inclusion block against the head block read at submission) is beside it and is not the same clock. Outliers are Tukey-fence counts (1.5 IQR) and stay in the sample. Quartiles and p95 are descriptive; no interval is given.

| Operation | Chain | n | Median (s) | Q1--Q3 | p95 | Range | Outliers | Block diff. median (s) |
| --- | --- | ---: | ---: | --- | ---: | --- | ---: | ---: |
| mint | arbitrum-sepolia | 10 | 4.4 | 4.4--4.4 | 4.5 | 4.4--4.5 | 2 | 0.5 |
| mint | base-sepolia | 10 | 0.1 | 0.1--0.4 | 4.4 | 0.1--4.4 | 2 | 2.0 |
| mint | sepolia | 10 | 8.2 | 8.1--12.1 | 12.2 | 4.1--12.2 | 0 | 12.0 |
| revise | arbitrum-sepolia | 10 | 4.4 | 4.4--4.5 | 4.5 | 4.4--4.5 | 0 | 1.0 |
| revise | base-sepolia | 10 | 0.1 | 0.1--0.2 | 0.3 | 0.1--0.4 | 1 | 2.0 |
| revise | sepolia | 10 | 8.1 | 8.1--12.1 | 12.1 | 8.1--12.2 | 0 | 12.0 |
| transfer | arbitrum-sepolia | 10 | 4.4 | 4.4--4.4 | 4.5 | 4.4--4.5 | 2 | 1.0 |
| transfer | base-sepolia | 10 | 0.3 | 0.1--0.4 | 4.4 | 0.1--4.4 | 2 | 3.0 |
| transfer | sepolia | 10 | 12.1 | 9.1--12.2 | 16.7 | 8.1--20.1 | 1 | 12.0 |

## Coverage against the DS1 pass criterion (n >= 10 per operation and chain)

| Operation | Chain | n | Met | Note |
| --- | --- | ---: | --- | --- |
| mint to self | arbitrum-sepolia | 10 | yes |  |
| revise (depths 1 to 10) | arbitrum-sepolia | 10 | yes | depths 1 to 10 covered |
| transferFrom | arbitrum-sepolia | 10 | yes |  |
| mint to self | base-sepolia | 10 | yes |  |
| revise (depths 1 to 10) | base-sepolia | 10 | yes | depths 1 to 10 covered |
| transferFrom | base-sepolia | 10 | yes |  |
| mint to self | sepolia | 10 | yes |  |
| revise (depths 1 to 10) | sepolia | 10 | yes | depths 1 to 10 covered |
| transferFrom | sepolia | 10 | yes |  |
