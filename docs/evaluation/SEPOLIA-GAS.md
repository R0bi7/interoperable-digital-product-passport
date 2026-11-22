# Receive gas per destination

Status: measurement, 2026-10-19, before the `whisky-v2-eval3` pathways were wired or any message was sent. Evidence label: LIVE in the sense of read-only calls (`eth_call`) against the deployed `whisky-v2-eval3` contracts; nothing was sent and no throwaway contract was used. The measured gas is a simulation, not an observed delivery.

Question: how much `lzReceive` gas does a delivery into each destination need in the worst case, and what margin do the enforced options of `smart_contracts/layerzero.config.ts` leave?

## Method

Bisection of the gas limit of `eth_call` to `EndpointV2.lzReceive` on the destination, with a state override (`stateDiff`) that plants the payload hash of a message from another chain of the deployment and the receiver's peer entry; the peer slot is derived from the compiled storage layout (`forge inspect WhiskyDistillery storage-layout`). The message carries `(revision, historyHash, cid)`, a fresh token id and a fresh recipient (cold slots, first arrival; the script checks that the recipient holds nothing and the token is absent at the block), and the given CID length and revision. The pathway had received nothing, so the measured delivery is the first of the pathway, which also creates the endpoint's `lazyInboundNonce` slot. The minimum call gas is the minimum transaction gas limit minus the intrinsic cost of the calldata. Every input is derived from fixed strings, so a rerun at the same block sends the same calldata and override. Script: `smart_contracts/scripts/sepolia-lzreceive-gas.js --network <network>`; each run writes a raw JSON record and a Markdown table rendered from it (`--render`).

Six cases per destination: a 96-byte CID at revisions 0, 1 and 2, a 59-byte CID (the length of the CIDs the app writes) at revisions 0 and 1, and a 46-byte CID at revision 1.

## Result

| Destination | Block | Minimum call gas, worst case | Enforced gas | Margin | Raw record |
| --- | --- | --- | --- | --- | --- |
| Arbitrum Sepolia | 320,830,553 | 228,149 | 286,000 | 25.36% | [`arbitrum-sepolia-lzreceive-gas-1792439876988.json`](../../smart_contracts/e2e_reports/arbitrum-sepolia-lzreceive-gas-1792439876988.json) |
| Base Sepolia | 48,335,751 | 228,149 | 286,000 | 25.36% | [`base-sepolia-lzreceive-gas-1792439824660.json`](../../smart_contracts/e2e_reports/base-sepolia-lzreceive-gas-1792439824660.json) |
| Sepolia | 11,950,388 | 1,032,799 | 1,291,000 | 25.00% | [`sepolia-lzreceive-gas-1792439907766.json`](../../smart_contracts/e2e_reports/sepolia-lzreceive-gas-1792439907766.json) |

Every freshness check passed, every call failed one gas below its minimum, and all seven probes above each minimum succeeded. The worst case on all three is a 96-byte CID at revision 1 or 2. The L2 revision-0 case needs 207,933; a 59-byte CID needs 205,277 at revision 1 and 185,061 at revision 0; a 46-byte CID at revision 1 also needs 205,277. The enforced gas in `layerzero.config.ts` is a worst case × 1.25, rounded up: 1,032,799 into Sepolia, and for the L2s the local Foundry figure of 228,365 (forge 1.8.5), which this calibration confirms within 216 gas.

Sepolia needs about 4.5 times the L2 figure for the same message; these records do not isolate the cause.

## Limits

- The method measures the gas limit accepted by an execution-only `eth_call`. On Arbitrum it equals Base; it does not measure the ETH charge for posting a transaction to L1. Actual executor delivery at these limits is shown by the smoke run and DS2 to DS4, not here.
- A later delivery on a pathway that is in use does not create the nonce slot; its gas was not measured on this generation.
- Not measured: live deliveries at lower gas, a later gas repricing of a destination, and the executor's own overhead.
