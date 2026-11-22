import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { MUTANTS, applyMutant } from '../tasks/mutation-lib'
import { RunVerdict, classify, onlyArgument, selectMutants } from '../tasks/mutation-run'

// Runs the Foundry suite once per mutant (tasks/mutation-lib.ts) and reports which are killed.
//   pnpm test:mutation [--only M05,M21] [--allow-survivors] [--write]
//
// The mutants are applied in a temporary copy of the project (contracts, tests, fixtures, foundry.toml, and a symlink
// to node_modules), never in the working tree, so no way of stopping the script can leave a mutant in the sources and
// two runs cannot disturb each other. The suite runs with a fixed fuzz seed and a timeout. A mutant counts as killed
// only if forge ran and a test failed; a crash, a timeout or unreadable output is reported as an error, not as a kill.
// `--write` stores the result, with the tests that failed, in e2e_reports/mutation.json.

const TIMEOUT_MS = 10 * 60 * 1000
const root = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
const only = onlyArgument(args)
const allowSurvivors = args.includes('--allow-survivors')
const write = args.includes('--write')

const forge = (cwd: string, forgeArgs: string[]) => {
    const r = spawnSync('forge', forgeArgs, {
        cwd,
        encoding: 'utf8',
        timeout: TIMEOUT_MS,
        maxBuffer: 256 * 1024 * 1024,
    })
    return { stdout: r.stdout ?? '', exitCode: r.signal != null || r.error != null ? null : r.status }
}
const suite = (cwd: string): RunVerdict => {
    const r = forge(cwd, ['test', '--json', '--fuzz-seed', '1'])
    return classify(r.stdout, r.exitCode)
}
const compiles = (cwd: string) => forge(cwd, ['build']).exitCode === 0

const mutants = selectMutants(MUTANTS, only)
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'idpp-mutation-'))
try {
    // `fixtures` exists once the storage baseline (DS5) is merged; the suite reads it.
    for (const entry of ['contracts', 'test', 'fixtures', 'foundry.toml'].filter((e) =>
        fs.existsSync(path.join(root, e))
    )) {
        fs.cpSync(path.join(root, entry), path.join(work, entry), { recursive: true })
    }
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(work, 'node_modules'))

    const baseline = suite(work)
    if (baseline.kind !== 'survived') {
        throw new Error(`the unmutated suite does not pass (${baseline.kind}): fix it before looking at mutants`)
    }

    type Result = {
        id: string
        status: 'killed' | 'survived' | 'invalid' | 'error'
        breaks: string
        failed: string[]
        detail?: string
    }
    const results: Result[] = []
    for (const m of mutants) {
        const target = path.join(work, m.file)
        const original = fs.readFileSync(path.join(root, m.file), 'utf8')
        fs.writeFileSync(target, applyMutant(original, m))
        let result: Result
        if (!compiles(work)) {
            result = { id: m.id, status: 'invalid', breaks: m.breaks, failed: [] }
        } else {
            const verdict = suite(work)
            result =
                verdict.kind === 'killed'
                    ? { id: m.id, status: 'killed', breaks: m.breaks, failed: verdict.failed.map((f) => f.test) }
                    : verdict.kind === 'survived'
                      ? { id: m.id, status: 'survived', breaks: m.breaks, failed: [] }
                      : { id: m.id, status: 'error', breaks: m.breaks, failed: [], detail: verdict.detail }
        }
        fs.writeFileSync(target, original)
        results.push(result)
        const by = result.failed.length > 0 ? ` (first failing test: ${result.failed[0]})` : ''
        console.log(
            `${m.id} ${result.status.toUpperCase().padEnd(8)} ${m.breaks}${by}${result.detail ? ` [${result.detail}]` : ''}`
        )
    }

    const count = (status: Result['status']) => results.filter((r) => r.status === status)
    console.log(`\n${count('killed').length} of ${results.length} mutants killed.`)
    for (const [status, text] of [
        ['invalid', 'Do not compile (fix the mutant)'],
        ['error', 'forge gave no usable result'],
    ] as const) {
        if (count(status).length > 0) {
            console.log(
                `${text}: ${count(status)
                    .map((r) => r.id)
                    .join(', ')}`
            )
            process.exitCode = 1
        }
    }
    if (count('survived').length > 0) {
        console.log(
            `Survivors (a hole in the tests or an equivalent mutant; judge each): ${count('survived')
                .map((r) => r.id)
                .join(', ')}`
        )
        if (!allowSurvivors) process.exitCode = 1
    }
    if (write) {
        const out = path.join(root, 'e2e_reports', 'mutation.json')
        fs.writeFileSync(out, JSON.stringify({ fuzzSeed: 1, mutants: results }, null, 2) + '\n')
        console.log(`Wrote ${out}`)
    }
} finally {
    fs.rmSync(work, { recursive: true, force: true })
}
