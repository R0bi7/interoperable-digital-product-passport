import { defineConfig } from "vitest/config";

/** Live suite: reads a running indexer and the chains. Not part of `pnpm test`. */
export default defineConfig({
  test: {
    include: ["tests-live/**/*.live.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
