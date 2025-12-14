import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

import { Command } from 'commander'

import { isUserCorrectableFsError } from '../fs-errors.js'

import { writeOutLine } from '../output.js'

import { discoverMarkdownSpecs } from '../../specs/discover.js'
import { validateRunArgs } from '../../runner/validate-run-args.js'
import { runPreflight } from '../../runner/preflight.js'

function sanitizeBaseUrlForLog(baseUrl: string): string {
  try {
    const url = new URL(baseUrl)
    return url.origin
  } catch {
    return baseUrl
  }
}

export function registerRunCommand(program: Command) {
  program
    .command('run')
    .description('Discover Markdown specs under a file or directory (MVP: discovery + preflight)')
    .argument('<file-or-dir>', 'Markdown spec file or directory containing Markdown specs')
    .option('--url <baseUrl>', 'Base URL to test against (e.g. http://localhost:3000)')
    .option('--debug', 'Run in debug mode (headed browser + extra logs)')
    .option('--headless', 'Force headless mode (conflicts with --debug)')
    .action(async (fileOrDir: string, options: { url?: string; debug?: boolean; headless?: boolean }) => {
      const { writeOut, writeErr } = program.configureOutput()

      const validated = validateRunArgs({
        url: options.url,
        debug: options.debug,
        headless: options.headless,
      })

      if (!validated.ok) {
        program.error(validated.message, { exitCode: 2 })
        return
      }

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

      const runId = randomUUID()
      writeOutLine(writeErr, `runId=${runId}`)
      writeOutLine(writeErr, `baseUrl=${sanitizeBaseUrlForLog(validated.value.baseUrl)}`)
      writeOutLine(writeErr, `headless=${validated.value.headless}`)
      writeOutLine(writeErr, `debug=${validated.value.debug}`)

      if (validated.value.debug) {
        writeOutLine(writeErr, `node=${process.version}`)
      }

      const preflight = await runPreflight({
        baseUrl: validated.value.baseUrl,
        headless: validated.value.headless,
        debug: validated.value.debug,
      })

      if (!preflight.ok) {
        program.error(preflight.message, { exitCode: 2 })
        return
      }

      if (validated.value.debug && preflight.playwrightVersion) {
        writeOutLine(writeErr, `playwrightVersion=${preflight.playwrightVersion}`)
      }

      if (validated.value.debug && preflight.chromiumVersion) {
        writeOutLine(writeErr, `chromiumVersion=${preflight.chromiumVersion}`)
      }

      for (const specPath of result.specs) {
        writeOutLine(writeOut, specPath)
      }
    })
}
