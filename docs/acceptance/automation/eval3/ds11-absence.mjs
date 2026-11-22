// Read-only check that the DS11 bottles left the source chain: `ownerOf` on Arbitrum Sepolia must revert with
// ERC721NonexistentToken (any other error is not counted as absence), and Base Sepolia must name the holder.
// Writes one JSON object to stdout.
//   node docs/acceptance/automation/eval3/ds11-absence.mjs 421614000000000039 421614000000000040 > <evidence file>
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const req = createRequire(`${REPO}/app/apps/web/package.json`);
const { createPublicClient, http, BaseError, ContractFunctionRevertedError } = req("viem");
const manifest = JSON.parse(readFileSync(`${REPO}/smart_contracts/deployments/manifest.json`, "utf8"));
const abi = JSON.parse(readFileSync(`${REPO}/app/packages/passport-config/src/generated/abi.json`, "utf8"));
const RPC = { 421614: "https://sepolia-rollup.arbitrum.io/rpc", 84532: "https://sepolia.base.org" };
const client = (id) => createPublicClient({ transport: http(RPC[id]) });
const address = (id) => manifest.chains.find((c) => c.chainId === id).address;

async function ownerOf(chainId, tokenId) {
  try {
    return { owner: await client(chainId).readContract({ address: address(chainId), abi, functionName: "ownerOf", args: [BigInt(tokenId)] }) };
  } catch (error) {
    const revert = error instanceof BaseError ? error.walk((e) => e instanceof ContractFunctionRevertedError) : null;
    return { error: revert?.data?.errorName ?? String(error.shortMessage ?? error.message).split("\n")[0] };
  }
}

const out = { at: new Date().toISOString(), tokens: [] };
for (const tokenId of process.argv.slice(2)) {
  const source = await ownerOf(421614, tokenId);
  const destination = await ownerOf(84532, tokenId);
  out.tokens.push({ tokenId, arbitrumSepolia: source, baseSepolia: destination, absentOnSource: source.error === "ERC721NonexistentToken" });
}
console.log(JSON.stringify(out, null, 2));
