import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

// Runs one dataset of docs/evaluation/PROTOCOL.md with its fixed command, behind the checks that must hold between
// runs, so that the operator only has to read the console and the report.
//   pnpm eval:run <DS1|DS2|DS3|DS4|DS5> [--window <label>] [--networks <subset, DS1 only>] [--plan]
//
// Gates, in order; the first that fails prints `RUN GATE <name> FAIL` and `RUN RESULT refused`, before anything is sent:
//   args      only the options above; `--networks` only for DS1 (to rerun one chain), in the fixed chain order
//   tree      the working tree is clean, so the run header records gitDirty: false (rule 7; a dirty run is excluded)
//   window    a non-empty label; DS2 has no default (w1, w2, ...), DS1 and DS3 default to `ds1` and `ds3`, DS5 takes none
//   forge     DS5 only: forge 1.8.5, with which the table must regenerate identically
//   scan      scripts/scan-health.sh, for every live dataset (live.sh repeats it only for e2e:latency and e2e:edge)
//   capacity  scripts/eval3-capacity.js: the dataset's pins fit in the Pinata Free plan's 500 files (PROTOCOL.md rule 10)
//   balance   every chain the dataset sends on holds at least MIN_BALANCE_ETH
//             DS4's task also checks twice its current-price and quote-based cost on Base before any broadcast
// The task then runs through scripts/live.sh (watchdog, archived log); its lines pass through unchanged. `--plan` runs
// the gates and prints the command without running it.
//
// Last lines, for the reader of the console:
//   RUN REPORT <file> status=<finished|interrupted|unreadable> gitDirty=<bool|n/a> [failed=<n>]   each JSON written
//   RUN OUTPUT <file>                                                                each other file it wrote
//   RUN RESULT <complete|failed|stopped|refused> exit=<code> reports=<n> [reason=...]
// `complete`: the task exited 0 and every report is readable, not interrupted, and (live datasets) has a header with
// gitDirty: false. `stopped`: the watchdog or an operator stopped the run; the reason is the watchdog's STOP line. A
// run that sent something is never `refused`. Whether the dataset meets its pass criterion (PROTOCOL.md) is judged on
// the report, not here.

type Dataset = {
    readonly task: string
    /** The dataset's command after the task name, without --window. */
    readonly args: readonly string[]
    readonly window?: string
    /** Pins of one run (DS1 60, DS2 3 per window, DS3 15); DS1 counts 20 per chain. */
    readonly pins: number
    readonly live: boolean
    readonly env?: Record<string, string>
}

const NETWORKS = ['sepolia', 'arbitrum-sepolia', 'base-sepolia'] as const
// Balance floor per chain. The largest cost estimate with margin (2026-10-19) was 0.0063 ETH for all of DS1 to DS3 on
// one chain, so one dataset with this floor cannot run dry.
const MIN_BALANCE_ETH = 0.01
const PIN_CAPACITY = 500
const FORGE_VERSION = '1.8.5'

// The command of each dataset (PROTOCOL.md, section 3). DS2 and DS3 send on every pair, so they always take the task's default of all three chains.
const DATASETS: Record<string, Dataset> = {
    DS1: {
        task: 'e2e:ops',
        args: ['--networks', NETWORKS.join(','), '--repeats', '10'],
        window: 'ds1',
        pins: 60,
        live: true,
    },
    DS2: { task: 'e2e:latency', args: ['--hops', '8', '--timeout', '1800'], pins: 3, live: true },
    DS3: { task: 'e2e:edge', args: ['--repeats', '1'], window: 'ds3', pins: 15, live: true },
    DS4: {
        task: 'e2e:scale',
        args: ['--mints', '20', '--sends', '10', '--timeout', '1800'],
        window: 'ds4',
        pins: 0,
        live: true,
        // A confirming hop may legitimately take 15 minutes; allow its 1,800 s deadline plus checkpoint time.
        env: { LIVE_WAIT_SECONDS: '2100' },
    },
    // forge runs silently for minutes; the watchdog's default idle limit of 300 s would stop it.
    DS5: { task: 'e2e:storage', args: [], pins: 0, live: false, env: { LIVE_IDLE_SECONDS: '1800' } },
}

