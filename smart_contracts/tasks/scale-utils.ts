/** Limits receipt sealing and metadata reads without delaying first receipt observation. */
export function limitConcurrency(max: number) {
    let active = 0
    const queue: (() => void)[] = []
    return async <T>(work: () => Promise<T>): Promise<T> => {
        if (active >= max) await new Promise<void>((resolve) => queue.push(resolve))
        active++
        try {
            return await work()
        } finally {
            active--
            queue.shift()?.()
        }
    }
}

export function assertNonceState(state: { latest: number; pending: number }) {
    if (state.latest !== state.pending)
        throw new Error(
            `source account has an existing pending nonce (latest ${state.latest}, pending ${state.pending}); DS4 did not start`
        )
}

/** Task-authored preflight errors are useful; RPC messages may include secret URLs. */
export const scaleError = (error: unknown) => {
    const message = error instanceof Error ? error.message : ''
    return /^(Base balance below|destination already holds|send fee for|source account has an existing pending nonce|send nonce |DS4 expected)/.test(
        message
    )
        ? message
        : ((error as { code?: string }).code ?? 'error')
}
