// Descriptive statistics for the latency runs (e2e:latency), reduced to what the report uses.

/** Intervals are computed only from this many observations (docs/evaluation/PROTOCOL.md, rule 5). Below it the raw
 * values are the result; a t or bootstrap interval of three values says nothing a reader should rely on. */
export const MIN_N_FOR_INTERVAL = 10

export type Summary = {
    readonly n: number
    readonly mean: number
    /** Sample standard deviation, n - 1 in the denominator; 0 if n < 2. */
    readonly sd: number
    readonly min: number
    readonly q1: number
    readonly median: number
    readonly q3: number
    readonly p95: number
    readonly max: number
    /** Two-sided 95% confidence interval of the mean (Student's t); null if n < MIN_N_FOR_INTERVAL. */
    readonly meanCi95: { readonly low: number; readonly high: number } | null
    /** Percentile-bootstrap 95% confidence interval of the median; null if n < MIN_N_FOR_INTERVAL. */
    readonly medianCi95: { readonly low: number; readonly high: number } | null
    /** Values outside the Tukey fences [Q1 - 1.5 IQR, Q3 + 1.5 IQR]. Reported, never removed. */
    readonly outliers: number
}

// Two-sided 97.5% quantile of Student's t for df 1..30.
const T_975 = [
    12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11,
    2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
]

export function tCritical975(df: number): number {
    if (!Number.isFinite(df) || df < 1) return Number.NaN
    if (df <= 30) return T_975[Math.floor(df) - 1]
    if (df <= 40) return 2.021
    if (df <= 60) return 2.0
    if (df <= 120) return 1.98
    return 1.96
}

/** Linear-interpolation quantile of data sorted ascending, q in [0, 1]. */
export function quantile(sorted: readonly number[], q: number): number {
    if (sorted.length === 0) throw new Error('quantile of an empty sample')
    const pos = (sorted.length - 1) * Math.min(1, Math.max(0, q))
    const lo = Math.floor(pos)
    const hi = Math.ceil(pos)
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

// Deterministic generator, so the same sample always gives the same bootstrap interval.
function mulberry32(seed: number): () => number {
    let a = seed >>> 0
    return () => {
        a += 0x6d2b79f5
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

export function medianBootstrapCi95(values: readonly number[], resamples = 2000, seed = 1) {
    const n = values.length
    if (n < MIN_N_FOR_INTERVAL) return null
    const random = mulberry32(seed)
    const medians: number[] = []
    for (let b = 0; b < resamples; b++) {
        const sample = Array.from({ length: n }, () => values[Math.floor(random() * n)]).sort((x, y) => x - y)
        medians.push(quantile(sample, 0.5))
    }
    medians.sort((x, y) => x - y)
    return { low: quantile(medians, 0.025), high: quantile(medians, 0.975) }
}

export function summarize(values: readonly number[]): Summary {
    if (values.length === 0) throw new Error('summary of an empty sample')
    const n = values.length
    const sorted = [...values].sort((a, b) => a - b)
    const mean = values.reduce((sum, v) => sum + v, 0) / n
    const sd = n < 2 ? 0 : Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1))
    const margin = n < MIN_N_FOR_INTERVAL ? 0 : tCritical975(n - 1) * (sd / Math.sqrt(n))
    const q1 = quantile(sorted, 0.25)
    const q3 = quantile(sorted, 0.75)
    const iqr = q3 - q1
    return {
        n,
        mean,
        sd,
        min: sorted[0],
        q1,
        median: quantile(sorted, 0.5),
        q3,
        p95: quantile(sorted, 0.95),
        max: sorted[n - 1],
        meanCi95: n < MIN_N_FOR_INTERVAL ? null : { low: mean - margin, high: mean + margin },
        medianCi95: medianBootstrapCi95(sorted),
        outliers: iqr > 0 ? values.filter((v) => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr).length : 0,
    }
}
