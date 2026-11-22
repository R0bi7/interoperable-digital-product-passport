import { execFileSync } from 'node:child_process'

import { task } from 'hardhat/config'

import { writeStorageTables } from './storage-report'

// e2e:storage: runs the DS5 Foundry test with the profile and environment that make it write its raw result, then
// renders the tables. With --render-only it only renders the committed raw file.
task('e2e:storage', 'DS5: on-chain storage baseline (Foundry) and its Markdown and LaTeX tables')
    .addFlag('renderOnly', 'Render the tables from e2e_reports/storage-baseline.json without running forge')
    .setAction(async (args: { renderOnly: boolean }, hre) => {
        const root = hre.config.paths.root
        if (!args.renderOnly) {
            const forge = execFileSync('forge', ['--version'], { encoding: 'utf8' }).split('\n')[0].trim()
            console.log(`Running the storage baseline with ${forge}`)
            execFileSync('forge', ['test', '--match-contract', 'StorageBaseline'], {
                cwd: root,
                stdio: 'inherit',
                env: {
                    ...process.env,
                    FOUNDRY_PROFILE: 'ds5',
                    WRITE_STORAGE_BASELINE: '1',
                    FORGE_VERSION: forge,
                },
            })
        }
        for (const file of writeStorageTables(root)) console.log(`Wrote ${file}`)
    })
