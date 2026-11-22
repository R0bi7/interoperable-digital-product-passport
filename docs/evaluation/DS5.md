# DS5: local on-chain storage baseline

**Label: LOCAL (registry with issuer role and history hash; eval3 fixtures).** This is a Foundry experiment, not a live-chain gas measurement. It supports the storage-cost part of the hypothesis and the on-chain/off-chain design trade-off.

The raw record is [`storage-baseline.json`](../../smart_contracts/e2e_reports/storage-baseline.json); generated [Markdown](../../smart_contracts/e2e_reports/storage-baseline.md) and [LaTeX](../../smart_contracts/e2e_reports/storage-baseline.tex) tables contain every value. Source: `smart_contracts/test/foundry/StorageBaseline.t.sol`, updated at commit `b3be782` to count the history-hash slot. Fixture generation is `whisky-v2-eval3`; `fixtures/sizes.json` records the canonical byte lengths and CIDs.

## Method and reproducibility

Run from `smart_contracts/`: `scripts/live.sh e2e:storage`. Forge 1.8.5, solc 0.8.28, Cancun, optimizer 200 runs, profile `ds5`, with each external call isolated as its own transaction. The empty call costs 21,601 gas; the figures include the base gas, calldata, dispatch and execution. No RPC, deployed contract, wallet or Pinata pin is used. Repeating the command reproduces the raw JSON and both tables byte for byte. The raw record is re-rendered with the eval3 tables; the experiment inputs are unchanged.

The registry keeps `(revision, historyHash, cid)` and emits the CID; the comparison keeps the payload bytes, either replacing the latest value or retaining every revision. ERC-721 ownership is excluded from both. The per-passport slot calculation is two fixed slots (revision and history hash), plus the string length/data slots. A 59-byte CID therefore occupies five slots per passport; the shared counter is separate.

## Result

For the nine payload fixtures (318 to 65,536 bytes), registry issue costs 143,512 gas and its first revision costs 68,130, independent of payload length because every CID is 59 bytes. Keeping the bytes costs 297,924 to 46,642,942 gas at issue (2.1 to 325.0 times the registry), and 105,890 to 11,634,096 when every payload word changes (1.6 to 170.8 times). A localized one-word edit costs 80,690 to 5,951,824 gas (1.2 to 87.4 times). The 64 KiB issue exceeds the table's 30-million-gas reference block size; it is not claimed to fit any particular live chain.

Across the 20-version fixture (the issue plus 19 revisions), the registry costs 1,130,398 cumulative gas and still holds five per-passport slots. Replacing the latest bytes costs 1,925,474 gas and 15 slots; retaining every revision costs 7,059,519 gas and 280 slots. The intermediate depths and byte totals are in the generated table.

## Limits

The result compares these storage representations under one local gas schedule. It does not predict Sepolia or either L2's gas, total fees, IPFS availability, pinning cost or energy use. The byte-store baselines do not implement the registry's portable history hash, so they are reference storage strategies rather than feature-equivalent complete passports. Slot counts are calculated from value lengths, not measured from a deployed contract's storage layout. The history hash commits to earlier CIDs; it does not retain their payload bytes on chain.
