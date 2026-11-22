import {
  canonicalBytes,
  computeCidV1,
  historyHashOf,
  MANIFEST,
  whiskyDistilleryAbi,
} from "@idpp/passport-config";
import type { Page, Route } from "@playwright/test";
import {
  type Address,
  decodeFunctionData,
  encodeErrorResult,
  encodeEventTopics,
  encodeFunctionResult,
  type Hex,
  keccak256,
  multicall3Abi,
  toHex,
} from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { getViemChain } from "../src/lib/chains";

/**
 * An offline stand-in for the chains and the gateway, for the mock Playwright suite. Every chain
 * RPC the app's wagmi transports call is answered in this process from `MockToken`, and the
 * gateway serves the token's revision-0 payload. No transaction is signed or broadcast; an optional
 * throwaway key signs ownership proof typed data in Node only.
 */
export type MockToken = {
  tokenId: bigint;
  chainId: number;
  owner: Address;
  issuers: readonly Address[];
  balanceWei?: bigint;
  /**
   * Same-chain `safeTransferFrom` transactions the key-backed wallet "sent" (no signature, no
   * broadcast). `revert` mines the next one as reverted, leaving the owner unchanged.
   */
  transactions?: MockTransaction[];
  revert?: boolean;
  /** Every contract read answered, with its target and block tag, for assertions. */
  reads?: MockRead[];
};

export type MockRead = { functionName: string; contract: Address; block: string };

export type MockTransaction = {
  hash: Hex;
  chainId: number;
  from: Address;
  to: Address;
  contract: Address;
  status: "success" | "reverted";
};

const BLOCK = 1_000_000n;
/** A "sent" transaction is mined in the next block, which then becomes the head. */
export const MINED_BLOCK = BLOCK + 1n;

function head(token: MockToken): bigint {
  return token.transactions?.length ? MINED_BLOCK : BLOCK;
}

/** The holder at `block` ("latest" or a hex number): before a successful transfer, its sender. */
function ownerAt(token: MockToken, block: string): Address {
  const first = token.transactions?.find((t) => t.status === "success");
  if (first && block !== "latest" && BigInt(block) < MINED_BLOCK) return first.from;
  return token.owner;
}

export function mockPayload(tokenId: bigint) {
  const envelope = {
    schema: "idpp-passport/1",
    deploymentId: MANIFEST.deploymentId,
    tokenId: tokenId.toString(),
    revision: "0",
    previousCid: null,
    kind: "cask",
    granularity: "item",
    data: {
      distillery: "Demo Distillery",
      caskType: "Bourbon barrel",
      caskNumber: "1",
      volumeLiters: "200",
      alcoholByVolume: "63.5",
      fillDate: "2026-10-01",
    },
  };
  const bytes = canonicalBytes(envelope);
  return { bytes, cid: computeCidV1(bytes) };
}

type RpcRequest = { id: number; jsonrpc: "2.0"; method: string; params?: unknown[] };
type RpcResponse =
  | { id: number; jsonrpc: "2.0"; result: unknown }
  | { id: number; jsonrpc: "2.0"; error: { code: number; message: string; data?: Hex } };

const AGGREGATE3 = "0x82ad56cb";
const GET_ETH_BALANCE = "0x4d2301cc";

/** One contract call at `block`: return data, or revert data. Only the manifest contract answers. */
function callResult(
  token: MockToken,
  chainId: number,
  contract: Address | undefined,
  data: Hex,
  block: string,
): { ok: boolean; data: Hex } {
  const expected = MANIFEST.chains.find((chain) => chain.chainId === chainId)?.address;
  if (!contract || !expected || contract.toLowerCase() !== expected.toLowerCase()) {
    // Answered as a revert with no data, so a stray call fails visibly instead of hanging.
    return { ok: false, data: "0x" };
  }
  const { functionName, args } = decodeFunctionData({ abi: whiskyDistilleryAbi, data });
  token.reads = [...(token.reads ?? []), { functionName, contract, block }];
  const held = chainId === token.chainId && args?.[0] === token.tokenId;
  const result = (value: unknown) => ({
    ok: true,
    data: encodeFunctionResult({ abi: whiskyDistilleryAbi, functionName, result: value } as never),
  });
  switch (functionName) {
    case "safeTransferFrom": {
      // The simulation of a same-chain transfer: ERC-721 rules for the holder only.
      const [from, , tokenId] = args as readonly [Address, Address, bigint];
      if (chainId !== token.chainId || tokenId !== token.tokenId) {
        return {
          ok: false,
          data: encodeErrorResult({
            abi: whiskyDistilleryAbi,
            errorName: "ERC721NonexistentToken",
            args: [tokenId],
          }),
        };
      }
      if (from.toLowerCase() !== token.owner.toLowerCase()) {
        return {
          ok: false,
          data: encodeErrorResult({
            abi: whiskyDistilleryAbi,
            errorName: "ERC721IncorrectOwner",
            args: [from, tokenId, token.owner],
          }),
        };
      }
      return { ok: true, data: "0x" };
    }
    case "quoteSend":
      return result({ nativeFee: 1_000_000_000_000_000n, lzTokenFee: 0n });
    case "ownerOf":
      return held
        ? result(ownerAt(token, block))
        : {
            ok: false,
            data: encodeErrorResult({
              abi: whiskyDistilleryAbi,
              errorName: "ERC721NonexistentToken",
              args: [args?.[0] as bigint],
            }),
          };
    case "passportOf": {
      // An unknown id reads as the empty passport, as on the contract.
      if (!held) return result({ revision: 0n, historyHash: `0x${"0".repeat(64)}`, cid: "" });
      const { cid } = mockPayload(token.tokenId);
      return result({ revision: 0n, historyHash: historyHashOf(token.tokenId, [cid]), cid });
    }
    case "isIssuer": {
      const account = String(args?.[0]).toLowerCase();
      const issuer =
        chainId === token.chainId && token.issuers.some((a) => a.toLowerCase() === account);
      return result(issuer);
    }
    default:
      throw new Error(`mock chain does not answer ${functionName}`);
  }
}

