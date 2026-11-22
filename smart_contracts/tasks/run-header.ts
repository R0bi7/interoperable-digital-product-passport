import { execFileSync } from 'node:child_process'

import { ethers } from 'ethers'

// The run header of docs/evaluation/PROTOCOL.md, rule 7: what a reader needs to know which code, which deployment and
// which environment produced a report. It is written into every report next to the raw data.

export type RpcClass = 'public' | 'keyed'

export type ChainHeader = {
    readonly network: string
    readonly chainId: number
    readonly eid: number
    readonly address: string
    /** Host name of the RPC URL only: a URL can carry an API key and is never written to a report. */
    readonly rpcHost: string
    readonly rpcClass: RpcClass
    /** keccak256 of the runtime code at the address, read from the chain. Immutables (idPrefix) make it differ per chain. */
    readonly onChainCodeHash: string
    /** keccak256 of `deployedBytecode` in the hardhat-deploy record (the compiler output without immutables). */
    readonly recordCodeHash?: string
}

export type RunHeader = {
    readonly startedAt: string
    readonly gitSha: string
    readonly gitDirty: boolean
    readonly deploymentId: string
    readonly window?: string
    readonly chains: readonly ChainHeader[]
    readonly tools: Readonly<Record<string, string>>
    readonly params: Readonly<Record<string, string | number | boolean>>
}

/** Commit and dirty flag of the checkout the harness runs from. `unknown` outside a git checkout. */
export function gitState(cwd: string): { sha: string; dirty: boolean } {
    const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim()
    try {
        return { sha: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain').length > 0 }
    } catch {
        return { sha: 'unknown', dirty: true }
    }
}

// A host label that looks like a credential: one opaque run of 20 or more letters and digits, or a long label with many
// digits (a UUID). Words joined by hyphens with a few digits (`data-seed-1-s1`) are public host names.
const OPAQUE_LABEL = {
    test: (label: string) =>
        /^[A-Za-z0-9]{20,}$/.test(label) || (label.length >= 20 && (label.match(/\d/g)?.length ?? 0) >= 6),
}

/**
 * Host name of the RPC URL for the header. A label that looks like a credential (20 or more opaque characters, the form
 * of `<token>.rpc.example`) is replaced, so that the header never carries a key even when the provider puts it in the host.
 */
export function rpcHost(url: string): string {
    try {
        return new URL(url).host
            .split('.')
            .map((label) => (OPAQUE_LABEL.test(label) ? '*' : label))
            .join('.')
    } catch {
        return 'unparseable'
    }
}

/**
 * `keyed` when the URL carries something that looks like a credential: user info, a key-like query parameter, or a long
 * opaque path segment or host label (the forms used by hosted providers). Everything else is a shared public endpoint.
 */
export function rpcClass(url: string): RpcClass {
    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        return 'public'
    }
    if (parsed.username !== '' || parsed.password !== '') return 'keyed'
    for (const name of parsed.searchParams.keys()) if (/key|token|secret|auth/i.test(name)) return 'keyed'
    const opaquePath = (segment: string) => /^[A-Za-z0-9_-]{20,}$/.test(segment)
    return parsed.pathname.split('/').some(opaquePath) || parsed.hostname.split('.').some((l) => OPAQUE_LABEL.test(l))
        ? 'keyed'
        : 'public'
}

export const codeHash = (bytecode: string): string => ethers.utils.keccak256(bytecode === '' ? '0x' : bytecode)

export type HeaderChain = {
    readonly network: string
    readonly chainId: number
    readonly eid: number
    readonly address: string
    readonly rpcUrl: string
    readonly provider: ethers.providers.Provider
    /** `deployedBytecode` of the hardhat-deploy record, when available. */
    readonly recordBytecode?: string
}

export type HeaderInput = {
    readonly root: string
    readonly deploymentId: string
    readonly chains: readonly HeaderChain[]
    readonly tools: Readonly<Record<string, string>>
    readonly window?: string
    readonly params: Readonly<Record<string, string | number | boolean>>
    readonly startedAt?: Date
}

export async function buildRunHeader(input: HeaderInput): Promise<RunHeader> {
    const git = gitState(input.root)
    const chains: ChainHeader[] = []
    for (const c of input.chains) {
        const code = await c.provider.getCode(c.address)
        chains.push({
            network: c.network,
            chainId: c.chainId,
            eid: c.eid,
            address: c.address,
            rpcHost: rpcHost(c.rpcUrl),
            rpcClass: rpcClass(c.rpcUrl),
            onChainCodeHash: codeHash(code),
            recordCodeHash: c.recordBytecode == null ? undefined : codeHash(c.recordBytecode),
        })
    }
    return {
        startedAt: (input.startedAt ?? new Date()).toISOString(),
        gitSha: git.sha,
        gitDirty: git.dirty,
        deploymentId: input.deploymentId,
        window: input.window,
        chains,
        tools: input.tools,
        params: input.params,
    }
}

/** Versions of the tools whose behaviour can change a figure. `forge` is only present if it is installed. */
export function toolVersions(hardhatVersion: string): Record<string, string> {
    const tools: Record<string, string> = {
        node: process.version,
        hardhat: hardhatVersion,
        ethers: ethers.version.replace(/^ethers\//, ''),
    }
    try {
        tools.forge = execFileSync('forge', ['--version'], { encoding: 'utf8', stdio: 'pipe' }).split('\n')[0].trim()
    } catch {
        // no Foundry on this machine
    }
    return tools
}

export const headerMarkdown = (header: RunHeader): string[] => [
    '## Run header',
    '',
    `- Commit \`${header.gitSha}\`${header.gitDirty ? ' (working tree dirty)' : ''}. Deployment \`${header.deploymentId}\`.${header.window == null ? '' : ` Window \`${header.window}\`.`}`,
    `- Tools: ${Object.entries(header.tools)
        .map(([k, v]) => `${k} ${v}`)
        .join('; ')}.`,
    `- Parameters: ${
        Object.entries(header.params)
            .map(([k, v]) => `${k} = ${v}`)
            .join('; ') || 'none'
    }.`,
    '',
    '| Network | Chain ID | RPC (host, class) | Runtime code hash on chain | Record code hash |',
    '| --- | ---: | --- | --- | --- |',
    ...header.chains.map(
        (c) =>
            `| ${c.network} | ${c.chainId} | ${c.rpcHost}, ${c.rpcClass} | \`${c.onChainCodeHash}\` | ${c.recordCodeHash == null ? '' : `\`${c.recordCodeHash}\``} |`
    ),
    '',
]
