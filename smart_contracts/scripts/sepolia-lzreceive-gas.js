// Usage (from smart_contracts/): node scripts/sepolia-lzreceive-gas.js --network sepolia|arbitrum-sepolia|base-sepolia [--block <number>] [--warm-nonce]
//        node scripts/sepolia-lzreceive-gas.js --render e2e_reports/<network>-lzreceive-gas-<runId>.json
// (docs/evaluation/SEPOLIA-GAS.md). Bisects the gas limit of EndpointV2.lzReceive into the destination for a fresh token
// with eth_call and a state override that plants the payload hash of a message from another chain of the deployment
// (no live send needed), for each case of CASES, all at one block.
// Every input is derived from fixed strings, so a rerun at the same block sends the same calldata and the same override.
// Writes e2e_reports/<network>-lzreceive-gas-<runId>.json (the raw record: block, calldata, override, every probe of every
// bisection) and the table of the .md next to it; --render rebuilds the .md from a .json and touches nothing else.
// Replaying a record needs a node of the destination chain that serves state at its block (an archive node, or a recent block).
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { ethers } = require('ethers');
require('dotenv/config');
const networkAt = process.argv.indexOf('--network');
const NETWORK = networkAt > 0 ? process.argv[networkAt + 1] : 'sepolia';
const RPCS = {
    sepolia: process.env.RPC_URL_SEPOLIA || 'https://ethereum-sepolia-rpc.publicnode.com',
    'arbitrum-sepolia': process.env.RPC_URL_ARBITRUM_SEPOLIA || 'https://sepolia-rollup.arbitrum.io/rpc',
    'base-sepolia': process.env.RPC_URL_BASE_SEPOLIA || 'https://sepolia.base.org',
};
const RPC = RPCS[NETWORK];
// The deployment from deployments/manifest.json: the two contracts, the enforced gas into the destination and the
// message format (v2: state = (revision, historyHash, cid)).
const GENERATIONS = {};
const DEPLOYMENT = 'whisky-v2-eval3';
if (DEPLOYMENT === 'whisky-v2-eval3' && !process.argv.includes('--render')) {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../deployments/manifest.json'), 'utf8'));
    if (manifest.deploymentId !== DEPLOYMENT) throw new Error('eval3 must be deployed before calibration');
    const dst = manifest.chains.find((c) => c.network === NETWORK);
    const src = manifest.chains.find((c) => c.network !== NETWORK);
    if (!dst || !src || !RPC) throw new Error('unknown destination network');
    GENERATIONS[DEPLOYMENT] = {
        dst: dst.address,
        src: src.address,
        srcEid: src.eid,
        srcChainId: src.chainId,
        enforcedGas: NETWORK === 'sepolia' ? 1_291_000 : 286_000,
        message: 'v2',
    };
}
const GEN = GENERATIONS[DEPLOYMENT];
if (GEN == null && !process.argv.includes('--render')) throw new Error(`unknown deployment ${DEPLOYMENT}`);
const DST = GEN?.dst;
const SRC = GEN?.src;
const SRC_EID = GEN?.srcEid;
const SRC_CHAIN_ID = GEN?.srcChainId;
const ENFORCED_GAS = GEN?.enforcedGas;
// Calibration precedes wiring. Derive the peers slot from this exact compiled source, never guess its position.
const PEER_SLOT =
    DEPLOYMENT === 'whisky-v2-eval3' && !process.argv.includes('--render')
        ? JSON.parse(
              execFileSync('forge', ['inspect', 'WhiskyDistillery', 'storage-layout', '--json'], {
                  cwd: path.join(__dirname, '..'),
                  encoding: 'utf8',
              })
          ).storage.find((s) => s.label === 'peers')?.slot
        : undefined;
if (DEPLOYMENT === 'whisky-v2-eval3' && !process.argv.includes('--render') && PEER_SLOT == null)
    throw new Error('compiled peers storage slot not found');