function receiptOf(token: MockToken, tx: MockTransaction) {
  const block = {
    blockHash: `0x${"b1".repeat(32)}` as Hex,
    blockNumber: toHex(MINED_BLOCK),
    transactionHash: tx.hash,
    transactionIndex: "0x0",
  };
  const logs =
    tx.status === "success"
      ? [
          {
            ...block,
            address: tx.contract,
            topics: encodeEventTopics({
              abi: whiskyDistilleryAbi,
              eventName: "Transfer",
              args: { from: tx.from, to: tx.to, tokenId: token.tokenId },
            }),
            data: "0x",
            logIndex: "0x0",
            removed: false,
          },
        ]
      : [];
  return {
    ...block,
    from: tx.from,
    to: tx.contract,
    contractAddress: null,
    cumulativeGasUsed: "0xea60",
    gasUsed: "0xea60",
    effectiveGasPrice: "0x3b9aca00",
    logs,
    logsBloom: `0x${"0".repeat(512)}`,
    status: tx.status === "success" ? "0x1" : "0x0",
    type: "0x2",
  };
}

/**
 * The key-backed wallet's `eth_sendTransaction`: only a same-chain `safeTransferFrom` of the mock
 * token is accepted. It is "mined" at once at the mock block, changing the owner unless `revert`.
 */
function sendTransaction(token: MockToken, chainId: number, request: { to?: Address; data?: Hex }) {
  if (!request.to || !request.data) throw new Error("mock wallet needs a contract call");
  const { functionName, args } = decodeFunctionData({
    abi: whiskyDistilleryAbi,
    data: request.data,
  });
  if (functionName !== "safeTransferFrom") {
    throw new Error(`mock wallet does not send ${functionName}`);
  }
  const [from, to, tokenId] = args as readonly [Address, Address, bigint];
  if (chainId !== token.chainId || tokenId !== token.tokenId) throw new Error("wrong token");
  const transactions = token.transactions ?? [];
  token.transactions = transactions;
  const status = token.revert ? "reverted" : "success";
  if (status === "success") token.owner = to;
  const hash = keccak256(toHex(`mock-transfer-${transactions.length}`));
  transactions.push({ hash, chainId, from, to, contract: request.to, status });
  return hash;
}

/** Answers one JSON-RPC request of `chainId` from the token's state. */
export function answerRpc(token: MockToken, chainId: number, request: RpcRequest): RpcResponse {
  const ok = (result: unknown): RpcResponse => ({ id: request.id, jsonrpc: "2.0", result });
  const fail = (code: number, message: string, data?: Hex): RpcResponse => ({
    id: request.id,
    jsonrpc: "2.0",
    error: { code, message, ...(data ? { data } : {}) },
  });
  switch (request.method) {
    case "eth_chainId":
      return ok(toHex(chainId));
    case "eth_blockNumber":
      return ok(toHex(head(token)));
    case "eth_getBalance":
      return ok(toHex(token.balanceWei ?? 0n));
    case "eth_getTransactionReceipt": {
      const hash = String(request.params?.[0]).toLowerCase();
      const tx = token.transactions?.find((t) => t.hash === hash && t.chainId === chainId);
      return ok(tx ? receiptOf(token, tx) : null);
    }
    case "eth_call": {
      const call = (request.params?.[0] ?? {}) as { to?: Address; data?: Hex };
      if (!call.data) return fail(-32602, "missing call data");
      const tag = request.params?.[1];
      const block = typeof tag === "string" && tag.startsWith("0x") ? tag : "latest";
      if (call.data.startsWith(AGGREGATE3)) {
        const { args } = decodeFunctionData({ abi: multicall3Abi, data: call.data });
        const calls = (args?.[0] ?? []) as readonly { target: Address; callData: Hex }[];
        const results = calls.map(({ target, callData }) => {
          // Multicall3's own getEthBalance: the configured fixture balance.
          if (callData.startsWith(GET_ETH_BALANCE)) {
            return { success: true, returnData: toHex(token.balanceWei ?? 0n, { size: 32 }) };
          }
          const answer = callResult(token, chainId, target, callData, block);
          return { success: answer.ok, returnData: answer.data };
        });
        return ok(
          encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: results }),
        );
      }
      const answer = callResult(token, chainId, call.to, call.data, block);
      return answer.ok ? ok(answer.data) : fail(3, "execution reverted", answer.data);
    }
    default:
      return fail(-32601, `mock chain does not answer ${request.method}`);
  }
}

