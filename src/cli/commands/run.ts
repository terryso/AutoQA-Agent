import { resolve } from 'node:path'

import { Command } from 'commander'

import { isUserCorrectableFsError } from '../fs-errors.js'

import { writeOutLine } from '../output.js'

import { discoverMarkdownSpecs } from '../../specs/discover.js'

export function registerRunCommand(program: Command) {
  program
    .command('run')
    .description('Discover Markdown specs under a file or directory (MVP: discovery only)')
    .argument('<file-or-dir>', 'Markdown spec file or directory containing Markdown specs')
    .action((fileOrDir: string) => {
      const { writeOut } = program.configureOutput()
      const inputPath = resolve(fileOrDir)

      const result = discoverMarkdownSpecs(inputPath)

      if (!result.ok) {
        const cause = result.error.cause
        if (isUserCorrectableFsError(cause)) {
          program.error(result.error.message, { exitCode: 2 })
          return
        }

        if (
          result.error.code === 'SPEC_FILE_NOT_MARKDOWN' ||
          result.error.code === 'NO_SPECS_FOUND' ||
          result.error.code === 'INVALID_SPEC_PATH_TYPE'
        ) {
          program.error(result.error.message, { exitCode: 2 })
          return
        }

        program.error(result.error.message)
        return
      }

      for (const specPath of result.specs) {
        writeOutLine(writeOut, specPath)
      }
    })
}
