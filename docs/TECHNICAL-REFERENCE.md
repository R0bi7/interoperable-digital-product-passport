# Technical reference

The shared model and interfaces of the demonstrator. Implementation sources take precedence: [contracts](../smart_contracts/README.md), [app](../app/README.md), [shared payload package](../app/packages/passport-config/README.md), and [deployment manifest](../smart_contracts/deployments/manifest.json).

## Shared model

- **IDPP.** Interoperable Digital Product Passport: a DPP that can move between blockchains.
- **Whisky Distillery.** White-label name of the demonstrator. A cask or a bottle is one passport instance; the contract has no whisky-specific fields, the payload declares the kind.
- **Contract.** `WhiskyDistillery is ONFT721, PassportRegistry`. `PassportRegistry` holds the passport state (`revision`, `historyHash`, `cid`) with no token or messaging dependency; `WhiskyDistillery` adds ERC-721 ownership, the issuer role and LayerZero V2 transport.
- **Token and data rights.** Issuers create and revise passport data; holders transfer and send the token. The pinning route requires issuer rights on the holding chain. The reader checks the revision history against a live history commitment.
- **Identity.** `tokenId = idPrefix * 1e12 + sequence`, where `idPrefix` is the issuing chain's EVM chain id. The id never changes; `originOf(tokenId)` gives the issuing chain. Ids on the deployed eval3 chains (Sepolia, Arbitrum Sepolia and Base Sepolia) exceed 2^53, so clients use `bigint` everywhere and decimal strings in JSON and URLs.
- **On-chain record.** ERC-721 ownership, `Passport { uint64 revision; bytes32 historyHash; string cid }`, the issuer set (`isIssuer`), and events (`PassportIssued`, `PassportRevised`, `PassportImported`, `IssuerSet`, `ONFTSent`, `ONFTReceived`, `Transfer`). The payload lives off-chain under the CID; `tokenURI = baseURI + cid` (the base URI is owner-settable, default `ipfs://`; it need not resolve identically on every chain), and `passportOf(id).cid` is the authoritative reference.
- **Operations.** `setIssuer(account, authorized)` by the contract owner, per chain (emits `IssuerSet`); `mint(to, expectedTokenId, cid)` by an issuer, reverting `UnexpectedTokenId(expected, actual)` unless `expectedTokenId == nextTokenId()`; `revise(tokenId, expectedRevision, cid)` by an issuer on the chain where the token is (same id, `revision + 1`, history hash extended as `keccak256(abi.encode(previous, tokenId, revision, cid))`), reverting `StaleRevision(expected, actual)` unless the stored revision equals `expectedRevision`; ERC-721 transfers by the holder or an approved address as usual, and `send` by the holder only (stock ONFT721 burn on the source, mint of the same id on the destination, snapshot `(revision, historyHash, cid)` carried in the message). A non-issuer's `mint` or `revise` reverts `NotIssuer(account)`. Holding a token gives no right to write its passport.
- **Messaging.** LayerZero V2 between peered contracts, one required DVN (LayerZero Labs) per pathway, enforced `lzReceive` gas per destination. Compose messages are rejected. The DVN, confirmations and enforced gas, with their derivation, are in `smart_contracts/layerzero.config.ts`.

## How the parts connect

No subproject imports another. They meet at the deployment, a copied ABI, and the evaluation write-up.

- **Deployment.** One `WhiskyDistillery` address per chain, published by `smart_contracts/deployments/` and summarised in `smart_contracts/deployments/manifest.json` (`deploymentId`, and per chain `network`, `chainId`, `eid`, `address`, `deploymentBlock`; written by `lz:manifest`, never by hand). The web app, the indexer, and the live-flow harness all call those addresses. Contracts from different deployment generations are never peered, because a redeploy restarts the id sequence.
- **Copied interface.** `app/` keeps a copy of the manifest and the ABI in `app/packages/passport-config/src/generated/` (`pnpm --filter @idpp/passport-config sync-contracts`). When the contracts are redeployed, that copy is updated in the same change.
- **Payload.** Pinata pins the canonical bytes. The contract stores the CID. The app and the harness verify a fetched payload by recomputing its CID and comparing it with the on-chain value (the interfaces below).
- **Evidence.** [Dataset reports and run index](evaluation/data-index.md) identify the generation and raw files for each result; the run index maps dataset identifiers to runs.

