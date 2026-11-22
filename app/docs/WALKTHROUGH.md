# Walkthrough transcript and recording notes

[Play the captioned video](../apps/web/public/demo/walkthrough.webm) · [Local player](http://localhost:3000/demo/walkthrough.webm) · [Local setup and test guide](../README.md)

Recorded 4 November 2026. Approximately 2 minutes 25 seconds, 1280 × 900, silent with on-screen captions. Scene times below are approximate navigation aids.

## What the recording shows

This is a guided replay of the completed live testnet rehearsal. Creation and transfer segments are saved screenshots from the successful rehearsal, explicitly labelled **Saved live rehearsal capture**. Reading, history/source-link navigation, label download/opening and the new gas-free ownership exchange were recorded from the running application. The holder window is shown as a labelled live capture while the verifier retains its original challenge. It is not an uninterrupted new mint/revise/send run.

No additional mint, revision or transfer was submitted during recording. The recorder disabled transaction/publication signing and publication endpoints. A local signing bridge kept the private key in the test process; the recording does not test a real wallet extension or physical camera. The scanner text fallback is used.

**This video is presentation documentation, not thesis evaluation evidence or a performance measurement.** No evaluation records or contract configuration were changed.

## Scene transcript

| Approximate start | Scene | Caption |
| --- | --- | --- |
| 00:00 | Follow the complete demonstration | Saved creation and transfer captures are labelled. Live navigation reuses the same passports. |
| 00:07 | 1. Start the indexer and web app | Check catch-up on all three chains, browser reads and publication setup. Configuration is not a completed rehearsal. |
| 00:15 | 2. Create a cask passport | Choose Cask / Item, enter the product data and recipient, then sign the one-time mint request. |
| 00:22 | The cask was minted on Arbitrum Sepolia | The server operator signed the mint. Cask …042 began at revision 0 with 200 liters. |
| 00:30 | 3. Revise through the issuer editor | Current editor, read-only replay: the correction is already recorded. A new revision would require both publication and a transaction. |
| 00:37 | 3. Correct the cask; preserve its history | The rehearsal revised 200 to 199.3 liters. The same token retains revisions 0 and 1, with separate checks. |
| 00:44 | Each revision remains inspectable | This is an issuer-declared correction. Verification checks the digital record, not the physical whisky. |
| 00:49 | 4. Mint a bottle linked to the cask | The bottle declares 700 ml from cask …042, revision 1. Source references are checked before publication. |
| 00:56 | The linked bottle was created | Bottle …043 records 700 ml at 46%. Minting does not deduct cask volume or enforce total allocation. |
| 01:02 | Follow the declared source relationship | The bottle links back to the actual cask and names the relevant revision. |
| 01:08 | The cask history is one click away | Earlier product declarations remain available after the bottle is created and transferred. |
| 01:12 | 5. Save the bottle label | The downloaded QR label identifies the deployment and token. It does not encode the current holding chain. |
| 01:19 | 6. Send the bottle to Base Sepolia | The holder chooses the receiver, reviews the messaging fee and signs the source-chain transaction. |
| 01:25 | Source confirmation is not destination arrival | The token is in flight after the source transaction. Keep the delivery page open; do not submit another send. |
| 01:31 | Arrival was confirmed on Base Sepolia | The destination owner and passport snapshot were read directly. The identifier, revision and content reference stayed the same. |
| 01:37 | 7. Open the SAME saved label | The text fallback accepts the QR label URL. Camera scanning uses that same address. |
| 01:40 | The existing label now resolves to Base Sepolia | Bottle …043 still has revision 0 and its source-cask relationship. The timeline links both transfer transactions. |
| 01:48 | 8. Create a fresh ownership challenge | The verifier keeps this tab open. The challenge binds this token, chain and contract, and expires after two minutes. |
| 01:55 | The holder signs in a second window | Live holder-window capture: a typed-data signature produces the response QR code and text. No transaction or gas. |
| 02:02 | The verifier checks a fresh live owner read | The owning key signed this unused challenge. This does not establish physical custody or authenticity. |
| 02:09 | A consumed response is rejected | Keep the verifier tab, use a fresh challenge for each demonstration, and use the text fallback if a camera is unavailable. |
| 02:14 | app/README.md | Presentation walkthrough only. Physical cameras and real wallet-extension prompts are outside this recording. |

## Rehearsal records

These are existing public testnet demonstration records, not inventory. They may change or become unavailable after recording. A new tester must use their own authorized accounts and actual new identifiers for writes.

| Record | Identifier / state shown |
| --- | --- |
| Cask | `421614000000000042`, Arbitrum Sepolia, revised from 200 to 199.3 liters at revision 1 |
| Bottle | `421614000000000043`, moved from Arbitrum Sepolia to Base Sepolia, revision 0 |
| Declared source | Cask `421614000000000042`, revision 1, 700 ml |
| Label | `/passport/421614000000000043?deployment=whisky-v2-eval3` |

The live rehearsal transaction links are included for context only:

- [Cask mint](https://sepolia.arbiscan.io/tx/0x54bebbee9adb5afa8502ce9f31cee4f0a8441a139d8feb7b181eb773dab0b308)
- [Cask revision](https://sepolia.arbiscan.io/tx/0xc55ed6f7bb068e28171d8c4edcaaec86a61b697fb4bee0638e166e581555b942)
- [Bottle mint](https://sepolia.arbiscan.io/tx/0xe4a9e4962ca767478af15fa75651ee17ce21f1f117a1f90345f9a6ef04ca9278)
- [Bottle send](https://sepolia.arbiscan.io/tx/0x8e936b2d94570eccadaf1b2e02b8566469c3fc32633cebebb774cdfdd158e140)
- [Bottle destination execution](https://sepolia.basescan.org/tx/0x7cf48f9839a2075953a5fa1cada4c0d3b3277bb693d31a6762bcc4f6f474d622)

## Scope reminders

The indexer must remain running for live discovery. Catch-up and configuration are snapshots; the readiness panel is not proof of upload credentials or messaging delivery. Digital-record verification does not establish physical authenticity, custody or the truth of issuer assertions. Ownership proof can be relayed and does not support contract wallets. The full prerequisites and troubleshooting steps are in the [app README](../README.md).
