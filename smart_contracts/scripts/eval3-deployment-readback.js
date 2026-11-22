// Read back the deployed generation; no transaction or signature is requested.
require('dotenv/config');
const fs = require('node:fs');
const path = require('node:path');
const { ethers } = require('ethers');
const manifest = require('../deployments/manifest.json');
const endpoint = '0x6EDCE65403992e310A62460808c4b910D972f10f';
const urls = {
    sepolia: 'https://ethereum-sepolia-rpc.publicnode.com',
    'arbitrum-sepolia': 'https://sepolia-rollup.arbitrum.io/rpc',
    'base-sepolia': 'https://sepolia.base.org',
};
async function main() {
    if (manifest.deploymentId !== 'whisky-v2-eval3') throw new Error('eval3 manifest required');
    const account = process.env.MNEMONIC
        ? ethers.Wallet.fromMnemonic(process.env.MNEMONIC).address
        : new ethers.Wallet(process.env.PRIVATE_KEY).address;
    const run = { at: new Date().toISOString(), deploymentId: manifest.deploymentId, account, chains: [], quotes: [] };
    for (const chain of manifest.chains) {
        const key = `RPC_URL_${chain.network.toUpperCase().replace(/-/g, '_')}`;
        const p = new ethers.providers.StaticJsonRpcProvider(
            { url: process.env[key] || urls[chain.network], timeout: 20000 },
            chain.chainId
        );
        if (Number(await p.send('eth_chainId', [])) !== chain.chainId) throw new Error('RPC chain mismatch');
        const c = new ethers.Contract(
            chain.address,
            [
                'function nextTokenId() view returns(uint256)',
                'function quoteSend((uint32 dstEid,bytes32 to,uint256 tokenId,bytes extraOptions,bytes composeMsg,bytes onftCmd),bool) view returns(uint256 nativeFee,uint256 lzTokenFee)',
                'function owner() view returns(address)',
                'function isIssuer(address) view returns(bool)',
                'function idPrefix() view returns(uint256)',
                'function endpoint() view returns(address)',
                'function onftVersion() view returns(bytes4,uint64)',
                'function mintedCount() view returns(uint256)',
                'function peers(uint32) view returns(bytes32)',
            ],
            p
        );
        const code = await p.getCode(chain.address);
        const [owner, issuer, prefix, ep, version, count] = await Promise.all([
            c.owner(),
            c.isIssuer(account),
            c.idPrefix(),
            c.endpoint(),
            c.onftVersion(),
            c.mintedCount(),
        ]);
        if (
            code === '0x' ||
            owner !== account ||
            !issuer ||
            prefix.toString() !== String(chain.chainId) ||
            ep.toLowerCase() !== endpoint.toLowerCase() ||
            version[0] !== '0x23e18da6' ||
            version[1].toString() !== '14490024798553719034'
        )
            throw new Error(`${chain.network} readback mismatch`);
        const peers = [];
        for (const remote of manifest.chains.filter((r) => r !== chain)) {
            const peer = await c.peers(remote.eid);
            if (peer.toLowerCase() !== ethers.utils.hexZeroPad(remote.address, 32).toLowerCase())
                throw new Error('peer mismatch');
            peers.push({ eid: remote.eid, peer });
            const fee = await c.quoteSend(
                [remote.eid, ethers.utils.hexZeroPad(account, 32), await c.nextTokenId(), '0x', '0x', '0x'],
                false
            );
            run.quotes.push({
                source: chain.network,
                destination: remote.network,
                nativeFeeWei: fee.nativeFee.toString(),
                // Historical label kept for consistency with the filed readback report; the e2e:budget task is not part of this repository.
                label: 'actual app quote for next token id, as used by e2e:budget',
            });
        }
        run.chains.push({
            ...chain,
            readBlock: await p.getBlockNumber(),
            codeBytes: (code.length - 2) / 2,
            codeHash: ethers.utils.keccak256(code),
            owner,
            issuer,
            idPrefix: prefix.toString(),
            endpoint: ep,
            onftVersion: [version[0], version[1].toString()],
            mintedCount: count.toString(),
            balanceWei: (await p.getBalance(account)).toString(),
            peers,
        });
        console.log(
            `${chain.network}: ${chain.address}, prefix ${prefix}, issuer ${issuer}, code ${ethers.utils.keccak256(code)}`
        );
    }
    const file = path.join(__dirname, '../e2e_reports', `eval3-deployment-readback-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(run, null, 2) + '\n');
    console.log(file);
}
main().catch((error) => {
    console.error('Readback stopped:', error.code || error.reason || error.message);
    process.exitCode = 1;
});
