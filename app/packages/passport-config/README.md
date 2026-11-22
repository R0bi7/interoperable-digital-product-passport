# @idpp/passport-config

Shared, side-effect-free configuration and verification code for the IDPP V2 web app and indexer.

| Export | Source | Purpose |
| --- | --- | --- |
| `MANIFEST`, `getChain`, `getChainByEid`, `originOf`, `ID_SPACE` | `src/manifest.ts` | Deployment copy: chain id, LayerZero eid, address, deployment block |
| `whiskyDistilleryAbi` | `src/generated/abi.ts` | ABI `as const` for viem typing |
| `passportEnvelopeSchema`, `PassportEnvelope`, `caskDataSchema`, `bottleDataSchema`, `sourceCaskSchema`, `ENVELOPE_SCHEMA_ID` | `src/envelope.ts` | zod schema of the `idpp-passport/1` envelope |
| `canonicalize`, `canonicalBytes`, `MAX_PAYLOAD_BYTES`, `PayloadTooLargeError` | `src/canonicalize.ts` | RFC 8785 bytes, at most 64 KiB |
| `computeCidV1`, `parseCid`, `isProfileCid`, `RAW_CODEC`, `SHA2_256_CODE` | `src/cid.ts` | CIDv1, raw, sha2-256, base32 (`bafkrei…`) |
| `verifyContent`, `verifyBinding`, `verifyHistory` | `src/verify.ts` | The three verification results; never throw |
| `nextHistoryHash`, `historyHashOf`, `verifyHistoryHash`, `ZERO_HISTORY_HASH` | `src/history-hash.ts` | Mirror of the contract's `nextHistoryHash`: `keccak256(abi.encode(previous, tokenId, revision, cid))`, folded over revisions 0..r and compared with `passportOf(id).historyHash`. `test/history-hash.test.ts` holds vectors read from the deployed contract |

The interface definitions (envelope, canonical bytes, CID profile, shared test vector, verification results) are in [`docs/TECHNICAL-REFERENCE.md`](../../../docs/TECHNICAL-REFERENCE.md) ("Interfaces"), described as this package builds them.

## Pinned libraries

The CID of a payload depends on these exact versions, so they are pinned without ranges in `package.json`:
`canonicalize` 5.1.0 (RFC 8785), `multiformats` 14.0.5, `zod` 4.6.6, and the Pinata SDK `pinata` 2.5.6 (a devDependency here, used by the integration test).

**`apps/web` pins the same `pinata` version, 2.5.6, without a range.** Bump it together with this package
after re-running `test:int`; the upload path recorded below is only valid for that version.

## Envelope schema choices

The envelope's fields and rules (required and optional `data` fields per kind, batch fields, strict objects) are defined in
`docs/TECHNICAL-REFERENCE.md` ("Interfaces", "Payload envelope"); `src/envelope.ts` implements them with zod.

## Contract copy

`src/generated/{manifest.json,abi.json,abi.ts}` are written by

```bash
pnpm --filter @idpp/passport-config sync-contracts
```

from `smart_contracts/deployments/manifest.json` and the ABI of the first network's `WhiskyDistillery.json`.
The script fails if the manifest is missing. `--abi-only` regenerates `abi.ts` from `abi.json`.

The current copy (its generation is the `deploymentId` of `src/generated/manifest.json`, `whisky-v2-eval3`; its runs are in `docs/evaluation/data-index.md`): 3 chains, 105 ABI entries (among them `isIssuer`, `setIssuer`, `nextHistoryHash`, the `IssuerSet` event and the `NotIssuer` and `InvalidIssuer` errors; `passportOf` returns `historyHash` too), only the
three-argument `mint(address,uint256,string)` and `revise(uint256,uint64,string)`. When the contracts are
redeployed, re-run the script and commit the result in the same change.

## Tests

```bash
pnpm --filter @idpp/passport-config test       # unit tests + mocked gateway tests (never touches Pinata)
PINATA_JWT=… pnpm --filter @idpp/passport-config test:int   # live round trip only
```

`test/vector.test.ts` checks the shared test vector exactly: 312 canonical bytes, the sha2-256 digest and
`bafkreibnugdjrt4xfyb4untqebjbktbq7lhbbxbiwtlgcefchoioao6dhm`.

### Pinata upload path

`test/pinata.int.test.ts` uploads the test-vector bytes as a `File`, asserts the returned CID equals the
predicted one (a mismatch fails; a different CID is never adopted), then fetches the bytes from the gateway
and compares them byte for byte. It runs only under `test:int` and is skipped there unless `PINATA_JWT` is set. An unknown `PINATA_UPLOAD_PATH` fails the run. Environment:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PINATA_JWT` | unset (skip) | Pinata API JWT |
| `PINATA_GATEWAY` | `gateway.pinata.cloud` | Gateway host for the read-back |
| `PINATA_UPLOAD_PATH` | `sdk` | `sdk`: `pinata.upload.public.file(file).cidVersion("v1")`; `legacy`: `POST /pinning/pinFileToIPFS` with `pinataOptions: { cidVersion: 1 }`; `both` |

| Path | Result |
| --- | --- |
| SDK (`pinata` 2.5.6, public, CID v1) | **Verified live on 2026-10-12.** Returned `bafkreibnugdjrt4xfyb4untqebjbktbq7lhbbxbiwtlgcefchoioao6dhm`, the predicted CID; the gateway read-back returned identical bytes. |
| Legacy `pinFileToIPFS`, `cidVersion: 1` | **Verified live on 2026-10-12.** Same CID, identical bytes on read-back. |
| Direct `POST https://uploads.pinata.cloud/v3/files` (`network=public`, `cid_version=v1`), used by the `smart_contracts` harness (`tasks/payload.ts`, upload path `v3`) | **Verified live** in that harness. It is not a path of the web app. |

The web app keeps `sdk` as its default (`PINATA_UPLOAD_PATH`, `apps/web/src/lib/pinata`); `legacy` is the
fallback if Pinata changes the SDK. Re-run
`PINATA_UPLOAD_PATH=both PINATA_JWT=… pnpm --filter @idpp/passport-config test:int` after a Pinata or SDK
upgrade and update this table. The mocked gateway tests in `test/gateway.test.ts` (exact bytes, corrupt
response, 404, network error) run with `pnpm test`.

Ownership proof: `src/ownership-proof.ts` exports strict challenge/proof codecs, the EIP-712 domain/types and signature verification. The browser supplies its own challenge record and a fresh owner read; replay consumption stays with the verifier page. Full wire format and limits: [`docs/TECHNICAL-REFERENCE.md`](../../../docs/TECHNICAL-REFERENCE.md), “Ownership proof”.