/** Routes every chain RPC of the deployment and the gateway to the mock. */
export async function installMockChain(page: Page, token: MockToken) {
  // A token object reused across tests starts each test with an empty read log.
  token.reads = [];
  for (const { chainId } of MANIFEST.chains) {
    const url = getViemChain(chainId)?.rpcUrls.default.http[0];
    if (!url) throw new Error(`no default RPC for chain ${chainId}`);
    await page.route(url, async (route: Route) => {
      const body = route.request().postDataJSON() as RpcRequest | RpcRequest[];
      const answer = Array.isArray(body)
        ? body.map((r) => answerRpc(token, chainId, r))
        : answerRpc(token, chainId, body);
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(answer) });
    });
  }
  const { bytes, cid } = mockPayload(token.tokenId);
  await page.route(`https://*/ipfs/${cid}`, (route) =>
    route.fulfill({ contentType: "application/octet-stream", body: Buffer.from(bytes) }),
  );
}

/**
 * An EIP-1193 wallet announced over EIP-6963 that only reports `address` and its chain. It holds no
 * key: signing or sending throws, so a test that reaches a signature fails loudly.
 */
export async function installAddressOnlyWallet(page: Page, token: MockToken, address: Address) {
  return installMockWallet(page, token, address);
}

/** A throwaway key held only in Node, for offline EIP-712 proof tests; never sends a transaction. */
export async function installKeyBackedWallet(
  page: Page,
  token: MockToken,
  account: PrivateKeyAccount,
  initialChainId = token.chainId,
) {
  return installMockWallet(page, token, account.address, account, initialChainId);
}

async function installMockWallet(
  page: Page,
  token: MockToken,
  address: Address,
  account?: PrivateKeyAccount,
  initialChainId = token.chainId,
) {
  let chainId = initialChainId;
  const log: string[] = [];
  await page.exposeFunction("__mockWallet", async (method: string, params: unknown[] = []) => {
    switch (method) {
      case "eth_requestAccounts":
      case "eth_accounts":
        return [address];
      case "eth_chainId":
        return toHex(chainId);
      case "wallet_switchEthereumChain":
        chainId = Number.parseInt((params[0] as { chainId: string }).chainId, 16);
        if (!MANIFEST.chains.some((chain) => chain.chainId === chainId))
          throw new Error("Unknown chain");
        log.push(`wallet_switchEthereumChain on ${chainId}`);
        return null;
      case "eth_signTypedData_v4": {
        if (!account) throw new Error("An address-only wallet cannot sign");
        if (String(params[0]).toLowerCase() !== account.address.toLowerCase())
          throw new Error("Wrong signing account");
        const typed = JSON.parse(params[1] as string);
        if (Number(typed.domain.chainId) !== chainId)
          throw new Error("Switch to the typed data chain before signing");
        log.push(`eth_signTypedData_v4 on ${chainId}`);
        return account.signTypedData(typed);
      }
      case "eth_sendTransaction": {
        if (!account) throw new Error("An address-only wallet cannot send");
        const request = params[0] as { from?: string; to?: Address; data?: Hex };
        if (String(request.from).toLowerCase() !== account.address.toLowerCase())
          throw new Error("Wrong sending account");
        log.push(`eth_sendTransaction on ${chainId}`);
        return sendTransaction(token, chainId, request);
      }
      default: {
        const answer = answerRpc(token, chainId, { id: 1, jsonrpc: "2.0", method, params });
        if ("error" in answer) throw new Error(answer.error.message);
        return answer.result;
      }
    }
  });
  await page.addInitScript(() => {
    const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
    const provider = {
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        // biome-ignore lint/suspicious/noExplicitAny: injected binding
        const result = await (window as any).__mockWallet(method, params ?? []);
        if (method === "wallet_switchEthereumChain") {
          const next = ((params ?? [])[0] as { chainId: string }).chainId;
          for (const handler of handlers.chainChanged ?? []) handler(next);
        }
        return result;
      },
      on: (event: string, handler: (...args: unknown[]) => void) => {
        handlers[event] = [...(handlers[event] ?? []), handler];
      },
      removeListener: (event: string, handler: (...args: unknown[]) => void) => {
        handlers[event] = (handlers[event] ?? []).filter((candidate) => candidate !== handler);
      },
    };
    const info = {
      uuid: "1c6d7a3e-0000-4000-8000-mock0wallet0",
      name: "Mock Wallet",
      icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIvPg==",
      rdns: "dev.idpp.mockwallet",
    };
    const announce = () =>
      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }),
      );
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  });
  return { log, chainId: () => chainId };
}
