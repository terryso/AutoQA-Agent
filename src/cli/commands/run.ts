import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { Command } from 'commander'

import { isUserCorrectableFsError } from '../fs-errors.js'

import { writeOutLine } from '../output.js'

import { discoverMarkdownSpecs } from '../../specs/discover.js'
import { validateRunArgs } from '../../runner/validate-run-args.js'
import { runSpecs, type StepVarInfo } from '../../runner/run-specs.js'
import type { ParsedSpec } from '../../runner/run-specs.js'
import { parseMarkdownSpec, classifyStepKind } from '../../markdown/parse-markdown-spec.js'
import { renderMarkdownTemplate } from '../../markdown/template.js'
import { expandIncludes, getIncludeRoot } from '../../markdown/include.js'
import type { MarkdownSpec } from '../../markdown/spec-types.js'
import { runAgent } from '../../agent/run-agent.js'
import { probeAgentSdkAuth, type AgentSdkAuthProbeResult } from '../../auth/probe.js'
import { createLogger, ensureArtifactDir, getArtifactRootPath } from '../../logging/index.js'
import { readConfig, resolveGuardrails } from '../../config/read.js'
import { loadEnvFiles } from '../../env/load-env.js'

const TEMPLATE_VAR_PATTERN = /\{\{\s*([A-Z0-9_]+)\s*\}\}/g

function extractTemplateVars(text: string): string[] {
  const vars: string[] = []
  let match: RegExpExecArray | null
  const pattern = new RegExp(TEMPLATE_VAR_PATTERN.source, 'g')
  while ((match = pattern.exec(text)) !== null) {
    const varName = (match[1] ?? '').trim()
    if (varName && !vars.includes(varName)) {
      vars.push(varName)
    }
  }
  return vars
}

function parseStepVarsFromRawContent(rawContent: string): Map<number, StepVarInfo> {
  const stepVars = new Map<number, StepVarInfo>()
  const stepsMatch = rawContent.match(/##\s*Steps[\s\S]*?(?=##|$)/i)
  if (!stepsMatch) return stepVars

  const stepsSection = stepsMatch[0]
  const stepPattern = /^\s*(\d+)[.)\s]+(.+)$/gm
  let match: RegExpExecArray | null
  while ((match = stepPattern.exec(stepsSection)) !== null) {
    const stepIndex = parseInt(match[1], 10)
    const rawText = match[2].trim()
    const vars = extractTemplateVars(rawText)
    stepVars.set(stepIndex, { vars, rawText })
  }
  return stepVars
}

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

type ArtifactMode = 'all' | 'fail' | 'none'

function getArtifactMode(): ArtifactMode {
  const raw = (process.env.AUTOQA_ARTIFACTS ?? '').trim().toLowerCase()
  if (raw === 'all' || raw === 'fail' || raw === 'none') return raw
  return 'fail'
}

function shouldWriteToFileForOutcome(mode: ArtifactMode, ok: boolean): boolean {
  if (mode === 'all') return true
  if (mode === 'none') return false
  return !ok
}

function toSingleLine(value: string): string {
  return value.replace(/\r?\n/g, ' ')
}

