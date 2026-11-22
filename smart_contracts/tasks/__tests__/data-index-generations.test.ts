import { expect } from 'chai'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { deploymentSection } from '../data-index'
import { RunEntry } from '../gas-report'

describe('data-index generation boundaries', () => {
    let root: string
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'index-generation-'))
        fs.mkdirSync(path.join(root, 'e2e_reports'))
        fs.mkdirSync(path.join(root, 'deployments'))
        fs.writeFileSync(path.join(root, 'deployments/manifest.json'), JSON.stringify({ deploymentId: 'current' }))
    })
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }))
    const entry = (id: string, dataset = 'DS1'): RunEntry => ({
        runId: id,
        dataset,
        task: 'ops',
        role: dataset === 'DS1' ? 'dataset' : 'excluded',
        note: '',
    })
    const report = (id: string, deploymentId: string, address: string, gitDirty = false) => {
        fs.writeFileSync(
            path.join(root, 'e2e_reports', `ops-${id}.json`),
            JSON.stringify({
                deploymentId,
                header: {
                    gitSha: 'not-a-real-sha',
                    gitDirty,
                    chains: [{ network: 'sepolia', address, onChainCodeHash: address }],
                },
                flows: [],
            })
        )
    }
    it('compares within generations while retaining distinct redeployment addresses', () => {
        report('1', 'old', '0xold')
        report('2', 'current', '0xnew')
        const out = deploymentSection(root, [entry('1'), entry('2')]).join('\n')
        expect(out).to.contain('each chain: yes')
        expect(out).to.contain('old / sepolia: `0xold`')
        expect(out).to.contain('current / sepolia: `0xnew`')
        report('3', 'current', '0xdrift')
        expect(deploymentSection(root, [entry('1'), entry('2'), entry('3')]).join('\n')).to.contain(
            '**no, see the run headers**'
        )
    })
    it('uses the first clean smoke of the current manifest generation as its baseline', () => {
        report('1', 'old', '0xold')
        report('2', 'current', '0xnew', true)
        report('3', 'current', '0xnew')
        report('4', 'current', '0xnew')
        const out = deploymentSection(root, [
            entry('4', 'smoke'),
            entry('1', 'pilot'),
            entry('2', 'smoke'),
            entry('3', 'smoke'),
        ]).join('\n')
        expect(out).to.contain('Current-generation baseline: `ops-3` (current)')
        expect(out).not.to.contain('Current-generation baseline: `ops-1`')
        expect(out).not.to.contain('each chain: yes') // no dataset headers were compared
    })
    it('leaves ui records out of the code-hash comparison', () => {
        report('1', 'current', '0xnew')
        fs.writeFileSync(
            path.join(root, 'e2e_reports/ui-2.json'),
            JSON.stringify({ deploymentId: 'current', header: { gitSha: 'x', gitDirty: false }, flows: [] })
        )
        const out = deploymentSection(root, [entry('1'), { ...entry('2', 'DS12'), task: 'ui', role: 'dataset' }]).join(
            '\n'
        )
        expect(out).to.contain('dataset runs (1 reports)')
        expect(out).to.contain('each chain: yes')
    })
    it('does not claim equal deployments when a dataset header is missing', () => {
        fs.writeFileSync(
            path.join(root, 'e2e_reports/ops-1.json'),
            JSON.stringify({ deploymentId: 'current', flows: [] })
        )
        expect(deploymentSection(root, [entry('1')]).join('\n')).to.contain('not fully assessable')
    })
})
