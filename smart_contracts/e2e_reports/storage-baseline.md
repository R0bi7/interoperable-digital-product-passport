# On-chain storage baseline (DS5)

Generated from `e2e_reports/storage-baseline.json`. forge Version: 1.8.5, profile `ds5`. A call that does nothing costs 21,601 gas.

Each figure is the gas of one call measured with `gasleft()` around it while `forge test` runs every call as a transaction of its own (`isolate`), so storage is cold: the 21,000 base gas, the calldata, the execution and the dispatch of the caller. The call that does nothing, given above, is the floor. Registry = `PassportRegistry` as deployed (`(revision, historyHash, cid)` plus the `mintedCount` counter and the events, which carry the CID). Bytes = the payload itself as `bytes` in a mapping, with the same counter and a revision number; "all revisions" keeps every revision in an array. Issue = the first issue on a fresh contract (counter 0 to 1); revise = the first revision. "All words" rewrites every 32-byte word of the payload (the worst case), "one word" changes a single word (a localized edit). ERC-721 ownership is the same in both designs and left out. The payload bytes are the committed fixtures (`fixtures/`); the CID is 59 bytes in every row. Slot counts are calculated from the lengths, and checked only for what the stored values are, not for the layout. Pinning the payload off chain costs money outside gas and is not in these figures. † a single transaction above 30,000,000 gas, taken as a reference size for one block; the limit of each chain differs.

## One passport: issue and revise

| Payload | Bytes | Registry issue | Bytes issue | Ratio | Registry revise | Bytes revise, all words | Ratio | Bytes revise, one word | Ratio | Slots written (registry / bytes) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| cask-minimal | 318 | 143,512 | 297,924 | 2.1 | 68,130 | 105,890 | 1.6 | 80,690 | 1.2 | 5 / 12 |
| cask-full | 594 | 143,512 | 502,080 | 3.5 | 68,130 | 156,146 | 2.3 | 105,746 | 1.6 | 5 / 21 |
| cask-batch | 626 | 143,512 | 524,780 | 3.7 | 68,130 | 161,746 | 2.4 | 108,546 | 1.6 | 5 / 22 |
| bottle-1-cask | 374 | 143,512 | 343,228 | 2.4 | 68,130 | 116,994 | 1.7 | 86,194 | 1.3 | 5 / 14 |
| bottle-3-casks | 506 | 143,512 | 434,076 | 3.0 | 68,130 | 139,442 | 2.0 | 97,442 | 1.4 | 5 / 18 |
| bottle-10-casks | 968 | 143,512 | 774,360 | 5.4 | 68,130 | 223,226 | 3.3 | 139,543 | 2.0 | 5 / 33 |
| bottle-batch | 541 | 143,512 | 456,812 | 3.2 | 68,130 | 145,078 | 2.1 | 100,278 | 1.5 | 5 / 19 |
| size-2-kib | 2,048 | 143,512 | 1,523,777 | 10.6 | 68,130 | 409,109 | 6.0 | 232,763 | 3.4 | 5 / 66 |
| size-64-kib | 65,536 | 143,512 | 46,642,942 † | 325.0 | 68,130 | 11,634,096 | 170.8 | 5,951,824 | 87.4 | 5 / 2,050 |

## One passport over its revisions (cumulative gas of the issue and every revision)

| Revisions | Payload bytes in all | Registry | Bytes, latest only | Ratio | Bytes, all revisions | Ratio | Slots written (registry / latest / all) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 347 | 143,512 | 320,588 | 2.2 | 342,734 | 2.4 | 5 / 13 / 14 |
| 5 | 1,963 | 364,768 | 701,404 | 1.9 | 1,770,234 | 4.9 | 5 / 15 / 70 |
| 20 | 8,043 | 1,130,398 | 1,925,474 | 1.7 | 7,059,519 | 6.2 | 5 / 15 / 280 |
