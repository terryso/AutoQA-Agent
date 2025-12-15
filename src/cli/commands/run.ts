import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { Command } from 'commander'

import { isUserCorrectableFsError } from '../fs-errors.js'

import { writeOutLine } from '../output.js'

import { discoverMarkdownSpecs } from '../../specs/discover.js'
import { validateRunArgs } from '../../runner/validate-run-args.js'
import { runSpecs } from '../../runner/run-specs.js'
import { parseMarkdownSpec } from '../../markdown/parse-markdown-spec.js'
import type { MarkdownSpec } from '../../markdown/spec-types.js'
import { runAgent } from '../../agent/run-agent.js'
import { probeAgentSdkAuth, type AgentSdkAuthProbeResult } from '../../auth/probe.js'
import { createLogger, ensureArtifactDir, getArtifactRootPath } from '../../logging/index.js'

function sanitizeBaseUrlForLog(baseUrl: string): string {
  try {
    const url = new URL(baseUrl)
    return url.origin
  } catch {
    return baseUrl
  }
}

function hasAnthropicApiKey(): boolean {
  const apiKey = process.env.ANTHROPIC_API_KEY
  return typeof apiKey === 'string' && apiKey.length > 0
}

export function registerRunCommand(program: Command) {
  program
    .command('run')
    .description('Discover Markdown specs under a file or directory and run them')
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
      const cwd = process.cwd()
      const artifactRoot = getArtifactRootPath(cwd, runId)

      await ensureArtifactDir(cwd, runId)

      const logger = createLogger({ runId, cwd, debug: validated.value.debug })

      writeOutLine(writeErr, `runId=${runId}`)
      writeOutLine(writeErr, `baseUrl=${sanitizeBaseUrlForLog(validated.value.baseUrl)}`)
      writeOutLine(writeErr, `headless=${validated.value.headless}`)
      writeOutLine(writeErr, `debug=${validated.value.debug}`)
      writeOutLine(writeErr, `artifactRoot=${artifactRoot}`)

      if (validated.value.debug) {
        writeOutLine(writeErr, `node=${process.version}`)
      }

      const parsedSpecs: Array<{ specPath: string; spec: MarkdownSpec }> = []

      for (const specPath of result.specs) {
        let markdown: string
        try {
          markdown = readFileSync(specPath, 'utf8')
        } catch (err: unknown) {
          if (isUserCorrectableFsError(err)) {
            program.error(`Failed to read spec: ${specPath}`, { exitCode: 2 })
            return
          }

          program.error(`Failed to read spec: ${specPath}`)
          return
        }

        let parsed: ReturnType<typeof parseMarkdownSpec>
        try {
          parsed = parseMarkdownSpec(markdown)
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err)
          program.error(`Failed to parse spec: ${specPath}\n${message}`, { exitCode: 1 })
          return
        }

        if (!parsed.ok) {
          program.error(
            `Invalid spec structure: ${specPath}\ncode=${parsed.error.code}\n${parsed.error.message}`,
            { exitCode: 2 },
          )
          return
        }

        parsedSpecs.push({ specPath, spec: parsed.value })
      }

      if (validated.value.debug) {
        writeOutLine(writeErr, `parsedSpecs=${parsedSpecs.length}`)
        for (const p of parsedSpecs) {
          writeOutLine(writeErr, `spec=${p.specPath}`)
          writeOutLine(writeErr, `preconditions=${p.spec.preconditions.length}`)
          writeOutLine(writeErr, `steps=${p.spec.steps.length}`)
        }
      }

      if (!hasAnthropicApiKey()) {
        let probeResult: AgentSdkAuthProbeResult
        try {
          probeResult = await probeAgentSdkAuth()
        } catch {
          probeResult = { kind: 'unknown' }
        }

        if (validated.value.debug) {
          writeOutLine(writeErr, `auth=${probeResult.kind}`)
        }

        if (probeResult.kind === 'authentication_failed') {
          program.error(
            '未检测到 Claude Code 授权，且未设置 ANTHROPIC_API_KEY。请先完成 Claude Code 本地授权或设置 ANTHROPIC_API_KEY。',
            { exitCode: 2 },
          )
          return
        }
      }

      const runStartTime = Date.now()

      logger.log({
        event: 'autoqa.run.started',
        runId,
        baseUrl: sanitizeBaseUrlForLog(validated.value.baseUrl),
        headless: validated.value.headless,
        debug: validated.value.debug,
        artifactRoot,
        specCount: parsedSpecs.length,
      })

      const runResult = await runSpecs({
        runId,
        baseUrl: validated.value.baseUrl,
        headless: validated.value.headless,
        debug: validated.value.debug,
        specs: parsedSpecs,
        logger,
        onSpec: async ({ runId, baseUrl, specPath, spec, page, logger }) => {
          await runAgent({
            runId,
            baseUrl,
            debug: validated.value.debug,
            specPath,
            spec,
            page,
            cwd,
            logger,
          })
        },
      })

      if (!runResult.ok) {
        const exitCode = runResult.code === 'SPEC_EXECUTION_FAILED' ? 1 : 2

        logger.log({
          event: 'autoqa.run.finished',
          runId,
          exitCode,
          durationMs: Date.now() - runStartTime,
          specsPassed: runResult.specsPassed ?? 0,
          specsFailed: runResult.specsFailed ?? 1,
          failureSummary: runResult.message,
        })

        await logger.flush()
        program.error(runResult.message, { exitCode })
        return
      }

      if (validated.value.debug && runResult.playwrightVersion) {
        writeOutLine(writeErr, `playwrightVersion=${runResult.playwrightVersion}`)
      }

      if (validated.value.debug && runResult.chromiumVersion) {
        writeOutLine(writeErr, `chromiumVersion=${runResult.chromiumVersion}`)
      }

      logger.log({
        event: 'autoqa.run.finished',
        runId,
        exitCode: 0,
        durationMs: Date.now() - runStartTime,
        specsPassed: parsedSpecs.length,
        specsFailed: 0,
      })

      await logger.flush()

      for (const specPath of result.specs) {
        writeOutLine(writeOut, specPath)
      }
    })
}
