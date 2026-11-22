import { defineConfig } from "vitest/config";

// `pnpm test` runs unit and mocked tests only. `pnpm test:int` (VITEST_INT=1) runs the live
// `*.int.test.ts` files, which need PINATA_JWT and network access.
const integration = process.env.VITEST_INT === "1";

export default defineConfig({
  test: {
    coverage: {
      reporter: ["text", "json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["**/*.test.{ts,tsx}", "**/*.d.ts", "src/generated/**"],
    },
    testTimeout: 60_000,
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          include: integration ? ["test/**/*.int.test.ts"] : ["test/**/*.test.ts"],
          exclude: integration ? [] : ["test/**/*.int.test.ts", "test/browser/**"],
        },
      },
      // Resolves dependencies with the `browser` export condition, as a browser bundle does.
      // The deps are inlined so Vite (not Node) resolves their export maps. Not part of the
      // live integration run.
      ...(integration
        ? []
        : [
            {
              extends: true as const,
              resolve: { conditions: ["browser"] },
              ssr: { resolve: { conditions: ["browser"], externalConditions: ["browser"] } },
              test: {
                name: "browser-conditions",
                include: ["test/browser/**/*.test.ts"],
                server: { deps: { inline: [/multiformats/, /@noble\/hashes/] } },
              },
            },
          ]),
    ],
  },
});
