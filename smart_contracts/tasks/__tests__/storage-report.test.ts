import { expect } from 'chai'
import fs from 'node:fs'
import path from 'node:path'

import { parseStorageBaseline, storageLatex, storageMarkdown } from '../storage-report'

const single = (name: string, bytes: number, over = false) => ({
    name,
    payloadBytes: bytes,
    cidBytes: 59,
    registryIssueGas: 100_000,
    bytesIssueGas: over ? 46_000_000 : 300_000,
    registryReviseGas: 60_000,
    bytesReviseGas: 120_000,
    bytesReviseOneWordGas: 90_000,
    registrySlots: 4,
    bytesSlots: 12,
})
const sample = {
    forge: 'forge Version: 1.8.5',
    profile: 'ds5',
    emptyCallGas: 21_579,
    maxCidBytes: 96,
    single: [single('cask-minimal', 313), single('size-64-kib', 65_536, true)],
    growth: [
        {
            revisions: 5,
            payloadBytesAll: 1_938,
            registryGas: 318_906,
            bytesLatestGas: 701_125,
            bytesAllGas: 1_769_842,
            registrySlots: 4,
            bytesLatestSlots: 15,
            bytesAllSlots: 70,
        },
    ],
}

describe('storage report', () => {
    it('renders ratios, thousands separators and the block-limit mark', () => {
        const md = storageMarkdown(parseStorageBaseline(JSON.stringify(sample)))
        expect(md).to.contain(
            '| cask-minimal | 313 | 100,000 | 300,000 | 3.0 | 60,000 | 120,000 | 2.0 | 90,000 | 1.5 | 4 / 12 |'
        )
        expect(md).to.contain('| size-64-kib | 65,536 | 100,000 | 46,000,000 † | 460.0 |')
        expect(md).to.contain('| 5 | 1,938 | 318,906 | 701,125 | 2.2 | 1,769,842 | 5.5 | 4 / 15 / 70 |')
        expect(md).to.contain('A call that does nothing costs 21,579 gas')
        expect(md).to.not.contain('cask-minimal | 313 | 100,000 | 300,000 †')
        // a dagger belongs to a single transaction: the cumulative gas of several is never marked
        const growth = md.slice(md.indexOf('## One passport over'))
        expect(growth).to.not.contain('†')
    })

    it('renders two booktabs tables with labels', () => {
        const tex = storageLatex(parseStorageBaseline(JSON.stringify(sample)))
        expect(tex).to.contain('\\label{tab:storage-single}').and.to.contain('\\label{tab:storage-growth}')
        expect(tex).to.contain('cask-minimal & 313 & 100,000 & 300,000 & 3.0')
    })

    it('rejects a raw file with a missing field instead of printing a table with holes', () => {
        expect(() => parseStorageBaseline(JSON.stringify({ ...sample, forge: undefined }))).to.throw('forge')
        expect(() => parseStorageBaseline(JSON.stringify({ ...sample, single: [] }))).to.throw('single is empty')
        const broken = { ...sample, single: [{ ...single('x', 1), bytesIssueGas: 'many' }] }
        expect(() => parseStorageBaseline(JSON.stringify(broken))).to.throw('bytesIssueGas')
    })

    it('rejects numbers that would print a nonsense ratio: zero gas, fractions, negatives, infinity', () => {
        const bad = (patch: Record<string, unknown>) =>
            JSON.stringify({ ...sample, single: [{ ...single('x', 1), ...patch }] })
        expect(() => parseStorageBaseline(bad({ registryIssueGas: 0 }))).to.throw('registryIssueGas = 0')
        expect(() => parseStorageBaseline(bad({ bytesSlots: 1.5 }))).to.throw('bytesSlots')
        expect(() => parseStorageBaseline(bad({ payloadBytes: -1 }))).to.throw('negative payloadBytes')
        expect(() => parseStorageBaseline(bad({ bytesIssueGas: 1e309 }).replace('null', '1e309'))).to.throw()
        expect(() => parseStorageBaseline(JSON.stringify({ ...sample, emptyCallGas: 0 }))).to.throw('emptyCallGas')
    })

    it('regenerates the committed tables from the committed raw file, byte for byte', () => {
        const dir = path.resolve(__dirname, '../../e2e_reports')
        const raw = parseStorageBaseline(fs.readFileSync(path.join(dir, 'storage-baseline.json'), 'utf8'))
        expect(storageMarkdown(raw)).to.equal(fs.readFileSync(path.join(dir, 'storage-baseline.md'), 'utf8'))
        expect(storageLatex(raw)).to.equal(fs.readFileSync(path.join(dir, 'storage-baseline.tex'), 'utf8'))
    })
})
