import { expect } from 'chai'
import { ethers } from 'ethers'

import { codeHash, gitState, headerMarkdown, rpcClass, rpcHost } from '../run-header'

describe('run header', () => {
    it('classifies RPC endpoints without keeping the URL', () => {
        expect(rpcClass('https://ethereum-sepolia-1-s1.rpc.example:8545')).to.equal('public')
        expect(rpcClass('https://sepolia-rollup.arbitrum.io/rpc')).to.equal('public')
        expect(rpcClass('https://ethereum-sepolia-rpc.publicnode.com')).to.equal('public')
        expect(rpcClass('https://eth-sepolia.g.alchemy.com/v2/abcdefghijklmnopqrstuvwxyz012345')).to.equal('keyed')
        expect(rpcClass('https://rpc.example/path?apikey=1')).to.equal('keyed')
        expect(rpcClass('https://user:pass@rpc.example')).to.equal('keyed')
        expect(rpcHost('https://eth-sepolia.g.alchemy.com/v2/abcdefghijklmnopqrstuvwxyz012345')).to.equal(
            'eth-sepolia.g.alchemy.com'
        )
        expect(rpcHost('not a url')).to.equal('unparseable')
        // a credential in the host name is classified as keyed and never written
        expect(rpcClass('https://abcdefghijklmnopqrstuvwx.rpc.example')).to.equal('keyed')
        expect(rpcHost('https://abcdefghijklmnopqrstuvwx.rpc.example')).to.equal('*.rpc.example')
        // hyphenated credentials (a UUID) too, while a public host name with a few digits stays readable
        expect(rpcClass('https://123e4567-e89b-12d3-a456-426614174000.rpc.example')).to.equal('keyed')
        expect(rpcHost('https://123e4567-e89b-12d3-a456-426614174000.rpc.example')).to.equal('*.rpc.example')
        expect(rpcHost('https://ethereum-sepolia-1-s1.rpc.example:8545')).to.equal(
            'ethereum-sepolia-1-s1.rpc.example:8545'
        )
    })

    it('hashes runtime code, treating an empty account as the empty bytes', () => {
        expect(codeHash('0x6001')).to.equal(ethers.utils.keccak256('0x6001'))
        expect(codeHash('0x')).to.equal(ethers.utils.keccak256('0x'))
        expect(codeHash('')).to.equal(ethers.utils.keccak256('0x'))
    })

    it('reads the commit of this checkout, and says unknown outside a repository', () => {
        const here = gitState(__dirname)
        expect(here.sha).to.match(/^[0-9a-f]{40}$/)
        expect(gitState('/')).to.deep.equal({ sha: 'unknown', dirty: true })
    })

    it('renders the header with the window, the tools and one row per chain', () => {
        const lines = headerMarkdown({
            startedAt: '2026-10-20T08:00:00.000Z',
            gitSha: 'abc',
            gitDirty: true,
            deploymentId: 'd',
            window: '2026-10-20T08:00Z',
            chains: [
                {
                    network: 'arbitrum-sepolia',
                    chainId: 421614,
                    eid: 40231,
                    address: '0x1',
                    rpcHost: 'h',
                    rpcClass: 'public',
                    onChainCodeHash: '0xaa',
                },
            ],
            tools: { node: 'v24', forge: 'forge 1.8.5' },
            params: { hops: 14 },
        }).join('\n')
        expect(lines).to.contain('Commit `abc` (working tree dirty). Deployment `d`. Window `2026-10-20T08:00Z`.')
        expect(lines).to.contain('node v24; forge forge 1.8.5')
        expect(lines).to.contain('hops = 14')
        expect(lines).to.contain('| arbitrum-sepolia | 421614 | h, public | `0xaa` |  |')
    })
})
