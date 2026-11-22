import { expect } from 'chai'
import fs from 'node:fs'
import path from 'node:path'

import { MUTANTS, applyMutant } from '../mutation-lib'

describe('mutants', () => {
    const root = path.resolve(__dirname, '../..')

    it('apply to the current sources exactly once, and change them', () => {
        for (const m of MUTANTS) {
            const source = fs.readFileSync(path.join(root, m.file), 'utf8')
            const mutated = applyMutant(source, m)
            expect(mutated, m.id).to.not.equal(source)
        }
    })

    it('have unique ids', () => {
        expect(new Set(MUTANTS.map((m) => m.id)).size).to.equal(MUTANTS.length)
    })

    it('refuse text that is missing or ambiguous', () => {
        const m = { id: 'T', file: 'f', from: 'a', to: 'b', breaks: '' }
        expect(() => applyMutant('xyz', m)).to.throw('not in')
        expect(() => applyMutant('aa', m)).to.throw('more than once')
        expect(applyMutant('xay', m)).to.equal('xby')
    })
})
