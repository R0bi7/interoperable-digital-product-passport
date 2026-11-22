// Configuration generation; the active deployment is recorded in deployments/manifest.json.
export const deploymentId = 'whisky-v2-eval3'

import { EndpointId } from '@layerzerolabs/lz-definitions'
import { ExecutorOptionType } from '@layerzerolabs/lz-v2-utilities'
import { TwoWayConfig, generateConnectionsConfig } from '@layerzerolabs/metadata-tools'
import { OAppEnforcedOption } from '@layerzerolabs/toolbox-hardhat'

import type { OmniPointHardhat } from '@layerzerolabs/toolbox-hardhat'

const arbitrumSepoliaContract: OmniPointHardhat = {
    eid: EndpointId.ARBSEP_V2_TESTNET,
    contractName: 'WhiskyDistillery',
}

const baseSepoliaContract: OmniPointHardhat = {
    eid: EndpointId.BASESEP_V2_TESTNET,
    contractName: 'WhiskyDistillery',
}

const sepoliaContract: OmniPointHardhat = {
    eid: EndpointId.SEPOLIA_V2_TESTNET,
    contractName: 'WhiskyDistillery',
}

// Block confirmations per source chain, pinned to the EndpointV2 default ULN302 configuration read on-chain
// (SendUln302.getUlnConfig for the zero app, both destinations per source, 2026-10-19).
// Send libraries: Sepolia 0xcc1ae8Cf5D3904Cef3360A9532B477529b177cCE; Arbitrum Sepolia
// 0x4f7cd4DA19ABB31b0eC98b9066B9e857B1bf9C0E; Base Sepolia 0xC1868e054425D378095A003EcbA3823a5D0135C9.
const ARBITRUM_SEPOLIA_CONFIRMATIONS = 5
const BASE_SEPOLIA_CONFIRMATIONS = 2
const SEPOLIA_CONFIRMATIONS = 2

// Gas for WhiskyDistillery._lzReceive (via EndpointV2.lzReceive) of a SEND message.
// Measured locally as the minimum endpoint.lzReceive gas of a first arrival in the worst case, a revised passport
// (revision 1) with a maximal 96-byte CID (test/foundry/WhiskyDistillery.t.sol, `forge test --isolate --match-test Gas`,
// Cancun gas schedule, forge 1.8.5, 2026-10-17): 228,365. 286,000 = 228,365 x 1.25 rounded up.
// Revision 0 needs 208,149 (96-byte CID) and 185,277 (59-byte CID). Chains whose gas schedule differs from Cancun need
// their own calibration.
const LZ_RECEIVE_GAS = 286_000

// Into Sepolia: simulated with scripts/sepolia-lzreceive-gas.js (docs/evaluation/SEPOLIA-GAS.md): minimum
// EndpointV2.lzReceive call gas 1,032,799 in the worst case (96-byte CID, revision 1 or 2) for the first delivery of a
// pathway, which also creates the endpoint's nonce slot. 1,291,000 = 1,032,799 x 1.25 rounded up.
const SEPOLIA_LZ_RECEIVE_GAS = 1_291_000

// Only SEND (msgType 1) is used: WhiskyDistillery rejects composed messages (SEND_AND_COMPOSE).
const enforcedReceiveGas = (gas: number): OAppEnforcedOption[] => [
    {
        msgType: 1,
        optionType: ExecutorOptionType.LZ_RECEIVE,
        gas,
        value: 0,
    },
]
// Eval3 calibration before wiring (2026-10-19), cold nonce and fresh token/recipient, six CID/revision cases per chain:
// Arbitrum Sepolia: arbitrum-sepolia-lzreceive-gas-1792439876988.json; Base: base-sepolia-lzreceive-gas-1792439824660.json.
// Both worst cases need 228,149 call gas (96-byte CID, revision 1 or 2), so 286,000 leaves 25.36% margin.
// Sepolia: sepolia-lzreceive-gas-1792439907766.json measures 1,032,799 against the 1,291,000 limit.
// Records are read-only eth_call bisections; actual executor delivery is gated by smoke.
const EVM_ENFORCED_OPTIONS = enforcedReceiveGas(LZ_RECEIVE_GAS)
const SEPOLIA_ENFORCED_OPTIONS = enforcedReceiveGas(SEPOLIA_LZ_RECEIVE_GAS)

// With the config generator, pathways declared are automatically bidirectional
// i.e. if you declare A,B there's no need to declare B,A
const pathways: TwoWayConfig[] = [
    [
        arbitrumSepoliaContract, // Chain A contract
        baseSepoliaContract, // Chain B contract
        [['LayerZero Labs'], []], // [ requiredDVN[], [ optionalDVN[], threshold ] ]
        [ARBITRUM_SEPOLIA_CONFIRMATIONS, BASE_SEPOLIA_CONFIRMATIONS], // [A to B confirmations, B to A confirmations]
        [EVM_ENFORCED_OPTIONS, EVM_ENFORCED_OPTIONS], // Chain B enforcedOptions, Chain A enforcedOptions
    ],
    [
        arbitrumSepoliaContract,
        sepoliaContract,
        [['LayerZero Labs'], []],
        [ARBITRUM_SEPOLIA_CONFIRMATIONS, SEPOLIA_CONFIRMATIONS],
        [SEPOLIA_ENFORCED_OPTIONS, EVM_ENFORCED_OPTIONS],
    ],
    [
        baseSepoliaContract,
        sepoliaContract,
        [['LayerZero Labs'], []],
        [BASE_SEPOLIA_CONFIRMATIONS, SEPOLIA_CONFIRMATIONS],
        [SEPOLIA_ENFORCED_OPTIONS, EVM_ENFORCED_OPTIONS],
    ],
]

// The mesh. Exported on its own so that `lz:precheck` can read it without fetching the DVN metadata.
export const contracts = [
    { contract: arbitrumSepoliaContract },
    { contract: baseSepoliaContract },
    { contract: sepoliaContract },
]

export default async function () {
    // Generate the connections config based on the pathways
    const connections = await generateConnectionsConfig(pathways)
    return {
        contracts,
        connections,
    }
}
