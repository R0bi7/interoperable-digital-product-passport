import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts", "manifest-config.ts"],
      exclude: ["**/*.test.{ts,tsx}", "**/*.d.ts", "src/generated/**"],
    },
    include: ["tests/**/*.test.ts"],
  },
});