Receipt metadata, delivery clocks, and reporting rules are defined in the [evaluation protocol](evaluation/PROTOCOL.md).

## Interfaces

As built in `app/packages/passport-config/src/` (envelope, canonical bytes, CID, verifiers), `app/apps/indexer/src/` (summary API) and `app/apps/web/src/app/api/` (web API). The harness (`smart_contracts/tasks/payload.ts`, `flows.ts`) implements the same envelope, CID profile and three results.

### Payload envelope (`idpp-passport/1`)

```json
{ "schema": "idpp-passport/1", "deploymentId": "<generation id>",
  "tokenId": "97000000000006", "revision": "2", "previousCid": "bafkrei…",
  "kind": "cask", "granularity": "item", "data": { } }
```

- Every object is strict: an unknown key is rejected. `deploymentId` is the generation id of the manifest.
- `tokenId`, `revision`: decimal integer strings without leading zeros. `previousCid`: `null` at revision 0 and required after it, the CID of the preceding revision, itself a profile CID.
- `kind`: `cask | bottle`. `granularity`: `item | batch`; a batch has `data.quantity` (decimal string) and `data.unit`, an item has neither. There is no `model` granularity.
- `data` for `cask`: `distillery`, `caskType`, `caskNumber`, `volumeLiters`, `alcoholByVolume`, `fillDate`, optional `origin { country, region }` and `description`. For `bottle`: `brand`, `bottleType`, `bottledDate`, `volumeMl`, `alcoholByVolume`, optional `sourceCasks [{ tokenId, revision, volumeMl }]` and `description`. Quantities are decimal strings; dates are ISO-8601 date strings. Dates and `sourceCasks` are issuer assertions, not chain evidence.
- No `chainId` or timestamp fields: both come from the indexed event.

### Canonical bytes and CID profile

- Canonicalization: RFC 8785 JSON Canonicalization Scheme (sorted keys, no whitespace, UTF-8). All scalars in the envelope are strings or null, so no number formatting arises.
- Size limit: canonical bytes ≤ 65,536 (64 KiB, `MAX_PAYLOAD_BYTES`). Larger payloads are rejected.
- CID: version 1, codec `raw` (0x55), multihash `sha2-256` (0x12, 32 bytes), base32 lower, so every CID starts with `bafkrei`. It is computed over the canonical bytes exactly as uploaded, and a CID string is accepted only in that canonical form.
- Library versions are pinned in `app/packages/passport-config/package.json` (`canonicalize`, `multiformats`, `@noble/hashes`, `zod`; the Pinata SDK `pinata` as a development dependency, and at the same version in `app/apps/web`). A mismatch between a predicted and a returned or recomputed CID is a hard failure; a different CID is never adopted.

**Shared test vector** (every package that hashes tests it; its `deploymentId` is the generation of the time and stays fixed):

- Envelope: `{"schema":"idpp-passport/1","deploymentId":"whisky-v2-final","tokenId":"97000000000000","revision":"0","previousCid":null,"kind":"cask","granularity":"item","data":{"distillery":"Demo Distillery","caskType":"Bourbon barrel","caskNumber":"1","volumeLiters":"200","alcoholByVolume":"63.5","fillDate":"2026-10-01"}}`
- Canonical bytes (312 bytes): `{"data":{"alcoholByVolume":"63.5","caskNumber":"1","caskType":"Bourbon barrel","distillery":"Demo Distillery","fillDate":"2026-10-01","volumeLiters":"200"},"deploymentId":"whisky-v2-final","granularity":"item","kind":"cask","previousCid":null,"revision":"0","schema":"idpp-passport/1","tokenId":"97000000000000"}`
- sha2-256: `2da18698cf972e03ca36702052154c30face10dc28b4d66110a23b90e03bc33b`
- CID: `bafkreibnugdjrt4xfyb4untqebjbktbq7lhbbxbiwtlgcefchoioao6dhm`