// On a pathway that has received nothing, the first delivery also creates the endpoint's lazyInboundNonce slot, a cost
// paid once per pathway. --warm-nonce plants a lazyInboundNonce of 1 in the override, so the case measured is a later
// delivery (nonce 2), as on a pathway that is in use. Without it a fresh pathway measures its first delivery.
const WARM_NONCE = process.argv.includes('--warm-nonce');
const CASES = [
    { cidLength: 96, revision: 1 },
    { cidLength: 96, revision: 2 },
    { cidLength: 96, revision: 0 },
    { cidLength: 59, revision: 1 },
    { cidLength: 59, revision: 0 },
    { cidLength: 46, revision: 1 },
];
const abi = ethers.utils.defaultAbiCoder;
const iface = new ethers.utils.Interface([
    'function lzReceive((uint32 srcEid, bytes32 sender, uint64 nonce) origin, address receiver, bytes32 guid, bytes message, bytes extraData) payable',
    'function lazyInboundNonce(address,uint32,bytes32) view returns (uint64)',
    'function endpoint() view returns (address)',
    'function peers(uint32) view returns (bytes32)',
    'function ownerOf(uint256) view returns (address)',
]);
const k = ethers.utils.keccak256;
const pad = (x) => ethers.utils.hexZeroPad(ethers.BigNumber.from(x).toHexString(), 32);
// A value that depends only on the label: the same on every run.
const det = (label) => k(ethers.utils.toUtf8Bytes(`idpp/sepolia-lzreceive-gas/${label}`));
const detAddress = (label) => ethers.utils.getAddress('0x' + det(label).slice(26));

async function measure(p, block, ep, sender, lazy, base, { cidLength, revision }) {
    const pinned = ethers.utils.hexValue(block.number); // every eth_call runs on this block
    const slotOf = (b, extra) => {
        let s = k(abi.encode(['address', 'uint256'], [DST, b]));
        s = k(abi.encode(['uint32', 'bytes32'], [SRC_EID, s]));
        s = k(abi.encode(['bytes32', 'bytes32'], [sender, s]));
        return extra === undefined ? s : k(abi.encode(['uint64', 'bytes32'], [extra, s]));
    };
    const label = `${cidLength}/${revision}`;
    const warm = WARM_NONCE && lazy.isZero();
    const nonce = warm ? ethers.BigNumber.from(2) : lazy.add(1);
    const recipient = detAddress('recipient/' + label);
    const caller = detAddress('caller');
    const tokenId = ethers.BigNumber.from(SRC_CHAIN_ID).mul('1000000000000').add(900000000);
    const cid = 'b'.repeat(cidLength);
    const message = abi.encode(
        ['bytes32', 'uint256', 'bytes'],
        [pad(recipient), tokenId, abi.encode(['uint64', 'bytes32', 'string'], [revision, det('history/' + label), cid])]
    );
    const guid = det('guid/' + label);
    const hash = k(ethers.utils.solidityPack(['bytes32', 'bytes'], [guid, message]));
    // inboundPayloadHash is the mapping declared after lazyInboundNonce
    const slot = slotOf(base + 1, nonce);
    const data = iface.encodeFunctionData('lzReceive', [[SRC_EID, sender, nonce], DST, guid, message, '0x']);
    const bytes = ethers.utils.arrayify(data);
    const intrinsic = 21000 + bytes.reduce((a, b) => a + (b ? 16 : 4), 0);

    // The first arrival must meet cold, empty state: the recipient holds nothing and the token does not exist on Sepolia.
    const fresh = {
        recipientBalance: (await p.send('eth_getBalance', [recipient, pinned])) === '0x0',
        recipientCodeEmpty: (await p.send('eth_getCode', [recipient, pinned])) === '0x',
        tokenAbsent: await p
            .send('eth_call', [{ to: DST, data: iface.encodeFunctionData('ownerOf', [tokenId]) }, pinned])
            .then(
                () => false,
                () => true
            ),
    };
    if (!Object.values(fresh).every(Boolean))
        throw new Error(`${label}: the inputs are not fresh: ${JSON.stringify(fresh)}`);

    const override = { [ep]: { stateDiff: warm ? { [slot]: hash, [slotOf(base)]: pad(1) } : { [slot]: hash } } };
    if (PEER_SLOT != null) {
        const peer = abi.decode(
            ['bytes32'],
            await p.call({ to: DST, data: iface.encodeFunctionData('peers', [SRC_EID]) }, block.number)
        )[0];
        if (peer !== ethers.constants.HashZero && peer.toLowerCase() !== sender.toLowerCase())
            throw new Error('destination has another peer; refusing cross-generation simulation');
        override[DST] = { stateDiff: { [k(abi.encode(['uint32', 'uint256'], [SRC_EID, PEER_SLOT]))]: sender } };
    }
    const probes = [];
    const call = async (gas) => {
        let ok;
        let error;
        try {
            await p.send('eth_call', [
                { from: caller, to: ep, data, gas: ethers.utils.hexValue(gas) },
                pinned,
                override,
            ]);
            ok = true;
        } catch (e) {
            const m = String(e.message || e);
            if (!/out of gas|revert|gas|execution|invalid/i.test(m)) throw e;
            ok = false;
            // the node's own message ("execution reverted", "out of gas"), without the request id of the wrapper text
            error = m.match(/"message\\*":\\*"([^"\\]+)/)?.[1] ?? m.slice(0, 120);
        }
        probes.push(error === undefined ? { gas, ok } : { gas, ok, error });
        return ok;
    };
    if (!(await call(3_000_000))) throw new Error(`${label}: the call fails at 3,000,000 gas: ${probes[0].error}`);
    let lo = intrinsic;
    let hi = 3_000_000;
    while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (await call(mid)) hi = mid;
        else lo = mid + 1;
    }
    // monotonicity just above the minimum, and the failure just below it
    const above = [];
    for (const delta of [1, 2, 5, 50, 500, 5000, 50000]) above.push({ delta, ok: await call(lo + delta) });
    const belowOk = await call(lo - 1);
    return {
        cidLength,
        revision,
        recipient,
        caller,
        tokenId: tokenId.toString(),
        guid,
        nonce: nonce.toString(),
        message,
        calldata: data,
        calldataBytes: bytes.length,
        intrinsicGas: intrinsic,
        stateOverride: { address: ep, slot, value: hash },
        // the full override as sent; in warm mode it also plants the lazyInboundNonce
        ...(warm ? { stateDiff: override[ep].stateDiff } : {}),
        fresh,
        ...(PEER_SLOT == null
            ? {}
            : { fullStateOverride: override, peerSlot: PEER_SLOT, peerOverride: 'read-only simulation before wiring' }),
        minTxGasLimit: lo,
        minEndpointCallGas: lo - intrinsic,
        monotonicAbove: above,
        belowMinimumOk: belowOk,
        probes,
    };
}

