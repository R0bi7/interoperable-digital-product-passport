// Offline smoke test, not part of `pnpm test`: three JSON-RPC mocks (ports 18097, 18113, 18161)
// that serve a ARBITRUM -> Base Sepolia -> ARBITRUM round trip of token 421614000000000006 as real, ABI-encoded logs at
// manifest.deploymentBlock + offset. IN_FLIGHT=1 omits the final receive. Usage:
//   node scripts/mock-rpc.mjs
//   (in .env.local) PONDER_RPC_URL_421614=http://127.0.0.1:18097
//                   PONDER_RPC_URL_84532=http://127.0.0.1:18113
//                   PONDER_RPC_URL_11155111=http://127.0.0.1:18161
//   pnpm exec ponder dev --disable-ui   # then: curl localhost:42069/api/passports
import http from "node:http";
import { MANIFEST, whiskyDistilleryAbi } from "@idpp/passport-config";
import { encodeAbiParameters, encodeEventTopics, getAbiItem } from "viem";

const TOKEN = 421_614_000_000_000_006n;
const ZERO = "0x0000000000000000000000000000000000000000";
const ALICE = "0x00000000000000000000000000000000000a11ce";
const BOB = "0x0000000000000000000000000000000000000b0b";
const CAROL = "0x000000000000000000000000000000000000ca01";
const OP = "0x00000000000000000000000000000000000000f0";
const g = (n) => `0x${n.toString(16).padStart(64, "0")}`;
const BASE_TS = 1_700_000_000;
const HEAD_OFFSET = Number(process.env.HEAD_OFFSET ?? 200);

// [chainId, offsetFromDeploymentBlock, txIndexInBlock, eventName, args, txFrom]
const plan = [
  [421614, 10, 0, "PassportIssued", { tokenId: TOKEN, cid: "bafkreia" }, OP],
  [421614, 10, 0, "Transfer", { from: ZERO, to: ALICE, tokenId: TOKEN }, OP],
  [
    421614,
    20,
    0,
    "PassportRevised",
    { tokenId: TOKEN, revision: 1n, cid: "bafkreib", author: ALICE },
    ALICE,
  ],
  [421614, 30, 0, "Transfer", { from: ALICE, to: ZERO, tokenId: TOKEN }, ALICE],
  [
    421614,
    30,
    0,
    "ONFTSent",
    { guid: g(1), dstEid: 40245, fromAddress: ALICE, tokenId: TOKEN },
    ALICE,
  ],
  [84532, 45, 0, "Transfer", { from: ZERO, to: BOB, tokenId: TOKEN }, OP],
  [84532, 45, 0, "PassportImported", { tokenId: TOKEN, revision: 1n, cid: "bafkreib" }, OP],
  [84532, 45, 0, "ONFTReceived", { guid: g(1), srcEid: 40231, toAddress: BOB, tokenId: TOKEN }, OP],
  [
    84532,
    50,
    0,
    "PassportRevised",
    { tokenId: TOKEN, revision: 2n, cid: "bafkreic", author: BOB },
    BOB,
  ],
  [84532, 60, 0, "Transfer", { from: BOB, to: ZERO, tokenId: TOKEN }, BOB],
  [84532, 60, 0, "ONFTSent", { guid: g(2), dstEid: 40231, fromAddress: BOB, tokenId: TOKEN }, BOB],
  [421614, 90, 0, "Transfer", { from: ZERO, to: CAROL, tokenId: TOKEN }, OP],
  [421614, 90, 0, "PassportImported", { tokenId: TOKEN, revision: 2n, cid: "bafkreic" }, OP],
  [
    421614,
    90,
    0,
    "ONFTReceived",
    { guid: g(2), srcEid: 40245, toAddress: CAROL, tokenId: TOKEN },
    OP,
  ],
];
// Optional: leave out the final receive on chain 421614 to leave the token in flight.
const SKIP_FINAL_RECEIVE = process.env.IN_FLIGHT === "1";

const hex = (n) => `0x${n.toString(16)}`;

function build(chain) {
  const dep = chain.deploymentBlock;
  const head = dep + HEAD_OFFSET;
  const logsByBlock = new Map();
  for (const [chainId, off, txIdx, name, args, from] of plan) {
    if (chainId !== chain.chainId) continue;
    if (SKIP_FINAL_RECEIVE && chainId === 421614 && off === 90) continue;
    const n = dep + off;
    const item = getAbiItem({ abi: whiskyDistilleryAbi, name });
    const topics = encodeEventTopics({ abi: whiskyDistilleryAbi, eventName: name, args });
    const nonIndexed = item.inputs.filter((i) => !i.indexed);
    const data = nonIndexed.length
      ? encodeAbiParameters(
          nonIndexed,
          nonIndexed.map((i) => args[i.name]),
        )
      : "0x";
    const list = logsByBlock.get(n) ?? [];
    list.push({ topics, data, from, txIdx });
    logsByBlock.set(n, list);
  }
  return { chain, dep, head, logsByBlock };
}