### Verification results

Four results per revision, always reported separately, and one per passport:

| Result | Meaning |
| --- | --- |
| `content` | Downloaded raw bytes hash to the requested profile CID, checked before parsing. This is independent of chain availability. |
| `binding` | The envelope names the configured deployment, displayed token and revision. Only an otherwise verified binding becomes `unconfirmed` when the live read failed/was not made, or the revision is above the live tip. Failed and unavailable results remain so. |
| `history` | Internal consistency: contiguous revisions from 0, one token/deployment, and each previous CID names the preceding reference. It does not establish that the references were recorded. |
| recorded on chain | One receipt on the indexed row’s emitting chain must succeed and contain a log from that generation’s contract for the displayed merged CID. Revision 0 matches `PassportIssued` token/CID and compares the row’s author with the transaction sender; later revisions match `PassportRevised` token/revision/CID/author. Missing metadata, missing receipt or an RPC failure is unavailable; a reverted receipt or missing matching event fails. Times remain indexer-sourced. |
| `history hash` (per passport) | CIDs from 0 through the live revision recompute the live commitment. Indexed revisions above that tip are excluded. A missing predecessor makes it unavailable, a mismatched sequence fails, and no live read makes it unavailable. |

The web statuses are `verified`, `failed`, `unavailable` and `unconfirmed`; the harness retains verified/failed/skipped. Assurance is live, indexer-only, or live-tip-older, with the same value on each affected entry. A failed refetch discards retained query-cache data as a live reference. Content, history and receipts remain independently evaluated when binding is unconfirmed.

Predeclared reader banners (DS10): “Indexer only: the live read failed. No binding below is confirmed on chain.”; “Indexer only: the token is in flight; no chain holds it to read. No binding below is confirmed on chain.”; “Indexer only: the indexer is incomplete and names no chain to read. No binding below is confirmed on chain.”; “The chain holds revision M; the indexer lists revision N. Revisions above M are not confirmed on chain.”

The reader’s source interface adds receipt reads returning success/reverted status, transaction sender and raw address/topics/data logs. Verification cache keys include transaction hash, emitting chain and author as well as revision/CID/live state. Payload and receipt reads run concurrently. Fixture A’s production query boundary makes one summary call, one logical live call (two RPC requests: block number plus multicall), two payload calls and two receipt calls, one per revision. Mock mode makes zero HTTP requests; DS12 measures the indexer-backed HTTP count separately.

### Indexer summary API

Served by the Ponder indexer. Token ids are decimal strings. Per-chain progress reads Ponder’s status endpoint from `INDEXER_STATUS_URL`, or loopback with the actual local TCP listening port (configured fallback `PORT ?? 42069`); incoming request URLs and Host headers never select that endpoint. Ponder’s automatic occupied-port fallback is handled using Node’s local socket port; this is independent of request headers. Results share a three-second cache. Keep `PORT` aligned with the listening port or configure the URL explicitly.