function render(run) {
    const f = (x) => x.toLocaleString('en-US');
    const margin = (min) => `${((run.enforcedGas / min - 1) * 100).toFixed(1)}%`;
    return [
        `# ${run.network ?? 'Sepolia'} lzReceive minimum gas ${run.runId}`,
        '',
        `Generated from \`${run.network ?? 'sepolia'}-lzreceive-gas-${run.runId}.json\` (\`node scripts/sepolia-lzreceive-gas.js --render\`); do not edit.`,
        `${run.deploymentId == null ? '' : `Deployment \`${run.deploymentId}\`, message ${run.messageFormat}${run.warmNonce ? ', lazyInboundNonce 1 planted (a later delivery, not the first of the pathway)' : ''}. `}Block ${f(run.block.number)} (${run.block.hash}, ${run.block.time}), endpoint \`${run.endpoint}\`, receiver \`${run.receiver}\`, source \`${run.sender}\` (eid ${run.srcEid}), lazyInboundNonce ${run.lazyInboundNonce}${run.warmNonce ? ' on chain' : ''}, enforced gas ${f(run.enforcedGas)}.`,
        '',
        '| CID bytes | Revision | Calldata bytes | Intrinsic | Minimum tx gas limit | Minimum call gas | Enforced gas above minimum | Probes |',
        '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
        ...run.cases.map(
            (c) =>
                `| ${c.cidLength} | ${c.revision} | ${f(c.calldataBytes)} | ${f(c.intrinsicGas)} | ${f(c.minTxGasLimit)} | ${f(c.minEndpointCallGas)} | ${margin(c.minEndpointCallGas)} | ${c.probes.length} |`
        ),
        '',
        `Monotonic above the minimum (+1 to +50,000 gas) in ${run.cases.filter((c) => c.monotonicAbove.every((x) => x.ok)).length} of ${run.cases.length} cases; the call fails one gas below the minimum in ${run.cases.filter((c) => !c.belowMinimumOk).length} of ${run.cases.length}.`,
        '',
    ].join('\n');
}

