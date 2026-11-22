import { z } from "zod";

/**
 * Public variables are inlined into the browser bundle at build time, so each one is read with a
 * literal `process.env.NEXT_PUBLIC_…` expression. Defaults keep `next build` working without a
 * `.env`; WalletConnect falls back to injected wallets when no project id is set.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_PINATA_GATEWAY: z
    .string()
    .regex(/^[a-z0-9.-]+(:[0-9]+)?$/i, "expected a host name without scheme")
    .default("gateway.pinata.cloud"),
  // No default: unset or empty means "no indexer", which puts the read pages in mock mode (see
  // `indexerBaseUrl()` in `lib/indexer/client.ts`) and leaves the delivery panel without an indexer source.
  NEXT_PUBLIC_INDEXER_URL: z.url().optional(),
  NEXT_PUBLIC_BASE_URL: z
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        url.pathname === "/" &&
        !url.search &&
        !url.hash &&
        !url.username &&
        !url.password
      );
    }, "expected an absolute HTTP(S) origin without path, credentials, query or fragment")
    .optional(),
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: z.string().optional(),
});

/** Treats an empty string (`FOO=` in a `.env`) as unset. */
export const emptyToUndefined = (value: string | undefined) => (value === "" ? undefined : value);

export const publicEnv = publicEnvSchema.parse({
  NEXT_PUBLIC_PINATA_GATEWAY: emptyToUndefined(process.env.NEXT_PUBLIC_PINATA_GATEWAY),
  NEXT_PUBLIC_INDEXER_URL: emptyToUndefined(process.env.NEXT_PUBLIC_INDEXER_URL),
  NEXT_PUBLIC_BASE_URL: emptyToUndefined(process.env.NEXT_PUBLIC_BASE_URL),
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: emptyToUndefined(
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
  ),
});

export type PublicEnv = typeof publicEnv;

// Server-only variables live in `env.server.ts`, so their names and schemas stay out of the client bundle.