const blockHash = (c, n) =>
  `0x${c.toString(16).padStart(8, "0")}${n.toString(16).padStart(56, "0")}`;
const txHash = (c, n, i) =>
  `0x${c.toString(16).padStart(8, "0")}${n.toString(16).padStart(12, "0")}${i.toString(16).padStart(4, "0")}${"0".repeat(40)}`;

function blockObj(s, n, full) {
  const c = s.chain.chainId;
  const logs = s.logsByBlock.get(n) ?? [];
  const txs = [...new Set(logs.map((l) => l.txIdx))].map((i) => {
    const l = logs.find((x) => x.txIdx === i);
    return {
      hash: txHash(c, n, i),
      nonce: "0x0",
      blockHash: blockHash(c, n),
      blockNumber: hex(n),
      transactionIndex: hex(i),
      from: l.from,
      to: s.chain.address,
      value: "0x0",
      gas: "0x5208",
      gasPrice: "0x1",
      input: "0x",
      type: "0x0",
      v: "0x1b",
      r: "0x1",
      s: "0x1",
      chainId: hex(c),
    };
  });
  return {
    number: hex(n),
    hash: blockHash(c, n),
    parentHash: blockHash(c, n - 1),
    timestamp: hex(BASE_TS + (n - s.dep)),
    nonce: "0x0000000000000000",
    sha3Uncles: g(0),
    logsBloom: `0x${"0".repeat(512)}`,
    transactionsRoot: g(0),
    stateRoot: g(0),
    receiptsRoot: g(0),
    miner: ZERO,
    difficulty: "0x0",
    totalDifficulty: "0x0",
    size: "0x1",
    gasLimit: "0x1c9c380",
    gasUsed: "0x0",
    extraData: "0x",
    mixHash: g(0),
    uncles: [],
    baseFeePerGas: "0x1",
    transactions: full ? txs : txs.map((t) => t.hash),
  };
}

function logsFor(s, from, to) {
  const out = [];
  for (let n = from; n <= to; n++) {
    const logs = s.logsByBlock.get(n);
    if (!logs) continue;
    logs.forEach((l, idx) => {
      out.push({
        address: s.chain.address,
        blockHash: blockHash(s.chain.chainId, n),
        blockNumber: hex(n),
        data: l.data,
        logIndex: hex(idx),
        removed: false,
        topics: l.topics,
        transactionHash: txHash(s.chain.chainId, n, l.txIdx),
        transactionIndex: hex(l.txIdx),
      });
    });
  }
  return out;
}

function handle(s, method, params) {
  const resolve = (tag) => {
    if (tag === "latest" || tag === "pending" || tag === "finalized" || tag === "safe")
      return s.head;
    if (tag === "earliest") return 0;
    return Number.parseInt(tag, 16);
  };
  switch (method) {
    case "eth_chainId":
      return hex(s.chain.chainId);
    case "eth_blockNumber":
      return hex(s.head);
    case "eth_getBlockByNumber": {
      const n = resolve(params[0]);
      return n > s.head ? null : blockObj(s, n, params[1]);
    }
    case "eth_getBlockByHash": {
      const n = Number.parseInt(params[0].slice(10), 16);
      return n > s.head ? null : blockObj(s, n, params[1]);
    }
    case "eth_getLogs": {
      const f = params[0];
      if (f.blockHash) {
        const n = Number.parseInt(f.blockHash.slice(10), 16);
        return logsFor(s, n, n);
      }
      return logsFor(s, resolve(f.fromBlock), Math.min(resolve(f.toBlock), s.head));
    }
    case "eth_getBlockReceipts": {
      const n = resolve(params[0]);
      return logsFor(s, n, n).length === 0 ? [] : [];
    }
    default:
      console.error(`[mock ${s.chain.chainId}] unhandled ${method}`);
      throw new Error(`unhandled ${method}`);
  }
}

for (const chain of MANIFEST.chains) {
  const s = build(chain);
  const port = { 421614: 18097, 84532: 18113, 11155111: 18161 }[chain.chainId];
  http
    .createServer((req, res) => {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        const respond = (r) => {
          try {
            return { jsonrpc: "2.0", id: r.id, result: handle(s, r.method, r.params ?? []) };
          } catch (e) {
            return {
              jsonrpc: "2.0",
              id: r.id,
              error: { code: -32601, message: String(e.message) },
            };
          }
        };
        const parsed = JSON.parse(body);
        const out = Array.isArray(parsed) ? parsed.map(respond) : respond(parsed);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(out));
      });
    })
    .listen(port, () => console.error(`mock ${chain.network} on ${port}, head ${s.head}`));
}