async function main() {
    const dir = path.join(__dirname, '..', 'e2e_reports');
    const at = process.argv.indexOf('--render');
    if (at > 0) {
        const file = path.resolve(process.argv[at + 1]);
        fs.writeFileSync(file.replace(/\.json$/, '.md'), render(JSON.parse(fs.readFileSync(file, 'utf8'))));
        return;
    }
    const p = new ethers.providers.JsonRpcProvider({ url: RPC, timeout: 20_000 });
    const manifest =
        DEPLOYMENT === 'whisky-v2-eval3'
            ? JSON.parse(fs.readFileSync(path.join(__dirname, '../deployments/manifest.json'), 'utf8'))
            : null;
    if (manifest && (await p.getNetwork()).chainId !== manifest.chains.find((c) => c.network === NETWORK).chainId)
        throw new Error('RPC chain mismatch');
    const b = process.argv.indexOf('--block');
    const number = b > 0 ? Number(process.argv[b + 1]) : (await p.getBlockNumber()) - 3; // a few blocks back: a load-balanced node may not serve the newest one yet
    const head = await p.getBlock(number);
    const ep = abi.decode(
        ['address'],
        await p.call({ to: DST, data: iface.encodeFunctionData('endpoint') }, number)
    )[0];
    const sender = pad(SRC);
    const lazy = abi.decode(
        ['uint64'],
        await p.call({ to: ep, data: iface.encodeFunctionData('lazyInboundNonce', [DST, SRC_EID, sender]) }, number)
    )[0];
    // The slot of lazyInboundNonce is found by matching its value in storage, so it follows the layout of the deployed endpoint.
    let base = -1;
    for (let i = 0; i < 12 && base < 0 && !lazy.isZero(); i++) {
        let s = k(abi.encode(['address', 'uint256'], [DST, i]));
        s = k(abi.encode(['uint32', 'bytes32'], [SRC_EID, s]));
        s = k(abi.encode(['bytes32', 'bytes32'], [sender, s]));
        if (ethers.BigNumber.from(await p.getStorageAt(ep, s, number)).eq(lazy)) base = i;
    }
    // A pathway that has received no message yet has nonce 0, which cannot be matched. The base is a property of the
    // EndpointV2 storage layout, not of the OApp, so it is taken from a committed record of the same endpoint (the
    // endpoint has the same address on all three chains). Base 1 was matched during development on a pathway that had
    // received messages; the loop above re-derives it on any pathway of this endpoint that is in use.
    if (base < 0 && lazy.isZero()) {
        const known = JSON.parse(
            fs.readFileSync(path.join(__dirname, '../e2e_reports/sepolia-lzreceive-gas-1792439907766.json'), 'utf8')
        );
        if (known.endpoint.toLowerCase() !== ep.toLowerCase()) throw new Error('another endpoint: slot base unknown');
        base = known.lazySlotBase;
    }
    if (base < 0) throw new Error('slot base of lazyInboundNonce not found');
    const cases = [];
    for (const c of CASES) {
        cases.push(await measure(p, head, ep, sender, lazy, base, c));
        console.log(
            `CID ${c.cidLength} bytes, revision ${c.revision}: minimum call gas ${cases.at(-1).minEndpointCallGas}`
        );
    }
    const run = {
        runId: String(Date.now()),
        label: 'LIVE (read-only simulation)',
        network: NETWORK,
        deploymentId: DEPLOYMENT,
        messageFormat: GEN.message,
        warmNonce: WARM_NONCE && lazy.isZero(),
        script: 'scripts/sepolia-lzreceive-gas.js',
        rpcHost: new URL(RPC).host,
        block: { number: head.number, hash: head.hash, time: new Date(head.timestamp * 1000).toISOString() },
        endpoint: ep,
        receiver: DST,
        sender: SRC,
        srcEid: SRC_EID,
        lazyInboundNonce: lazy.toString(),
        lazySlotBase: base,
        enforcedGas: ENFORCED_GAS,
        cases,
    };
    const file = path.join(dir, `${run.network ?? 'sepolia'}-lzreceive-gas-${run.runId}.json`);
    fs.writeFileSync(file, JSON.stringify(run, null, 2) + '\n');
    fs.writeFileSync(file.replace(/\.json$/, '.md'), render(run));
    console.log(file);
}

main().catch((e) => {
    console.error('ERR', String(e.message || e).slice(0, 400));
    process.exit(1);
});
