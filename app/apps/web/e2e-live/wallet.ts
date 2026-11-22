import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MANIFEST } from "@idpp/passport-config";
import type { Page } from "@playwright/test";
import {
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  type PublicClient,
  toHex,
} from "viem";
import { type PrivateKeyAccount, privateKeyToAccount } from "viem/accounts";
import { getViemChain } from "../src/lib/chains";

/** Public RPCs for the eval3 deployment. */
export const RPC: Record<number, string> = {
  421614: "https://sepolia-rollup.arbitrum.io/rpc",
  84532: "https://sepolia.base.org",
  11155111: "https://ethereum-sepolia-rpc.publicnode.com",
};

/** Reads one variable from `.env.local` (the process environment wins). Never logged. */
function readEnv(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(fileURLToPath(new URL("../.env.local", import.meta.url)), "utf8")
      .split("\n")
      .find((l) => l.startsWith(`${name}=`));
    return line
      ?.slice(name.length + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  } catch {
    return undefined;
  }
}

export function loadAccount(): PrivateKeyAccount {
  const raw = readEnv("OPERATOR_PRIVATE_KEY");
  if (!raw) throw new Error("OPERATOR_PRIVATE_KEY is not set (env or apps/web/.env.local)");
  return privateKeyToAccount((raw.startsWith("0x") ? raw : `0x${raw}`) as Hex);
}

export function publicClientFor(chainId: number): PublicClient {
  return createPublicClient({ chain: getViemChain(chainId), transport: http(RPC[chainId]) });
}

export function contractFor(chainId: number) {
  const chain = MANIFEST.chains.find((c) => c.chainId === chainId);
  if (!chain) throw new Error(`chain ${chainId} is not in the deployment`);
  return chain;
}

type Tx = { to?: Hex; data?: Hex; value?: Hex; gas?: Hex };

/**
 * Installs a wallet in the page: an EIP-1193 provider announced over EIP-6963. Requests are
 * answered in this Node process, which signs with the key from `.env.local`; the browser never
 * sees the key. Reads are forwarded to the chain's public RPC. Returns a log of signing requests.
 */
export async function installWallet(page: Page, account: PrivateKeyAccount) {
  let chainId = MANIFEST.chains[0]?.chainId ?? 421614;
  const log: string[] = [];

  await page.exposeFunction("__walletRequest", async (method: string, params: unknown[] = []) => {
    switch (method) {
      case "eth_requestAccounts":
      case "eth_accounts":
        return [account.address];
      case "eth_chainId":
        return toHex(chainId);
      case "net_version":
        return String(chainId);
      case "wallet_switchEthereumChain":
      case "wallet_addEthereumChain": {
        const next = Number.parseInt((params[0] as { chainId: string }).chainId, 16);
        if (!RPC[next]) throw Object.assign(new Error("Unrecognized chain"), { code: 4902 });
        chainId = next;
        return null;
      }
      case "personal_sign": {
        log.push("personal_sign");
        return account.signMessage({ message: { raw: params[0] as Hex } });
      }
      case "eth_signTypedData_v4": {
        if (String(params[0]).toLowerCase() !== account.address.toLowerCase()) {
          throw new Error("Typed-data signer differs from the connected account");
        }
        const typed = JSON.parse(params[1] as string);
        if (Number(typed.domain.chainId) !== chainId) {
          throw new Error("Switch to the typed-data chain before signing");
        }
        log.push(`eth_signTypedData_v4 on ${chainId}`);
        return account.signTypedData(typed);
      }
      case "eth_sendTransaction": {
        const tx = params[0] as Tx;
        log.push(`eth_sendTransaction on ${chainId}`);
        const client = createWalletClient({
          account,
          chain: getViemChain(chainId),
          transport: http(RPC[chainId]),
        });
        return client.sendTransaction({
          to: tx.to,
          data: tx.data,
          value: tx.value ? BigInt(tx.value) : undefined,
          gas: tx.gas ? BigInt(tx.gas) : undefined,
        } as never);
      }
      default:
        return publicClientFor(chainId).request({ method, params } as never);
    }
  });

  await page.addInitScript(
    ({ address }) => {
      const handlers: Record<string, Array<(...a: unknown[]) => void>> = {};
      const provider = {
        isTestWallet: true,
        request: async ({ method, params }: { method: string; params?: unknown[] }) => {
          try {
            // biome-ignore lint/suspicious/noExplicitAny: injected binding
            const result = await (window as any).__walletRequest(method, params ?? []);
            if (method === "wallet_switchEthereumChain") {
              const id = ((params ?? [])[0] as { chainId: string }).chainId;
              for (const h of handlers.chainChanged ?? []) h(id);
            }
            return result;
          } catch (e) {
            const err = e as { message?: string; code?: number };
            throw Object.assign(new Error(err.message ?? "request failed"), {
              code: err.code ?? -32000,
            });
          }
        },
        on: (event: string, handler: (...a: unknown[]) => void) => {
          handlers[event] = [...(handlers[event] ?? []), handler];
        },
        removeListener: (event: string, handler: (...a: unknown[]) => void) => {
          handlers[event] = (handlers[event] ?? []).filter((h) => h !== handler);
        },
      };
      // biome-ignore lint/suspicious/noExplicitAny: test hook
      (window as any).ethereum = provider;
      const info = {
        uuid: "1c6d7a3e-0000-4000-8000-test00wallet",
        name: "Test Wallet",
        icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iNiIgZmlsbD0iIzVjM2ExZSIvPjwvc3ZnPg==",
        rdns: "dev.idpp.testwallet",
      };
      const announce = () =>
        window.dispatchEvent(
          new CustomEvent("eip6963:announceProvider", {
            detail: Object.freeze({ info, provider }),
          }),
        );
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
      void address;
    },
    { address: account.address },
  );

  return { log, chainId: () => chainId };
}
