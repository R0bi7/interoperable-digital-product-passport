import { task } from 'hardhat/config'

import { fixtureDir, fixtureDrift, writeFixtures } from './fixtures'

// Kept apart from fixtures.ts so that the unit tests can import the generator without a Hardhat context.
task('e2e:fixtures', 'Writes the evaluation fixtures to fixtures/, or with --check reports drift without writing')
    .addFlag('check', 'Only compare the committed files with the generated ones; fail on any difference')
    .setAction(async (args: { check: boolean }, hre) => {
        const dir = fixtureDir(hre.config.paths.root)
        if (args.check) {
            const drift = fixtureDrift(dir)
            if (drift.length > 0) throw new Error(`fixtures out of date:\n${drift.join('\n')}`)
            console.log('Fixtures match the generator.')
            return
        }
        console.log(`Wrote ${writeFixtures(dir).length} files to ${dir}`)
    })