const root = path.resolve(__dirname, '..')
const reportDir = path.join(root, 'e2e_reports')
const say = (line: string) => console.log(`RUN ${line}`)
let spawned = false

class Refused extends Error {
    constructor(
        readonly gate: string,
        message: string
    ) {
        super(message)
    }
}

function parseArgs(args: readonly string[]) {
    const [id, ...rest] = args
    const options: Record<string, string> = {}
    let plan = false
    for (let i = 0; i < rest.length; i++) {
        const name = rest[i]
        if (name === '--plan') plan = true
        else if (name === '--window' || name === '--networks') {
            const value = rest[++i]
            if (value === undefined || value.startsWith('--')) throw new Refused('args', `${name} needs a value`)
            options[name] = value
        } else throw new Refused('args', `unknown argument ${name}`)
    }
    const dataset = id === undefined ? undefined : DATASETS[id.toUpperCase()]
    if (dataset === undefined) throw new Refused('args', `first argument is one of ${Object.keys(DATASETS).join('|')}`)
    return { id: id.toUpperCase(), dataset, window: options['--window'], networks: options['--networks'], plan }
}

function networksFor(id: string, dataset: Dataset, requested: string | undefined): readonly string[] {
    if (id === 'DS4') {
        if (requested !== undefined) throw new Refused('args', '--networks is not used by DS4')
        return ['base-sepolia']
    }
    if (requested === undefined) return dataset.live ? NETWORKS : []
    if (id !== 'DS1') throw new Refused('args', `--networks is for DS1 only; ${id} needs every chain`)
    const list = requested.split(',').map((n) => n.trim())
    for (const n of list)
        if (!(NETWORKS as readonly string[]).includes(n)) throw new Refused('args', `unknown network ${n}`)
    // Keep the fixed chain order: e2e:ops measures the chains in the order given.
    return NETWORKS.filter((n) => list.includes(n))
}