| Route | Answer |
| --- | --- |
| `GET /api/status` | Presentation snapshot: `{ deploymentId, chains: [{ chainId, indexedBlock, latestBlock, toleranceBlocks, caughtUp }] }`; block fields are decimal strings or null. Every manifest chain is included; missing progress and zero checkpoints are not caught up. Uses the summary lag policy; no writes. |
| `GET /api/passports?chainId=&status=&limit=&cursor=` | `{ items: PassportSummary[], nextCursor: string \| null }` in ascending token-id order; `chainId` keeps tokens present on that chain; `status` is `held`, `in_flight` or `incomplete`; `limit` defaults to 20 and is capped at 100; `cursor` is the last token id of the previous page; 400 `{ error }` on a bad parameter |
| `GET /api/passports/:tokenId` | one `PassportSummary`; 400 `{ error }` for a non-decimal id, 404 `{ error: "unknown token" }` |
| `/graphql` (also `/`) | Ponder's GraphQL over the per-chain tables |

```ts
type PassportSummary = {
  deploymentId: string; tokenId: string; originChainId: number;
  currentChainId: number | null; status: 'held' | 'in_flight' | 'incomplete';
  owner: string | null; revision: string | null; cid: string | null;
  progress: { chainId: number; indexedBlock: string; latestBlock: string }[];
  revisions: { revision: string; cid: string; chainId: number; author: string; txHash: string; timestamp: string; conflict: boolean }[];
  timeline: TimelineEntry[];
}
```

Each timeline entry is discriminated by `kind` (`issued`, `revised`, `transferred`, `sent`, `received`) and has `chainId`, `txHash`, `blockNumber`, `timestamp`, `logIndex`; `issued` and `revised` add `revision`, `cid`, `author`; `transferred` adds `from`, `to`; `sent` adds `guid`, `from`, `dstEid`; `received` adds `guid`, `to`, `srcEid`.

**Status rules** (derived at query time from per-chain rows; the summary is identical whichever side of a transfer was indexed first):

- `held`: exactly one chain holds the token and none of the `incomplete` conditions applies.
- `in_flight`: no chain holds it and the newest send has no matching receive (same `guid`).
- `incomplete` otherwise: two chains claim the token, any revision has conflicting CIDs, a configured chain has no progress or lags more than the tolerance, or nothing holds the token and no send is outstanding.
- `currentChainId`, `owner`, `revision` and `cid` are non-null only when the status is `held`.
- `conflict` is not stored: it is computed per revision from the distinct CIDs claimed by the issue and revise records and the `PassportImported` observations.
- Lag tolerance: 8 seconds of blocks per chain (Arbitrum Sepolia 32 blocks, Base Sepolia 40, Sepolia 1; an unknown chain 1). For up to eight seconds after a send the source chain can still be reported `held`; the passport page's live read flags that.

The read-only live indexer suite compares API results with chain reads. It accepts absence only when `ownerOf` returns a decoded `ERC721NonexistentToken` for that requested token id. RPC failures, unrelated reverts and failures of `passportOf` after a successful owner read fail the check; they never establish absence.

### Passport labels

The printed QR URL is `<NEXT_PUBLIC_BASE_URL or browser origin>/passport/<decimal tokenId>?deployment=<deploymentId>`. The configured base must be an absolute HTTP(S) origin. Scanning preserves the deployment query; a mismatched generation displays a warning because ids restart on redeployment. Plain ids and older URLs without a deployment remain accepted, with no generation assurance. The label URL never contains a key or ownership proof.

### Ownership proof

Two client pages implement ownership proof: `/passport/<tokenId>/verify-owner` creates a verifier record after locating the token using live reads on every manifest chain; `/prove` scans that challenge and signs after switching the wallet to its chain. A held token is located even if another chain cannot be read. Without a held token, any failed probe is an error; an issuing chain outside the manifest or an id at/above that chain’s next-token counter is unknown, and only an issued id absent on all successfully read chains is in transit.

```ts
type ChallengeRecord = {
  tokenId: string; chainId: number; contract: Address; nonce: Hex; expiresAt: string;
};
// JSON QR shapes, decimal-string token/expiry and a random bytes32 nonce:
// { kind: "idpp-ownership-challenge", v: 1, ...record }
// { kind: "idpp-ownership-proof", v: 1, ...record, holder: Address, signature: Hex }
// EIP-712 domain: { name: "IDPP ownership", version: "1", chainId, verifyingContract: contract }
// Ownership(uint256 tokenId,address holder,bytes32 challenge,uint64 expiresAt)
```

