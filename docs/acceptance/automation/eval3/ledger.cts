// Appends token ids of the runs in this folder to the fixture ledger (PROTOCOL.md rule 8) through the harness's `appendLedger`, so the
// rows have the same format and de-duplication as the tasks' rows. Input: a JSON file of
// [{ tokenId, network, purpose, runId }] for whisky-v2-eval3.
//   cd smart_contracts && npx ts-node --transpile-only --project tsconfig.json ../docs/acceptance/automation/eval3/ledger.cts rows.json
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { appendLedger } from '../../../../smart_contracts/tasks/fixtures'

const rows = JSON.parse(readFileSync(process.argv[2], 'utf8')) as { tokenId: string; network: string; purpose: string; runId: string }[]
appendLedger(
    resolve(__dirname, '../../../../smart_contracts'),
    rows.map((r) => ({ ...r, deploymentId: 'whisky-v2-eval3' }))
)
console.log(`ledger: ${rows.length} rows offered`)
