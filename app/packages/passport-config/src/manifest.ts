import { whiskyDistilleryAbi } from "./generated/abi";
import manifestJson from "./generated/manifest.json";

export { whiskyDistilleryAbi };

export type Address = `0x${string}`;

export type ManifestChain = {
  /** hardhat-deploy network name, e.g. `arbitrum-sepolia`. */
  readonly network: string;
  /** EVM chain id; also the `idPrefix` of passports issued on this chain. */
  readonly chainId: number;
  /** LayerZero V2 endpoint id. */
  readonly eid: number;
  readonly address: Address;
  readonly deploymentBlock: number;
};

export type DeploymentManifest = {
  readonly deploymentId: string;
  readonly chains: readonly ManifestChain[];
};

/** Copy of `smart_contracts/deployments/manifest.json` (see `scripts/sync-contracts.ts`). */
export const MANIFEST: DeploymentManifest = manifestJson as DeploymentManifest;

/** Ids per issuing chain: `tokenId = idPrefix * ID_SPACE + sequence`. */
export const ID_SPACE = 10n ** 12n;

export function getChain(chainId: number): ManifestChain | undefined {
  return MANIFEST.chains.find((chain) => chain.chainId === chainId);
}

export function getChainByEid(eid: number): ManifestChain | undefined {
  return MANIFEST.chains.find((chain) => chain.eid === eid);
}

/** EVM chain id of the chain that issued `tokenId` (mirrors `originOf` on the contract). */
export function originOf(tokenId: bigint): bigint {
  return tokenId / ID_SPACE;
}