The verifier keeps its own random challenge for 120 seconds; scanned data never selects its chain or contract. After scanning the proof it reads the owner again with an uncached latest-state request, samples the verifier clock after that read, recovers the signer, and requires exact token/domain/nonce/expiry plus holder=signer=live owner. A successful proof consumes its nonce in page memory, including concurrent-scan races. Malformed proofs, RPC errors and reused nonces fail; errors never become in-transit. Result codes are wrong_signer,holder_not_signer,expired,foreign_nonce,wrong_token,wrong_chain,wrong_contract,wrong_expiry,owner_mismatch,invalid_proof,already_used,chain_unavailable. Times are Unix seconds; QR JSON is strict. This costs no gas and uses no server. A relayed proof can pass: it shows the owning key signed this challenge at the observed state, not that the presenter holds the key or that the physical product is genuine. Contract wallets remain unsupported.

### Web API

Presentation-only `GET /api/readiness?address=<optional wallet>` returns `{ publicationConfigured, allowlisted }` with no-store caching. It validates existing server configuration without external calls; `allowlisted` is null without a valid wallet or available configuration. It returns no secrets, allowlist contents or validation errors. Configuration does not prove upload access, on-chain authorization, balances or delivery.

Errors are `{ error: { code, message } }` with the HTTP status given. Signatures are EIP-191 over the challenge message from an externally owned account; contract wallets (ERC-1271) are not supported. Challenges are single use and live five minutes.

- `GET /api/mint/challenge?address=0x…` → `{ nonce, message }`, `message = "IDPP mint challenge: <nonce>"`. Only an address in `ISSUER_ALLOWLIST` gets one (else 403 `not_allowlisted`); a newer mint challenge replaces the older one.
- `POST /api/mint { chainId, to, envelopeData: { kind, granularity, data }, address, signature }` → `{ tokenId, cid, txHash }`. Checked in this order: the request shape, `address` in `ISSUER_ALLOWLIST`, `chainId` a chain of the deployment, the envelope data, then the signature (consuming the challenge). The server then reads `nextTokenId()` on `chainId`, builds the revision-0 envelope with that id, pins and verifies it, and calls `mint(to, expectedTokenId, cid)` with the operator key, an issuer; if another mint took the id (`UnexpectedTokenId`), it repeats once with a fresh id. Revision 0 is created only here.
- `GET /api/pin/challenge?address=0x…` → `{ nonce, message }`, `message = "IDPP pin challenge: <nonce>"`. Open to any address; its own store, so a mint signature is not a pin signature; an address may hold up to four unused pin challenges.
- `POST /api/pin { envelope, address, signature }` → `{ cid }` after prediction, upload, assertion and read-back comparison; used by the revise flow, after which the issuer signs `revise(tokenId, expectedRevision, cid)` in the browser. Checked in this order: the rate limit, the request shape, `envelope.deploymentId` equal to the manifest's, the envelope, revision ≥ 1, the signature (the nonce is consumed only once it verifies), then the token on every chain of the deployment: `address` must be an issuer (`isIssuer`) on the chain that holds the token (holding it is not enough), `envelope.revision == passportOf.revision + 1` and `envelope.previousCid == passportOf.cid`.
- Before pinning a bottle in either authenticated POST route, each declared source cask is located on all manifest chains. Any failed probe is chain unavailable, even if another chain holds it. A source must be held uniquely, name an existing revision whose kind is cask, and request no more than that revision’s volume in millilitres (exact decimal comparison). The cask may be held away from its issuing chain. Its complete tip-to-zero payload history passes CID/content/schema/binding checks and recomputes the live history hash, so a linked but unrecorded decoy is refused. The existing passport read also returns the hash; no extra RPC is added. Tip revisions above 20 are refused (at most 21 payloads per unique source); duplicate source ids share one walk. Gateway retrieval is streamed at 64 KiB with a 20-second per-fetch timeout and one 60-second validation deadline per request. A gateway timeout or oversize body never accepts an unchecked source. These are per-reference checks, not volume conservation across bottles.
- Both pin routes are rate-limited per client IP (default 20 requests per minute, `PIN_RATE_LIMIT_PER_MINUTE`; 429 `rate_limited` with `Retry-After`). The mint routes are not.