function checkCapacity(networks: readonly string[], pins: number) {
    const r = spawnSync('node', ['scripts/eval3-capacity.js', String(pins)], {
        cwd: root,
        encoding: 'utf8',
        timeout: 120_000,
    })
    // The script prints one indented JSON object, starting on a line of its own, before it fails on capacity.
    const start = r.stdout.search(/^\{$/m)
    let status: { pins: number; balances: { network: string; balanceETH: string }[] }
    try {
        if (start < 0) throw new Error('no JSON in the output')
        status = JSON.parse(r.stdout.slice(start))
    } catch {
        throw new Refused('capacity', (r.stderr || r.stdout || 'no output').trim().split('\n').pop() ?? '')
    }
    const counts = `pins=${status.pins}+${pins}/${PIN_CAPACITY}`
    if (status.pins + pins > PIN_CAPACITY || r.status !== 0)
        throw new Refused('capacity', `${counts}; free Pinata capacity first`)
    say(`GATE capacity ${counts} ok`)
    for (const network of networks) {
        const balance = status.balances.find((b) => b.network === network)
        const line = `${network}=${balance?.balanceETH ?? 'unknown'} min=${MIN_BALANCE_ETH}`
        if (balance === undefined || !(Number(balance.balanceETH) >= MIN_BALANCE_ETH))
            throw new Refused('balance', line)
        say(`GATE balance ${line} ok`)
    }
}

function snapshot(): Map<string, number> {
    const files = new Map<string, number>()
    if (!fs.existsSync(reportDir)) return files
    for (const name of fs.readdirSync(reportDir))
        if (!name.endsWith('.log')) files.set(name, fs.statSync(path.join(reportDir, name)).mtimeMs)
    return files
}

/** Prints what the run wrote; returns the number of reports and whether all of them are clean. */
function readReports(before: Map<string, number>, live: boolean): { count: number; clean: boolean } {
    let count = 0
    let clean = true
    for (const [name, mtime] of snapshot()) {
        if (before.get(name) === mtime) continue
        if (!name.endsWith('.json')) {
            say(`OUTPUT e2e_reports/${name}`)
            continue
        }
        count++
        let report: { status?: string; header?: { gitDirty?: boolean }; summary?: { failed?: number } }
        try {
            report = JSON.parse(fs.readFileSync(path.join(reportDir, name), 'utf8'))
        } catch {
            // A task killed while writing its checkpoint leaves partial JSON.
            say(`REPORT e2e_reports/${name} status=unreadable gitDirty=n/a`)
            clean = false
            continue
        }
        // A report without a status ran to its end; its flows may still have failed (summary.failed, task exit 1).
        const status = report.status ?? 'finished'
        const dirty = report.header?.gitDirty
        const failed = report.summary?.failed
        say(
            `REPORT e2e_reports/${name} status=${status} gitDirty=${dirty ?? 'n/a'}` +
                (failed === undefined ? '' : ` failed=${failed}`)
        )
        if (status !== 'finished' || (live ? dirty !== false : dirty === true)) clean = false
    }
    return { count, clean }
}

async function main() {
    const { id, dataset, window: requestedWindow, networks: requested, plan } = parseArgs(process.argv.slice(2))
    const networks = networksFor(id, dataset, requested)
    say('GATE args ok')

    const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout.trim()
    if (dirty) throw new Refused('tree', 'commit or stash first; a dirty run is excluded (rule 7)')
    say('GATE tree ok')

    if (!dataset.live && requestedWindow !== undefined) throw new Refused('window', `${id} takes no window`)
    const window = (requestedWindow ?? dataset.window)?.trim()
    if (dataset.live && !window) throw new Refused('window', `${id} needs a non-empty --window (w1, w2, ...)`)
    if (window) say(`GATE window ${window} ok`)

    if (!dataset.live) {
        const forge = spawnSync('forge', ['--version'], { encoding: 'utf8' }).stdout?.split('\n')[0] ?? ''
        if (!forge.trim().endsWith(`Version: ${FORGE_VERSION}`))
            throw new Refused('forge', `need ${FORGE_VERSION}, have ${forge || 'none'}`)
        say(`GATE forge ${FORGE_VERSION} ok`)
    }

    if (dataset.live) {
        const health = spawnSync('bash', ['scripts/scan-health.sh'], { cwd: root, encoding: 'utf8', timeout: 90_000 })
        for (const line of (health.stdout + health.stderr).trim().split('\n')) if (line) console.log(line)
        if (health.status !== 0) throw new Refused('scan', 'scan-health.sh not healthy')
        say('GATE scan ok')
        const pins = id === 'DS1' ? (dataset.pins / NETWORKS.length) * networks.length : dataset.pins
        checkCapacity(networks, pins)
    }

    const args = id === 'DS1' ? ['--networks', networks.join(','), ...dataset.args.slice(2)] : [...dataset.args]
    const command = [dataset.task, ...args, ...(window ? ['--window', window] : [])]
    say(`START ${id} command=scripts/live.sh ${command.join(' ')}`)
    if (plan) {
        say('RESULT planned exit=0 reports=0')
        return
    }

    const before = snapshot()
    spawned = true
    const child = spawn('bash', ['scripts/live.sh', ...command], {
        cwd: root,
        env: { ...process.env, ...dataset.env },
        stdio: ['inherit', 'pipe', 'inherit'],
    })
    let stop: string | undefined
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
        console.log(line)
        const m = /^Watchdog STOP: (.*?);/.exec(line)
        if (m) stop = m[1]
    })
    // The watchdog forwards these to the task's process group, which writes a stopped report; wait for it.
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => child.kill('SIGINT'))
    const exit: number = await new Promise((resolve) =>
        child.on('close', (code, signal) => resolve(code ?? (signal ? 130 : 1)))
    )

    const reports = readReports(before, dataset.live)
    const result = exit === 130 ? 'stopped' : exit === 0 && reports.count > 0 && reports.clean ? 'complete' : 'failed'
    const reason = stop ?? (reports.count === 0 ? 'no report written' : !reports.clean ? 'report not clean' : undefined)
    say(`RESULT ${result} exit=${exit} reports=${reports.count}${reason ? ` reason=${reason}` : ''}`)
    process.exitCode = result === 'complete' ? 0 : exit || 1
}

main().catch((e: Error) => {
    if (!spawned) {
        say(`GATE ${e instanceof Refused ? e.gate : 'internal'} FAIL ${e.message}`)
        say('RESULT refused exit=2 reports=0')
        process.exitCode = 2
    } else {
        say(`RESULT failed exit=1 reports=? reason=${e.message}`)
        process.exitCode = 1
    }
})
