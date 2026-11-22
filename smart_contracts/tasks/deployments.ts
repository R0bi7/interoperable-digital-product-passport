import fs from 'fs'
import path from 'path'

import { task, types } from 'hardhat/config'

import type { HardhatRuntimeEnvironment, HttpNetworkConfig, NetworkConfig } from 'hardhat/types'

// One place that resolves networks, hardhat-deploy records and the deployment manifest
// (docs/TECHNICAL-REFERENCE.md, "How the parts connect"), shared by the tasks that read deployments.

export const CONTRACT_NAME = 'WhiskyDistillery'

export interface DeploymentRecord {
    address: string
    receipt: { blockNumber: number }
}

export interface ManifestChain {
    network: string
    chainId: number
    eid: number
    address: string
    deploymentBlock: number
}

export interface Manifest {
    deploymentId: string
    chains: ManifestChain[]
}

export const manifestPath = (hre: HardhatRuntimeEnvironment): string =>
    path.join(hre.config.paths.root, 'deployments', 'manifest.json')

/** Network config with the fields every deployment task needs. */
export const httpNetwork = (
    hre: HardhatRuntimeEnvironment,
    network: string
): HttpNetworkConfig & { chainId: number; eid: number } => {
    const config = hre.config.networks[network] as (HttpNetworkConfig & { eid?: number }) | undefined
    if (config?.url == null || config.chainId == null || config.eid == null) {
        throw new Error(`Network ${network} needs url, chainId and eid in hardhat.config.ts`)
    }
    return config as HttpNetworkConfig & { chainId: number; eid: number }
}

/** The one network of hardhat.config.ts that carries this LayerZero endpoint id. */
export const networkForEid = (hre: HardhatRuntimeEnvironment, eid: number): string => {
    const matches = Object.entries(hre.config.networks)
        .filter(([, config]) => (config as NetworkConfig & { eid?: number }).eid === eid)
        .map(([name]) => name)
    if (matches.length !== 1) {
        throw new Error(`eid ${eid}: expected one network in hardhat.config.ts, found ${matches.length}`)
    }
    return matches[0]
}

export const readDeploymentRecord = (
    hre: HardhatRuntimeEnvironment,
    network: string,
    contractName = CONTRACT_NAME
): DeploymentRecord => {
    const file = path.join(hre.config.paths.root, 'deployments', network, `${contractName}.json`)
    if (!fs.existsSync(file)) throw new Error(`No ${contractName} deployment for ${network} (${file})`)
    return JSON.parse(fs.readFileSync(file, 'utf8')) as DeploymentRecord
}

export const buildManifest = (hre: HardhatRuntimeEnvironment, deploymentId: string, networks: string[]): Manifest => ({
    deploymentId,
    chains: networks.map((network) => {
        const { chainId, eid } = httpNetwork(hre, network)
        const record = readDeploymentRecord(hre, network)
        return { network, chainId, eid, address: record.address, deploymentBlock: record.receipt.blockNumber }
    }),
})

export const readManifest = (hre: HardhatRuntimeEnvironment): Manifest | undefined => {
    const file = manifestPath(hre)
    return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as Manifest) : undefined
}

/** Differences between the manifest and what the records and network config say now; empty when consistent. */
export const manifestDrift = (hre: HardhatRuntimeEnvironment, manifest: Manifest): string[] => {
    const drift: string[] = []
    for (const have of manifest.chains) {
        let want: ManifestChain
        try {
            ;[want] = buildManifest(hre, manifest.deploymentId, [have.network]).chains
        } catch (error) {
            drift.push(`manifest ${have.network}: ${(error as Error).message}`)
            continue
        }
        for (const key of Object.keys(want) as (keyof ManifestChain)[]) {
            if (String(have[key]).toLowerCase() !== String(want[key]).toLowerCase()) {
                drift.push(`manifest ${want.network}.${key} is ${have[key]}, the record says ${want[key]}`)
            }
        }
    }
    return drift
}

task('lz:manifest', 'Writes deployments/manifest.json from the hardhat-deploy records')
    .addParam('deploymentId', 'Name of the deployment generation, e.g. whisky-v2-eval3', undefined, types.string)
    .addOptionalParam('networks', 'Comma-separated networks', 'arbitrum-sepolia,base-sepolia,sepolia', types.string)
    .setAction(async ({ deploymentId, networks }: { deploymentId: string; networks: string }, hre) => {
        const manifest = buildManifest(
            hre,
            deploymentId,
            networks.split(',').map((n) => n.trim())
        )
        fs.writeFileSync(manifestPath(hre), JSON.stringify(manifest, null, 2) + '\n')
        console.log(`Wrote ${manifestPath(hre)} for ${deploymentId}`)
    })
