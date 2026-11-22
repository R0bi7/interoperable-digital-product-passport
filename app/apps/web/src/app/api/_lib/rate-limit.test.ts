import { describe, expect, it } from "vitest";
import { clientIp, createRateLimiter, positiveIntFromEnv } from "./rate-limit";

describe("createRateLimiter", () => {
  it("allows `limit` hits per window and then reports the seconds to wait", () => {
    let time = 1_000;
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, now: () => time });
    expect(limiter.hit("a")).toEqual({ ok: true });
    expect(limiter.hit("a")).toEqual({ ok: true });
    time += 10_500;
    expect(limiter.hit("a")).toEqual({ ok: false, retryAfterSeconds: 50 });
    expect(limiter.hit("b")).toEqual({ ok: true });
  });

  it("starts a new window after windowMs", () => {
    let time = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, now: () => time });
    expect(limiter.hit("a").ok).toBe(true);
    expect(limiter.hit("a").ok).toBe(false);
    time = 1_000;
    expect(limiter.hit("a").ok).toBe(true);
  });

  it("keeps the number of tracked keys bounded", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => 0, maxKeys: 3 });
    for (const key of ["a", "b", "c", "d"]) limiter.hit(key);
    // "a" was evicted to make room for "d", so it starts a fresh window; "d" is still limited.
    expect(limiter.hit("d").ok).toBe(false);
    expect(limiter.hit("a").ok).toBe(true);
  });
});

describe("positiveIntFromEnv", () => {
  it("parses positive integers and falls back otherwise", () => {
    expect(positiveIntFromEnv("5", 20)).toBe(5);
    expect(positiveIntFromEnv(" 7 ", 20)).toBe(7);
    for (const bad of [undefined, "", "0", "-1", "1.5", "abc", "99999999999999999999"]) {
      expect(positiveIntFromEnv(bad, 20)).toBe(20);
    }
  });
});

describe("clientIp", () => {
  const req = (headers: Record<string, string>) => new Request("http://x", { headers });

  it("prefers the first X-Forwarded-For entry, then X-Real-IP, then a shared bucket", () => {
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4, 5.6.7.8", "x-real-ip": "9.9.9.9" }))).toBe(
      "1.2.3.4",
    );
    expect(clientIp(req({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(clientIp(req({}))).toBe("unknown");
  });
});
