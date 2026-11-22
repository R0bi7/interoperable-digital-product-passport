import "server-only";
import { getChain } from "@idpp/passport-config";
import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type Transport,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getViemChain } from "@/lib/chains";
import { getServerEnv, serverRpcUrl } from "@/lib/env.server";

export class UnsupportedChainError extends Error {
  constructor(readonly chainId: number) {
    super(`chain ${chainId} is not part of the deployment`);
    this.name = "UnsupportedChainError";
  }
}

function resolve(chainId: number) {
  const manifest = getChain(chainId);
  const chain = getViemChain(chainId);
  if (!manifest || !chain) throw new UnsupportedChainError(chainId);
  const transport: Transport = http(serverRpcUrl(chainId));
  return { manifest, chain, transport };
}

/** Operator account derived from `OPERATOR_PRIVATE_KEY`. The key never leaves this module. */
export function getOperatorAccount() {
  return privateKeyToAccount(getServerEnv().OPERATOR_PRIVATE_KEY);
}

/** Server-side read client for a chain of the deployment. */
export function getPublicClient(chainId: number): PublicClient {
  const { chain, transport } = resolve(chainId);
  return createPublicClient({ chain, transport }) as PublicClient;
}

/** Server-side wallet client signing with the operator key. */
export function getOperatorWalletClient(chainId: number) {
  const { chain, transport } = resolve(chainId);
  return createWalletClient({ account: getOperatorAccount(), chain, transport });
}

export function getDistilleryAddress(chainId: number): `0x${string}` {
  return resolve(chainId).manifest.address;
}