export function registerRunCommand(program: Command) {
  program
    .command('run')
    .description('Discover Markdown specs under a file or directory and run them')
    .argument('<file-or-dir>', 'Markdown spec file or directory containing Markdown specs')
    .option('--env <name>', 'Environment name used to load .env.<name> (e.g. test, prod)')
    .option('--url <baseUrl>', 'Base URL to test against (e.g. http://localhost:3000)')
    .option('--login-url <loginBaseUrl>', 'Login Base URL (optional, e.g. https://login.example.com)')
    .option('--debug', 'Run in debug mode (headed browser + extra logs)')
    .option('--headless', 'Force headless mode (conflicts with --debug)')
    .action(async (fileOrDir: string, options: { env?: string; url?: string; loginUrl?: string; debug?: boolean; headless?: boolean }) => {
      const { writeOut, writeErr } = program.configureOutput()

      const envLoad = loadEnvFiles({ envName: options.env, requireEnvNameFile: Boolean(options.env) })
      if (!envLoad.ok) {
        program.error(envLoad.message, { exitCode: 2 })
        return
      }

      const resolvedEnvName = (options.env ?? process.env.AUTOQA_ENV ?? '').trim()

      const baseUrlRaw = options.url ?? process.env.AUTOQA_BASE_URL
      const loginUrlRaw = options.loginUrl ?? process.env.AUTOQA_LOGIN_BASE_URL

      const validated = validateRunArgs({
        url: baseUrlRaw,
        loginUrl: loginUrlRaw,
        debug: options.debug,
        headless: options.headless,
      })

      if (!validated.ok) {
        program.error(validated.message, { exitCode: 2 })
        return
      }

      const inputPath = resolve(fileOrDir)

      const configResult = readConfig()
      if (!configResult.ok) {
        program.error(configResult.error.message, { exitCode: 2 })
        return
      }

      const guardrails = resolveGuardrails(configResult.config)

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

      const artifactMode = getArtifactMode()
      const initialWriteToFile = artifactMode === 'all'
      if (initialWriteToFile) {
        await ensureArtifactDir(cwd, runId)
      }

      const logger = createLogger({ runId, cwd, debug: validated.value.debug, writeToFile: initialWriteToFile })

      writeOutLine(writeErr, `runId=${runId}`)
      writeOutLine(writeErr, `baseUrl=${sanitizeBaseUrlForLog(validated.value.baseUrl)}`)
      if (validated.value.loginBaseUrl) {
        writeOutLine(writeErr, `loginBaseUrl=${sanitizeBaseUrlForLog(validated.value.loginBaseUrl)}`)
      }
      if (resolvedEnvName) {
        writeOutLine(writeErr, `env=${resolvedEnvName}`)
      }
      writeOutLine(writeErr, `headless=${validated.value.headless}`)
      writeOutLine(writeErr, `debug=${validated.value.debug}`)
      writeOutLine(writeErr, `artifactRoot=${artifactRoot}`)

      if (validated.value.debug) {
        writeOutLine(writeErr, `node=${process.version}`)
      }

      const parsedSpecs: ParsedSpec[] = []

      const includeRoot = getIncludeRoot(inputPath, result.inputIsDirectory)

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
          program.error(`Failed to parse spec: ${specPath}\n${message}`, { exitCode: 2 })
          return
        }

        if (!parsed.ok) {
          program.error(
            `Invalid spec structure: ${specPath}\ncode=${parsed.error.code}\n${parsed.error.message}`,
            { exitCode: 2 },
          )
          return
        }

        const stepTexts = parsed.value.steps.map((s) => s.text)

        const readIncludeFile = (path: string): string | null => {
          try {
            return readFileSync(path, 'utf8')
          } catch {
            return null
          }
        }

        const expandResult = expandIncludes(stepTexts, includeRoot, readIncludeFile)

        if (!expandResult.ok) {
          program.error(
            `Include expansion failed in spec: ${specPath}\ncode=${expandResult.error.code}\n${expandResult.error.message}`,
            { exitCode: 2 },
          )
          return
        }

        const expandedStepTexts = expandResult.value

        const templateVars = {
          BASE_URL: validated.value.baseUrl,
          LOGIN_BASE_URL: validated.value.loginBaseUrl,
          ENV: resolvedEnvName,
          USERNAME: process.env.AUTOQA_USERNAME,
          PASSWORD: process.env.AUTOQA_PASSWORD,
        }

        const templateCheckWholeSpec = renderMarkdownTemplate(markdown, templateVars)
        if (!templateCheckWholeSpec.ok) {
          program.error(`Invalid spec template: ${specPath}\n${templateCheckWholeSpec.message}`, { exitCode: 2 })
          return
        }

        const rawExpandedContentForExport =
          `## Preconditions\n` +
          parsed.value.preconditions.map((t) => `- ${t}`).join('\n') +
          `\n\n## Steps\n` +
          expandedStepTexts.map((t, idx) => `${idx + 1}. ${t}`).join('\n') +
          `\n`

        const allTextsToRender = [...parsed.value.preconditions, ...expandedStepTexts]
        const combinedMarkdown = allTextsToRender.join('\n')
        const templateCheck = renderMarkdownTemplate(combinedMarkdown, templateVars)

        if (!templateCheck.ok) {
          program.error(`Invalid spec template: ${specPath}\n${templateCheck.message}`, { exitCode: 2 })
          return
        }

        const renderedSteps = expandedStepTexts.map((text) => {
          const rendered = renderMarkdownTemplate(text, templateVars)
          return rendered.ok ? rendered.value : text
        })

        const renderedPreconditions = parsed.value.preconditions.map((text) => {
          const rendered = renderMarkdownTemplate(text, templateVars)
          return rendered.ok ? rendered.value : text
        })

        const finalSpec: MarkdownSpec = {
          preconditions: renderedPreconditions,
          steps: renderedSteps.map((text, idx) => ({
            index: idx + 1,
            text,
            kind: classifyStepKind(text),
          })),
        }

        const stepVarsMap = parseStepVarsFromRawContent(rawExpandedContentForExport)
        parsedSpecs.push({ specPath, spec: finalSpec, rawContent: rawExpandedContentForExport, stepVarsMap })
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
        loginBaseUrl: validated.value.loginBaseUrl,
        headless: validated.value.headless,
        debug: validated.value.debug,
        specs: parsedSpecs,
        logger,
        cwd,
        exportDir: configResult.config.exportDir,
        onSpec: async ({ runId, baseUrl, specPath, spec, page, logger, stepVarsMap }) => {
          await runAgent({
            runId,
            baseUrl,
            debug: validated.value.debug,
            specPath,
            spec,
            page,
            cwd,
            logger,
            guardrails,
            stepVarsMap,
          })
        },
      })

      if (!runResult.ok) {
        const exitCode = runResult.code === 'SPEC_EXECUTION_FAILED' ? 1 : 2
        const durationMs = Date.now() - runStartTime
        const specsPassed = runResult.specsPassed ?? 0
        const specsFailed = runResult.specsFailed ?? 1

        const failedSpecPath = runResult.failedSpecPath
        const screenshotPath = runResult.failureScreenshotPath

        logger.log({
          event: 'autoqa.run.finished',
          runId,
          exitCode,
          durationMs,
          specsPassed,
          specsFailed,
          failureSummary: runResult.message,
        })

        await logger.flush()

        if (shouldWriteToFileForOutcome(artifactMode, false)) {
          await ensureArtifactDir(cwd, runId)
          await logger.persistToFile?.()
        }

        const logPath = logger.logPath

        writeOutLine(writeErr, `specsPassed=${specsPassed}`)
        writeOutLine(writeErr, `specsFailed=${specsFailed}`)
        writeOutLine(writeErr, `durationMs=${durationMs}`)
        if (logPath && artifactMode !== 'none') {
          writeOutLine(writeErr, `logPath=${logPath}`)
        }
        if (artifactMode !== 'none') {
          writeOutLine(writeErr, `snapshotDir=${artifactRoot}/snapshots`)
        }
        if (failedSpecPath) {
          writeOutLine(writeErr, `failedSpecPath=${failedSpecPath}`)
        }
        if (screenshotPath && artifactMode !== 'none') {
          writeOutLine(writeErr, `screenshotsDir=${artifactRoot}/screenshots`)
          writeOutLine(writeErr, `screenshotPath=${screenshotPath}`)
        }
        if (runResult.traces && runResult.traces.length > 0 && artifactMode !== 'none') {
          writeOutLine(writeErr, `traceDir=${artifactRoot}/traces`)
          for (const trace of runResult.traces) {
            writeOutLine(writeErr, `tracePath=${trace.tracePath}`)
          }
        }
        writeOutLine(writeErr, `failureSummary=${toSingleLine(runResult.message)}`)
        program.error(runResult.message, { exitCode })
        return
      }

      const durationMs = Date.now() - runStartTime
      const specsPassed = runResult.specsPassed
      const specsFailed = runResult.specsFailed

      logger.log({
        event: 'autoqa.run.finished',
        runId,
        exitCode: 0,
        durationMs,
        specsPassed,
        specsFailed,
      })

      await logger.flush()

      if (shouldWriteToFileForOutcome(artifactMode, true)) {
        await ensureArtifactDir(cwd, runId)
        await logger.persistToFile?.()
      }

      const logPath = logger.logPath

      if (validated.value.debug && runResult.playwrightVersion) {
        writeOutLine(writeErr, `playwrightVersion=${runResult.playwrightVersion}`)
      }

      if (validated.value.debug && runResult.chromiumVersion) {
        writeOutLine(writeErr, `chromiumVersion=${runResult.chromiumVersion}`)
      }

      writeOutLine(writeErr, `specsPassed=${specsPassed}`)
      writeOutLine(writeErr, `specsFailed=${specsFailed}`)
      writeOutLine(writeErr, `durationMs=${durationMs}`)
      if (logPath && artifactMode !== 'none') {
        writeOutLine(writeErr, `logPath=${logPath}`)
      }
      if (
        runResult.traces &&
        runResult.traces.length > 0 &&
        artifactMode !== 'none' &&
        shouldWriteToFileForOutcome(artifactMode, true)
      ) {
        writeOutLine(writeErr, `traceDir=${artifactRoot}/traces`)
        for (const trace of runResult.traces) {
          writeOutLine(writeErr, `tracePath=${trace.tracePath}`)
        }
      }

      for (const specPath of result.specs) {
        writeOutLine(writeOut, specPath)
      }
    })
}
