import "server-only";
import { getServerEnv } from "@/lib/env.server";

/** Whether `address` is listed in `ISSUER_ALLOWLIST` (case-insensitive). */
export function isAllowlistedIssuer(address: string): boolean {
  return getServerEnv().ISSUER_ALLOWLIST.includes(address.toLowerCase() as `0x${string}`);
}