| Code | Status | Raised by |
| --- | --- | --- |
| `invalid_request` | 400 (413 for a body over 256 KiB) | every route: bad address, request shape, `/api/pin` revision 0 |
| `rate_limited` | 429 | both pin routes |
| `not_allowlisted` | 403 | both mint routes |
| `no_challenge`, `bad_signature` | 401 | `POST /api/mint`, `POST /api/pin` |
| `unsupported_chain` | 400 | `POST /api/mint` |
| `wrong_deployment` | 400 | `POST /api/pin` |
| `invalid_envelope` | 400 | both POST routes |
| `payload_too_large` | 413 | both POST routes |
| `not_issuer` | 403 | `POST /api/pin` |
| `stale_base`, `token_ambiguous` | 409 | `POST /api/pin` |
| `token_not_found` | 404 | `POST /api/pin` |
| `token_id_conflict` | 409 | `POST /api/mint` (the repeat also lost) |
| `pin_upload_failed`, `pin_cid_mismatch`, `pin_readback_failed`, `pin_readback_mismatch` | 502 | both POST routes |
| `source_cask_missing`, `source_cask_revision`, `source_cask_not_cask`, `source_cask_overdraw` | 422 | both POST routes, after authentication and before pinning; messages name the source id and failing rule |
| `source_cask_unavailable`, `chain_unavailable` | 503 | source-cask retrieval/read validation in both POST routes |
| `mint_failed`, `chain_unavailable` | 502 | existing mint chain failures; `chain_unavailable` also existing pin authorization reads |
| `server_misconfigured`, `internal_error` | 500 | any route that needs the server environment; an unexpected error |

## Requirements and local tests

The thesis states the requirements R1 to R18, maps R1 to R17 to evidence and treats R18 as a design trade-off. The table lists the local Foundry tests in [`WhiskyDistillery.t.sol`](../smart_contracts/test/foundry/WhiskyDistillery.t.sol) that exercise a requirement directly; the others rest on the evaluation datasets or on the design, not on a named unit test. It is not a verdict table.

| Requirement | Named local tests |
| --- | --- |
| R1 | `test_P1_idsAreSequentialInTheChainNamespace`, `testFuzz_P1_namespacesAreDisjoint` |
| R3 | `test_P8_historyHashCommitsToEveryRevisionInOrder` |
| R6 | `test_P3_onlyIssuersMint`, `test_P3_onlyIssuersRevise` |
| R7 | `test_P3_onlyOwnerSetsIssuers`, `test_P3_approvedOperatorTransfersAndTheFormerHolderLosesAllRights` |
| R11 | `test_onftVersionReportsTheOwnMessageFormat` |
| R12 | `test_P5_destinationResolvesTheCarriedPassport`, `test_P8_historyHashTravelsAndRevisionsOnAnyChainExtendIt` |
| R13 | `test_P2_tokenExistsOnExactlyOneChainOrIsInFlight` |
| R14 | `test_P6_failedDeliveryStaysStoredAndCanBeRetried`, `test_S4_importOfAnExistingIdFailsClosedAndTheMessageStaysStored` |
| R15 | `test_P7_mintRejectsUnexpectedTokenId`, `test_P7_reviseRejectsStaleRevision`, `test_P7_concurrentRevisionsOneSucceedsOneReverts` |
| R16 | `test_Gas_firstArrivalMaxCidRevised` |
