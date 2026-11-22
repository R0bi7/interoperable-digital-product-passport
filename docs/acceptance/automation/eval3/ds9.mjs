// DS9 (docs/evaluation/PROTOCOL.md DS9): a second copy of ten eval3 CIDs on a local IPFS node.
// The ten CIDs are fixed before the run in DS9_SUBJECTS (JSON: [{ role, tokenId, chainId }]); each CID is the token's
// current `passportOf` CID. For each: `ipfs pin add` with the daemon online (network fetch); if that fails, the bytes
// read through the Pinata gateway are added with `ipfs add --cid-version 1 --raw-leaves` and must give the same CID.
// Then the daemon is stopped and each CID is read once through the Pinata gateway and once with `ipfs --offline cat`,
// and each body is hashed against its CID. No public gateway, second provider or unpin test.
//   DS9_SUBJECTS=docs/acceptance/2026-10-20-ds9-ds11/ds9/ds9-subjects.json node docs/acceptance/automation/eval3/ds9.mjs
//   (from the repository root; IPFS_PATH defaults to ~/.ipfs; output $ACCEPTANCE_OUT/ds9-results.json)
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "../../../..");
const OUT = resolve(process.env.ACCEPTANCE_OUT ?? `${here}/out`);
const { computeCidV1, MANIFEST, whiskyDistilleryAbi } = await import(`${REPO}/app/packages/passport-config/dist/index.js`);
const { createPublicClient, http } = createRequire(`${REPO}/app/apps/web/package.json`)("viem");
const env = readFileSync(`${REPO}/app/apps/web/.env.local`, "utf8");
const GATEWAY = env
  .match(/^NEXT_PUBLIC_PINATA_GATEWAY=(.+)$/m)[1]
  .trim()
  .replace(/^"|"$/g, "")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");
const RPC = {
  421614: "https://sepolia-rollup.arbitrum.io/rpc",
  84532: "https://sepolia.base.org",
  11155111: "https://ethereum-sepolia-rpc.publicnode.com",
};
const ipfs = (args, opts = {}) => execFileSync("ipfs", args, { encoding: "buffer", timeout: 180_000, ...opts });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const subjects = JSON.parse(readFileSync(process.env.DS9_SUBJECTS, "utf8"));
if (subjects.length !== 10) throw new Error(`DS9 needs ten subjects, got ${subjects.length}`);
const result = {
  header: {
    startedAt: new Date().toISOString(),
    deploymentId: MANIFEST.deploymentId,
    kubo: ipfs(["version", "--all"]).toString().trim(),
    gateway: "Pinata dedicated gateway (host not recorded)",
  },
  rows: [],
};
const save = () => writeFileSync(`${OUT}/ds9-results.json`, JSON.stringify(result, null, 2));

// The CIDs are fixed from the chain before any storage operation.
for (const s of subjects) {
  const chain = MANIFEST.chains.find((c) => c.chainId === s.chainId);
  const client = createPublicClient({ transport: http(RPC[s.chainId]) });
  const record = await client.readContract({
    address: chain.address,
    abi: whiskyDistilleryAbi,
    functionName: "passportOf",
    args: [BigInt(s.tokenId)],
  });
  result.rows.push({ ...s, revision: record.revision.toString(), cid: record.cid });
}
result.header.fixedAt = new Date().toISOString();
save();
console.log("fixed CIDs:", result.rows.map((r) => `${r.role} ${r.cid}`).join("\n"));

const daemon = spawn("ipfs", ["daemon"], { stdio: ["ignore", "pipe", "pipe"] });
let ready = false;
daemon.stdout.on("data", (d) => {
  if (String(d).includes("Daemon is ready")) ready = true;
});
for (let i = 0; i < 120 && !ready; i++) await sleep(500);
if (!ready) throw new Error("ipfs daemon did not become ready");
result.header.daemonOnlineAt = new Date().toISOString();

for (const row of result.rows) {
  const t0 = Date.now();
  try {
    ipfs(["pin", "add", "--progress=false", row.cid], { timeout: 120_000 });
    row.copy = "network (ipfs pin add)";
  } catch (error) {
    row.networkPinError = String(error.message).split("\n")[0];
    const bytes = new Uint8Array(await (await fetch(`https://${GATEWAY}/ipfs/${row.cid}`)).arrayBuffer());
    const added = ipfs(["add", "-Q", "--cid-version", "1", "--raw-leaves", "--pin=true"], { input: Buffer.from(bytes) })
      .toString()
      .trim();
    if (added !== row.cid) throw new Error(`gateway bytes of ${row.cid} add as ${added}`);
    row.copy = "gateway bytes (ipfs add --cid-version 1 --raw-leaves)";
  }
  row.copyMs = Date.now() - t0;
  save();
}

daemon.kill("SIGINT");
await new Promise((r) => daemon.on("exit", r));
result.header.daemonStoppedAt = new Date().toISOString();

for (const row of result.rows) {
  try {
    const res = await fetch(`https://${GATEWAY}/ipfs/${row.cid}`, { signal: AbortSignal.timeout(30_000) });
    const bytes = new Uint8Array(await res.arrayBuffer());
    row.gateway = { status: res.status, bytes: bytes.length, verified: res.ok && computeCidV1(bytes) === row.cid };
  } catch (error) {
    row.gateway = { error: String(error.message), verified: false };
  }
  try {
    const bytes = new Uint8Array(ipfs(["--offline", "cat", row.cid], { timeout: 30_000 }));
    row.localOffline = { bytes: bytes.length, verified: computeCidV1(bytes) === row.cid };
  } catch (error) {
    row.localOffline = { error: String(error.message).split("\n")[0], verified: false };
  }
  save();
}
result.header.finishedAt = new Date().toISOString();
save();
for (const r of result.rows)
  console.log(`${r.role}\t${r.cid}\t${r.copy}\tgateway ${r.gateway.verified}\tlocal ${r.localOffline.verified}`);
