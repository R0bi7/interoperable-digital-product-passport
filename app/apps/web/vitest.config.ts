import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws outside React Server Components; tests import server modules directly.
      "server-only": fileURLToPath(new URL("./src/lib/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    coverage: {
      reporter: ["text", "json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["**/*.test.{ts,tsx}", "**/*.d.ts", "src/generated/**"],
    },
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "e2e-live/**/*.test.ts"],
  },
});
