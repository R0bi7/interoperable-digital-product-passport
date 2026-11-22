import { Contract, ContractFactory, Wallet } from 'ethers'
import { deployments, ethers } from 'hardhat'

import { Options } from '@layerzerolabs/lz-v2-utilities'

import { Chain, Ctx } from '../flows'
import { computeCidV1 } from '../payload'

// The in-process stand-in for the live world, used by the dry run: three real
// WhiskyDistillery contracts wired through EndpointV2Mock, a fake Pinata upload API, a fake gateway and a fake
// LayerZero Scan. It runs the same flow code as the live tasks but is not evidence: no real chain, no real IPFS.

export const HARDHAT_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' // well-known account #0
// Well-known Hardhat account #1: stands in for the derived second account in the dry run.
export const HARDHAT_KEY_1 = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
export const SPECS = [
    { network: 'arbitrum-sepolia', chainId: 421614, eid: 1 },
    { network: 'base-sepolia', chainId: 84532, eid: 2 },
    { network: 'sepolia', chainId: 11155111, eid: 3 },
]

/** What the fake Pinata and gateway hold, and how they misbehave on request. */
export type FakeWorld = {
    store: Map<string, Uint8Array>
    reads: Map<string, number>
    /** Uploads accepted so far: what a real Pinata account would count as files, even for bytes it already holds. */
    uploads: number
    corruptSecondRead: boolean
    /** Scan's answer for every transaction: a status name, or 404 as for the sends LayerZero did not pick up on 2026-10-18. */
    scan: string | 404
}

export const newWorld = (): FakeWorld => ({
    store: new Map(),
    reads: new Map(),
    uploads: 0,
    corruptSecondRead: false,
    scan: 'DELIVERED',
})

/** Replaces `fetch` by the fakes; returns the function that puts the real one back. */
export function installFakeFetch(world: FakeWorld): () => void {
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
        const url = String(input)
        if (url.startsWith('https://uploads.pinata.cloud/v3/files')) {
            const file = (init?.body as FormData).get('file') as Blob
            const bytes = new Uint8Array(await file.arrayBuffer())
            const cid = computeCidV1(bytes)
            world.store.set(cid, bytes)
            world.uploads++
            return new Response(JSON.stringify({ data: { cid } }))
        }
        if (url.includes('/ipfs/')) {
            const cid = url.split('/ipfs/')[1]
            const bytes = world.store.get(cid)
            if (bytes == null) return new Response('', { status: 404 })
            const count = (world.reads.get(cid) ?? 0) + 1
            world.reads.set(cid, count)
            // The first read of the first payload is the pin read-back; later reads are verifications.
            if (world.corruptSecondRead && cid === [...world.store.keys()][0] && count >= 2) {
                const corrupt = bytes.slice()
                corrupt[20] ^= 1
                return new Response(corrupt as Uint8Array<ArrayBuffer>)
            }
            return new Response(bytes as Uint8Array<ArrayBuffer>)
        }
        if (url.includes('layerzero-api')) {
            if (world.scan === 404)
                return new Response(JSON.stringify({ message: 'Message not found' }), { status: 404 })
            return new Response(JSON.stringify({ data: [{ status: { name: world.scan } }] }))
        }
        throw new Error(`unexpected fetch ${url}`)
    }) as typeof fetch
    return () => {
        globalThis.fetch = realFetch
    }
}

/** Three wired chains with the owner account of the harness. */
export async function deployMesh(): Promise<Chain[]> {
    const wallet = new Wallet(HARDHAT_KEY, ethers.provider)
    const endpointArtifact = await deployments.getArtifact('EndpointV2Mock')
    const Factory = await ethers.getContractFactory('WhiskyDistillery')
    const endpoints: Contract[] = []
    const chains: Chain[] = []
    for (const spec of SPECS) {
        const endpoint = await new ContractFactory(endpointArtifact.abi, endpointArtifact.bytecode, wallet).deploy(
            spec.eid
        )
        endpoints.push(endpoint)
        const distillery = await Factory.connect(wallet).deploy(
            'WhiskyDistillery',
            'IDPP',
            spec.chainId,
            endpoint.address,
            wallet.address
        )
        await distillery.setIssuer(wallet.address, true) // as deploy/WhiskyDistillery.ts does
        chains.push({ ...spec, wallet, distillery: distillery.connect(wallet) })
    }
    const options = Options.newOptions().addExecutorLzReceiveOption(300000, 0).toHex().toString()
    for (let i = 0; i < chains.length; i++) {
        for (let j = 0; j < chains.length; j++) {
            if (i === j) continue
            await endpoints[i].setDestLzEndpoint(chains[j].distillery.address, endpoints[j].address)
            await chains[i].distillery.setPeer(chains[j].eid, ethers.utils.zeroPad(chains[j].distillery.address, 32))
            await chains[i].distillery.setEnforcedOptions([{ eid: chains[j].eid, msgType: 1, options }])
        }
    }
    return chains
}

export function newCtx(deploymentId = 'whisky-v2-eval3'): Ctx {
    return {
        runId: String(Date.now()),
        deploymentId,
        pinata: { jwt: 'jwt', gateway: 'gateway.example', uploadPath: 'v3' },
        verify: {
            gateway: 'gateway.example',
            deploymentId,
            cache: new Map(),
            fetchOptions: { attempts: 2, delayMs: 10 },
        },
        histories: new Map(),
        timeoutSeconds: 60,
    }
}
