import "server-only";

/**
 * In-memory fixed-window rate limiter, one counter per key (the client IP).
 *
 * Scope and limits, deliberately simple: the state lives in the memory of one server process, so
 * it resets on restart and is not shared between instances (serverless or several replicas). It
 * slows down accidental or casual abuse of an unauthenticated endpoint; it is not authentication.
 */

export type RateLimiter = {
  /** Counts one request for `key`. `retryAfterSeconds` is set when the request is over the limit. */
  hit(key: string): { ok: true } | { ok: false; retryAfterSeconds: number };
};

type Options = {
  limit: number;
  windowMs: number;
  now?: () => number;
  /** Upper bound on tracked keys; expired windows are dropped first, then the oldest keys. */
  maxKeys?: number;
};

export function createRateLimiter({
  limit,
  windowMs,
  now = Date.now,
  maxKeys = 10_000,
}: Options): RateLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>();

  function makeRoom(time: number) {
    for (const [key, window] of windows) if (window.resetAt <= time) windows.delete(key);
    // Still full of live windows (many distinct clients): drop the oldest-inserted ones.
    for (const key of windows.keys()) {
      if (windows.size < maxKeys) break;
      windows.delete(key);
    }
  }

  return {
    hit(key) {
      const time = now();
      let window = windows.get(key);
      if (!window || window.resetAt <= time) {
        if (!window && windows.size >= maxKeys) makeRoom(time);
        window = { count: 0, resetAt: time + windowMs };
        windows.set(key, window);
      }
      window.count++;
      if (window.count <= limit) return { ok: true };
      return {
        ok: false,
        retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - time) / 1000)),
      };
    },
  };
}

/** A positive integer from an environment value; anything else (unset, empty, invalid) is `fallback`. */
export function positiveIntFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || !/^[1-9][0-9]*$/.test(value.trim())) return fallback;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

/**
 * Client address for rate limiting: the first `X-Forwarded-For` entry, else `X-Real-IP`, else a
 * shared `unknown` bucket. These headers are set by the hosting proxy; without a trusted proxy in
 * front, a caller can forge them and evade the limit, which is why this is a mitigation only.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}
