// Read-only balances and full Pinata inventory; run from smart_contracts with remaining planned pins.
const req = require('node:module').createRequire(process.cwd() + '/package.json');
req('dotenv').config();
const { ethers } = req('ethers');
async function main() {
    const wallet = process.env.MNEMONIC
        ? ethers.Wallet.fromMnemonic(process.env.MNEMONIC)
        : new ethers.Wallet(process.env.PRIVATE_KEY);
    const specs = [
        ['arbitrum-sepolia', 421614, process.env.RPC_URL_ARBITRUM_SEPOLIA || 'https://sepolia-rollup.arbitrum.io/rpc'],
        ['base-sepolia', 84532, process.env.RPC_URL_BASE_SEPOLIA || 'https://sepolia.base.org'],
        ['sepolia', 11155111, process.env.RPC_URL_SEPOLIA || 'https://ethereum-sepolia-rpc.publicnode.com'],
    ];
    const balances = [];
    for (const [network, chainId, url] of specs) {
        const p = new ethers.providers.StaticJsonRpcProvider({ url, timeout: 20000 }, chainId);
        balances.push({ network, balanceETH: ethers.utils.formatEther(await p.getBalance(wallet.address)) });
    }
    const ids = new Set();
    const cursors = new Set();
    let token;
    do {
        const res = await fetch(
            'https://api.pinata.cloud/v3/files/public?limit=500' +
                (token ? '&pageToken=' + encodeURIComponent(token) : ''),
            { headers: { Authorization: 'Bearer ' + process.env.PINATA_JWT }, signal: AbortSignal.timeout(15000) }
        );
        if (!res.ok) throw new Error('Pinata inventory HTTP ' + res.status);
        const body = await res.json();
        for (const f of body.data.files) {
            if (ids.has(f.id)) throw new Error('duplicate inventory ID');
            ids.add(f.id);
        }
        token = body.data.next_page_token;
        if (token && cursors.has(token)) throw new Error('repeated inventory cursor');
        if (token) cursors.add(token);
    } while (token);
    const remainingPins = Number(process.argv[2]);
    if (!Number.isInteger(remainingPins) || remainingPins < 0) throw new Error('remaining pin count required');
    console.log(
        JSON.stringify(
            {
                at: new Date().toISOString(),
                account: wallet.address,
                balances,
                pins: ids.size,
                remainingPins,
                plannedTotal: ids.size + remainingPins,
                capacity: 500,
            },
            null,
            2
        )
    );
    if (ids.size + remainingPins > 500) throw new Error('planned pins exceed capacity');
}
main().catch((e) => {
    console.error('Capacity check failed:', e.code || e.name);
    process.exitCode = 1;
});
