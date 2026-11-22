// DS10 indexer stand-in (docs/evaluation/PROTOCOL.md DS10, "Injection boundary"). A local HTTP server that forwards
// every request to the real indexer and rewrites the summaries of the dishonest-indexer cases only:
//   decoy   (case c tokens): revision 0 is listed with the decoy CID that revision 1 names; txHash, author and times
//           stay the real ones, so the receipt still shows the CID the chain recorded.
//   future  (existing tokens): a revision M+1 row with a pinned, valid envelope is appended above the live tip.
// Every other token passes through unchanged. These cases are INJECTED at the indexer API; they are not a claim
// that the real indexer emitted them.
//
//   node ds10-standin.mjs            (UPSTREAM=http://localhost:42069, PORT=42080, ACCEPTANCE_OUT=./out)
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(process.env.ACCEPTANCE_OUT ?? `${here}/out`);
const UPSTREAM = process.env.UPSTREAM ?? "http://localhost:42069";
const PORT = Number(process.env.PORT ?? 42080);
const fixtures = JSON.parse(readFileSync(`${OUT}/ds10-fixtures.json`, "utf8"));
// A transaction hash with no receipt on any chain: the future row was never mined.
const NO_TX = `0x${"00".repeat(31)}01`;

const decoy = new Map((fixtures.c ?? []).map((r) => [r.tokenId, r]));
const future = new Map((fixtures.future ?? []).map((r) => [r.tokenId, r]));
const hits = [];
// The case c tokens are read honestly for case c and with the decoy for the decoy case: the reader script switches
// this with GET /__standin/decoy?on=1|0 before each case. The future rows are always served.
let decoyOn = false;

function rewrite(summary) {
  if (!summary || typeof summary !== "object" || !summary.tokenId) return summary;
  const d = decoyOn ? decoy.get(summary.tokenId) : undefined;
  if (d) {
    hits.push({ at: new Date().toISOString(), case: "decoy", tokenId: summary.tokenId });
    for (const row of summary.revisions ?? []) if (row.revision === "0") row.cid = d.decoyCid;
    for (const e of summary.timeline ?? []) if (e.revision === "0" && e.cid) e.cid = d.decoyCid;
  }
  const f = future.get(summary.tokenId);
  if (f && !(summary.revisions ?? []).some((r) => r.revision === f.futureRevision)) {
    hits.push({ at: new Date().toISOString(), case: "future", tokenId: summary.tokenId });
    const tip = summary.revisions.at(-1);
    const timestamp = String(Math.floor(Date.now() / 1000));
    summary.revisions.push({
      revision: f.futureRevision,
      cid: f.futureCid,
      chainId: tip.chainId,
      author: tip.author,
      txHash: NO_TX,
      timestamp,
      conflict: false,
    });
    summary.timeline.push({
      chainId: tip.chainId,
      txHash: NO_TX,
      blockNumber: summary.timeline.at(-1)?.blockNumber ?? "0",
      timestamp,
      logIndex: 0,
      kind: "revised",
      revision: f.futureRevision,
      cid: f.futureCid,
      author: tip.author,
    });
    summary.revision = f.futureRevision;
    summary.cid = f.futureCid;
  }
  return summary;
}

createServer(async (req, res) => {
  if (req.url?.startsWith("/__standin/decoy")) {
    decoyOn = new URL(req.url, "http://x").searchParams.get("on") === "1";
    hits.push({ at: new Date().toISOString(), case: "switch", decoyOn });
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ decoyOn }));
  }
  if (req.url === "/__standin/hits") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(hits));
  }
  try {
    const upstream = await fetch(`${UPSTREAM}${req.url}`, { method: req.method, headers: { accept: "application/json" } });
    const type = upstream.headers.get("content-type") ?? "";
    let body = await upstream.text();
    if (type.includes("application/json") && req.url.startsWith("/api/passports")) {
      const json = JSON.parse(body);
      if (Array.isArray(json.items)) json.items = json.items.map(rewrite);
      else rewrite(json);
      body = JSON.stringify(json);
    }
    res.writeHead(upstream.status, {
      "content-type": type || "text/plain",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch (error) {
    res.writeHead(502, { "content-type": "text/plain", "access-control-allow-origin": "*" });
    res.end(`stand-in upstream error: ${error.message}`);
  }
}).listen(PORT, () =>
  console.log(`ds10 stand-in on :${PORT} -> ${UPSTREAM} (decoy ${[...decoy.keys()].join(",")}; future ${[...future.keys()].join(",")})`),
);
