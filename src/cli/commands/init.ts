import { unlinkSync } from 'node:fs'
import { join } from 'node:path'

import { Command } from 'commander'

import {
  AutoqaConfigAlreadyExistsError,
  AUTOQA_CONFIG_FILE_NAME,
  writeDefaultConfigFile,
} from '../../config/init.js'
import { ensureExampleSpecs } from '../../specs/init.js'

function isUserCorrectableFsError(err: any): boolean {
  const code = err?.code
  if (typeof code !== 'string') return false
  return ['EACCES', 'EPERM', 'EROFS', 'ENOTDIR', 'EISDIR', 'ENOENT', 'EEXIST'].includes(code)
}

export function registerInitCommand(program: Command) {
  program
    .command('init')
    .description(
      `Generate default ${AUTOQA_CONFIG_FILE_NAME} and example specs in current directory`,
    )
    .action(() => {
      const cwd = process.cwd()
      const configPath = join(cwd, AUTOQA_CONFIG_FILE_NAME)
      let didWriteConfig = false

      try {
        writeDefaultConfigFile(cwd)
        didWriteConfig = true
      } catch (err: any) {
        if (err instanceof AutoqaConfigAlreadyExistsError) {
          program.error(
            `${AUTOQA_CONFIG_FILE_NAME} already exists. Refusing to overwrite.`,
            { exitCode: 2 },
          )
          return
        }

        if (isUserCorrectableFsError(err)) {
          program.error(
            `Failed to create ${AUTOQA_CONFIG_FILE_NAME}: ${err?.message ?? String(err)}`,
            { exitCode: 2 },
          )
          return
        }

        program.error(
          `Failed to create ${AUTOQA_CONFIG_FILE_NAME}: ${err?.message ?? String(err)}`,
        )
        return
      }

      let didWriteExample = false

      try {
        const result = ensureExampleSpecs(cwd)
        didWriteExample = result.didWriteExample
      } catch (err: any) {
        let rollbackMessage = ''
        if (didWriteConfig) {
          try {
            unlinkSync(configPath)
            rollbackMessage = ` Rolled back ${AUTOQA_CONFIG_FILE_NAME}.`
          } catch (rollbackErr: any) {
            rollbackMessage = ` Also failed to remove ${AUTOQA_CONFIG_FILE_NAME}: ${rollbackErr?.message ?? String(rollbackErr)}`
          }
        }

        const message = `${err?.message ?? String(err)}${rollbackMessage}`

        if (isUserCorrectableFsError(err)) {
          program.error(`Failed to create specs/login-example.md: ${message}`, {
            exitCode: 2,
          })
          return
        }

        program.error(`Failed to create specs/login-example.md: ${message}`)
        return
      }

      console.log(`Created ${AUTOQA_CONFIG_FILE_NAME}`)

      if (didWriteExample) {
        console.log('Created specs/login-example.md')
      } else {
        console.log('specs/login-example.md already exists. Skipping.')
      }
    })
}
