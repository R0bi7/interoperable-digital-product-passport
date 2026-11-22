import "server-only";
import { getChain } from "@idpp/passport-config";
import { isAddress, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { emptyToUndefined } from "@/lib/env";

/**
 * Server-only variables. Kept apart from `env.ts` (which the browser bundle imports) so that
 * their names and schemas never reach the client; `server-only` makes a client import a build
 * error.
 */
const serverEnvSchema = z.object({
  OPERATOR_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "expected a 0x-prefixed 32-byte key")
    // Rejects keys outside the secp256k1 range, including the all-zero placeholder.
    .refine((value) => {
      try {
        privateKeyToAccount(value as `0x${string}`);
        return true;
      } catch {
        return false;
      }
    }, "not a valid secp256k1 private key")
    .transform((value) => value as `0x${string}`),
  ISSUER_ALLOWLIST: z
    .string()
    .transform((value) =>
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    )
    .pipe(
      z
        .array(
          z
            .string()
            .refine((value) => isAddress(value), "expected an address")
            .refine(
              (value) => value.toLowerCase() !== zeroAddress,
              "zero address is not an issuer",
            ),
        )
        .min(1)
        .transform((list) => list.map((address) => address.toLowerCase() as `0x${string}`)),
    ),
  PINATA_JWT: z.string().min(1),
  RPC_URL_ARBITRUM_SEPOLIA: z.url().optional(),
  RPC_URL_BASE_SEPOLIA: z.url().optional(),
  RPC_URL_SEPOLIA: z.url().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedServerEnv: ServerEnv | undefined;

/** Server-only variables, validated on first use (API routes and server modules). */
export function getServerEnv(): ServerEnv {
  cachedServerEnv ??= serverEnvSchema.parse({
    OPERATOR_PRIVATE_KEY: process.env.OPERATOR_PRIVATE_KEY,
    ISSUER_ALLOWLIST: process.env.ISSUER_ALLOWLIST,
    PINATA_JWT: process.env.PINATA_JWT,
    RPC_URL_ARBITRUM_SEPOLIA: emptyToUndefined(process.env.RPC_URL_ARBITRUM_SEPOLIA),
    RPC_URL_BASE_SEPOLIA: emptyToUndefined(process.env.RPC_URL_BASE_SEPOLIA),
    RPC_URL_SEPOLIA: emptyToUndefined(process.env.RPC_URL_SEPOLIA),
  });
  return cachedServerEnv;
}

/**
 * Server-side RPC URL for a chain; `undefined` means the chain's public default RPC. The variable
 * name derives from the manifest network name: `arbitrum-sepolia` → `RPC_URL_ARBITRUM_SEPOLIA`.
 */
export function serverRpcUrl(chainId: number): string | undefined {
  const network = getChain(chainId)?.network;
  if (!network) return undefined;
  const key = `RPC_URL_${network.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  return (getServerEnv() as Record<string, unknown>)[key] as string | undefined;
}
