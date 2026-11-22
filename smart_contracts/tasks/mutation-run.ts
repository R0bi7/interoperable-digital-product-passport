// Classification of one `forge test --json` run of a mutant (kept free of I/O so that it can be tested).

export type TestOutcome = { readonly test: string; readonly status: string; readonly reason: string | null }

export type RunVerdict =
    /** The suite ran and at least one test failed: the mutant is caught. */
    | { readonly kind: 'killed'; readonly failed: readonly TestOutcome[] }
    /** The suite ran and every test passed or was skipped. */
    | { readonly kind: 'survived' }
    /** forge did not produce a usable result (crash, timeout, unreadable output): says nothing about the tests. */
    | { readonly kind: 'error'; readonly detail: string }

type ForgeJson = Record<string, { test_results?: Record<string, { status?: string; reason?: string | null }> }>

/** `stdout` is what `forge test --json` printed; `exitCode` its exit status (null if it was killed or timed out). */
export function classify(stdout: string, exitCode: number | null): RunVerdict {
    if (exitCode === null) return { kind: 'error', detail: 'forge was killed or timed out' }
    let parsed: ForgeJson
    try {
        parsed = JSON.parse(stdout) as ForgeJson
    } catch {
        return { kind: 'error', detail: `forge printed no JSON (exit ${exitCode})` }
    }
    const outcomes: TestOutcome[] = []
    for (const [suite, result] of Object.entries(parsed)) {
        for (const [test, r] of Object.entries(result.test_results ?? {})) {
            outcomes.push({
                test: `${suite.split(':').pop()}.${test}`,
                status: r.status ?? 'Unknown',
                reason: r.reason ?? null,
            })
        }
    }
    if (outcomes.length === 0) return { kind: 'error', detail: `forge reported no tests (exit ${exitCode})` }
    const failed = outcomes.filter((o) => o.status === 'Failure')
    if (failed.length > 0) return { kind: 'killed', failed }
    if (exitCode !== 0) return { kind: 'error', detail: `forge exited ${exitCode} although no test failed` }
    return { kind: 'survived' }
}

/**
 * The value of `--only`: undefined when the flag is absent, a string when it is given (`--only A,B` or `--only=A,B`),
 * and the empty string when it is given without a value, which `selectMutants` then rejects instead of running all.
 */
export function onlyArgument(args: readonly string[]): string | undefined {
    const index = args.findIndex((a) => a === '--only' || a.startsWith('--only='))
    if (index < 0) return undefined
    if (args[index].includes('=')) return args[index].slice('--only='.length)
    const next = args[index + 1]
    return next === undefined || next.startsWith('--') ? '' : next
}

/** Mutant ids named by `--only`; throws on an empty list or an id that does not exist. */
export function selectMutants<T extends { readonly id: string }>(all: readonly T[], only: string | undefined): T[] {
    if (only === undefined) return [...all]
    const ids = only
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    if (ids.length === 0) throw new Error('--only needs a comma-separated list of mutant ids')
    const unknown = ids.filter((id) => !all.some((m) => m.id === id))
    if (unknown.length > 0) throw new Error(`unknown mutant ids: ${unknown.join(', ')}`)
    return all.filter((m) => ids.includes(m.id))
}
