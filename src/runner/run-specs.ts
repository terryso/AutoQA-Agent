import { createRequire } from 'node:module'
import { basename, relative } from 'node:path'

import type { BrowserContext, Page } from 'playwright'

import type { MarkdownSpec } from '../markdown/spec-types.js'
import { createBrowser } from '../browser/create-browser.js'
import { captureJpegScreenshot, writeRunScreenshot } from '../browser/screenshot.js'
import type { Logger } from '../logging/index.js'
import {
  generateTraceName,
  getTracePath,
  getRelativeTracePath,
  ensureTraceDir,
} from './trace-paths.js'
import { exportPlaywrightTest } from './export-playwright-test.js'
import { getRelativeExportPath } from './export-paths.js'

type ArtifactMode = 'all' | 'fail' | 'none'

function getArtifactMode(): ArtifactMode {
  const raw = (process.env.AUTOQA_ARTIFACTS ?? '').trim().toLowerCase()
  if (raw === 'all' || raw === 'fail' || raw === 'none') return raw
  return 'fail'
}

function shouldPersistArtifacts(mode: ArtifactMode, ok: boolean): boolean {
  if (mode === 'all') return true
  if (mode === 'none') return false
  return !ok
}

/**
 * Variables used in a step (from raw/unrendered spec text).
 */
export type StepVarInfo = {
  /** Variable names used in this step (e.g., ['USERNAME', 'PASSWORD']) */
  vars: string[]
  /** Raw (unrendered) step text */
  rawText: string
}

export type ParsedSpec = {
  specPath: string
  spec: MarkdownSpec
  /** Raw (unrendered) spec content for extracting {{VAR}} placeholders */
  rawContent?: string
  /** Map of stepIndex -> variables used in that step */
  stepVarsMap?: Map<number, StepVarInfo>
}

export type RunSpecFn = (input: {
  runId: string
  baseUrl: string
  specPath: string
  spec: MarkdownSpec
  page: Page
  logger: Logger
  /** Map of stepIndex -> variables used in that step */
  stepVarsMap?: Map<number, StepVarInfo>
}) => Promise<void> | void

export type RunSpecsOptions = {
  runId: string
  baseUrl: string
  loginBaseUrl?: string
  headless: boolean
  debug: boolean
  specs: ParsedSpec[]
  logger: Logger
  cwd: string
  onSpec?: RunSpecFn
  /** Custom export directory (relative to cwd), defaults to 'tests/autoqa' */
  exportDir?: string
}

export type RunSpecsFailureCode =
  | 'BROWSER_LAUNCH_FAILED'
  | 'CONTEXT_CREATE_FAILED'
  | 'PAGE_CREATE_FAILED'
  | 'SPEC_EXECUTION_FAILED'
  | 'RUN_FAILED'

export type SpecTraceInfo = {
  specPath: string
  tracePath: string
}

export type SpecExportInfo = {
  specPath: string
  exportPath: string
  ok: boolean
  reason?: string
}

export type RunSpecsResult =
  | { ok: true; chromiumVersion?: string; playwrightVersion?: string; specsPassed: number; specsFailed: number; traces: SpecTraceInfo[]; exports: SpecExportInfo[] }
  | {
      ok: false
      code: RunSpecsFailureCode
      message: string
      cause?: unknown
      specsPassed?: number
      specsFailed?: number
      failedSpecPath?: string
      failureScreenshotPath?: string
      traces?: SpecTraceInfo[]
      exports?: SpecExportInfo[]
    }

function getPlaywrightVersion(): string | undefined {
  const require = createRequire(import.meta.url)
  try {
    const pkg = require('playwright/package.json')
    return typeof pkg?.version === 'string' ? pkg.version : undefined
  } catch {
    return undefined
  }
}

function formatCauseSuffix(err: unknown): string {
  if (!err || typeof err !== 'object') return ''
  const anyErr = err as any

  const code = anyErr?.code
  const codePart = typeof code === 'string' ? ` (${code})` : ''

  const message = anyErr?.message
  const msgPart = typeof message === 'string' && message.length > 0 ? `: ${message}` : ''

  return `${codePart}${msgPart}`
}

function toRelativeSpecPath(specPath: string, cwd: string): string {
  return specPath.startsWith(cwd) ? relative(cwd, specPath) : basename(specPath)
}

function getErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined
  const code = (err as any)?.code
  return typeof code === 'string' ? code : undefined
}

function setRunSpecsCode(err: unknown, code: RunSpecsFailureCode): unknown {
  if (!err || typeof err !== 'object') return { __runSpecsCode: code, message: String(err) }
  try {
    ;(err as any).__runSpecsCode = code
  } catch {
    return { __runSpecsCode: code, message: (err as any)?.message ?? String(err) }
  }
  return err
}

function getRunSpecsCode(err: unknown): RunSpecsFailureCode | undefined {
  if (!err || typeof err !== 'object') return undefined
  const code = (err as any)?.__runSpecsCode
  return typeof code === 'string' ? (code as RunSpecsFailureCode) : undefined
}

async function safeClose(closeable: { close: () => unknown } | undefined): Promise<void> {
  if (!closeable) return
  try {
    await closeable.close()
  } catch {
    return
  }
}

type TracingOutcome = { ok: true } | { ok: false; errorCode?: string }

function formatTracingError(prefix: 'TRACING_START_FAILED' | 'TRACING_STOP_FAILED', errorCode?: string): string {
  return errorCode ? `${prefix} (${errorCode})` : prefix
}

async function safeTracingStart(context: BrowserContext): Promise<TracingOutcome> {
  try {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
    return { ok: true }
  } catch (err: unknown) {
    return { ok: false, errorCode: getErrorCode(err) }
  }
}

async function safeTracingStop(context: BrowserContext, tracePath?: string): Promise<TracingOutcome> {
  try {
    await context.tracing.stop(tracePath ? { path: tracePath } : undefined)
    return { ok: true }
  } catch (err: unknown) {
    return { ok: false, errorCode: getErrorCode(err) }
  }
}

export async function runSpecs(options: RunSpecsOptions): Promise<RunSpecsResult> {
  let browserResult: Awaited<ReturnType<typeof createBrowser>> | undefined
  const { logger, cwd } = options
  const traces: SpecTraceInfo[] = []
  const exports: SpecExportInfo[] = []
  const artifactMode = getArtifactMode()
  let failureScreenshotPath: string | undefined

  try {
    browserResult = await createBrowser({
      headless: options.headless,
      slowMo: options.debug ? 75 : undefined,
    })
  } catch (err: unknown) {
    return {
      ok: false,
      code: 'BROWSER_LAUNCH_FAILED',
      message: `Failed to launch browser with Playwright${formatCauseSuffix(err)}`,
      cause: err,
      specsPassed: 0,
      specsFailed: 0,
      traces: [],
    }
  }

  let activeSpecPath: string | undefined
  let specsPassed = 0
  let specsFailed = 0

  try {
    const browser = browserResult.browser
    const persistentContext = browserResult.persistentContext

    const chromiumVersion = options.debug ? browser.version() : undefined
    const playwrightVersion = options.debug ? getPlaywrightVersion() : undefined

    for (let specIndex = 0; specIndex < options.specs.length; specIndex++) {
      const spec = options.specs[specIndex]
      activeSpecPath = spec.specPath
      const specStartTime = Date.now()

      let specOk: boolean | undefined
      let failureReason: string | undefined
      let tracingError: string | undefined
      let specFinishedLogged = false

      logger.log({
        event: 'autoqa.spec.started',
        runId: options.runId,
        specPath: spec.specPath,
      })

      let context: BrowserContext | undefined
      try {
        if (persistentContext) {
          context = persistentContext
        } else {
          context = await browser.newContext(
            options.debug
              ? {
                viewport: null,
              }
              : {
                viewport: {
                  width: 1440,
                  height: 900,
                },
              },
          )
        }
      } catch (err: unknown) {
        specsFailed++
        logger.log({
          event: 'autoqa.spec.finished',
          runId: options.runId,
          specPath: spec.specPath,
          durationMs: Date.now() - specStartTime,
          ok: false,
          failureReason: `CONTEXT_CREATE_FAILED: ${formatCauseSuffix(err)}`,
        })
        specFinishedLogged = true
        throw setRunSpecsCode(err, 'CONTEXT_CREATE_FAILED')
      }

      const traceName = generateTraceName(specIndex, spec.specPath, cwd)
      const traceRelPath = getRelativeTracePath(cwd, options.runId, traceName)
      let traceAbsPath: string | undefined

      let tracingStarted = false
      let tracingStopped = false

      let page: Page | undefined

      try {
        if (artifactMode !== 'none') {
          const startOutcome = await safeTracingStart(context)
          tracingStarted = startOutcome.ok
          if (!startOutcome.ok) {
            tracingError = formatTracingError('TRACING_START_FAILED', startOutcome.errorCode)
          }
        }

        try {
          page = await context.newPage()
        } catch (err: unknown) {
          specsFailed++
          specOk = false
          failureReason = `PAGE_CREATE_FAILED: ${formatCauseSuffix(err)}`
          throw setRunSpecsCode(err, 'PAGE_CREATE_FAILED')
        }

        try {
          await options.onSpec?.({
            runId: options.runId,
            baseUrl: options.baseUrl,
            specPath: spec.specPath,
            spec: spec.spec,
            page,
            logger,
            stepVarsMap: spec.stepVarsMap,
          })
          specsPassed++
          specOk = true
        } catch (err: unknown) {
          specsFailed++
          specOk = false
          failureReason = `SPEC_EXECUTION_FAILED: ${formatCauseSuffix(err)}`

          if (page && shouldPersistArtifacts(artifactMode, false)) {
            try {
              const captureResult = await captureJpegScreenshot(page, { quality: 60 })
              if (captureResult.ok) {
                const screenshotPath = await writeRunScreenshot({
                  cwd,
                  runId: options.runId,
                  fileBaseName: `failure-${traceName}`,
                  buffer: captureResult.value.buffer,
                })
                failureScreenshotPath = screenshotPath
                logger.log({
                  event: 'autoqa.spec.failure_screenshot',
                  runId: options.runId,
                  specPath: spec.specPath,
                  screenshotPath,
                })
              }
            } catch {
            }
          }

          throw setRunSpecsCode(err, 'SPEC_EXECUTION_FAILED')
        }
      } finally {
        await safeClose(page)

        if (tracingStarted && context) {
          const ok = specOk ?? false
          const shouldPersistTrace = shouldPersistArtifacts(artifactMode, ok)

          if (shouldPersistTrace) {
            try {
              await ensureTraceDir(cwd, options.runId)
              traceAbsPath = getTracePath(cwd, options.runId, traceName)
            } catch {
              traceAbsPath = undefined
            }
          }

          const stopOutcome = await safeTracingStop(context, traceAbsPath)
          tracingStopped = stopOutcome.ok && Boolean(traceAbsPath)
          if (!stopOutcome.ok) {
            tracingError = formatTracingError('TRACING_STOP_FAILED', stopOutcome.errorCode)
          } else if (tracingStopped) {
            traces.push({ specPath: spec.specPath, tracePath: traceRelPath })
          }
        }

        if (context && context !== persistentContext) {
          await safeClose(context)
        }

        if (!specFinishedLogged) {
          const ok = specOk ?? false
          logger.log({
            event: 'autoqa.spec.finished',
            runId: options.runId,
            specPath: spec.specPath,
            durationMs: Date.now() - specStartTime,
            ok,
            ...(failureReason ? { failureReason } : {}),
            ...(tracingStopped ? { tracePath: traceRelPath } : {}),
            ...(tracingError ? { tracingError } : {}),
          })
        }

        // Export Playwright test if spec succeeded
        if (specOk) {
          try {
            const exportResult = await exportPlaywrightTest({
              cwd,
              runId: options.runId,
              specPath: spec.specPath,
              spec: spec.spec,
              baseUrl: options.baseUrl,
              loginBaseUrl: options.loginBaseUrl,
              rawSpecContent: spec.rawContent,
              exportDir: options.exportDir,
            })

            if (exportResult.ok) {
              const relativeExportPath = exportResult.relativePath
              exports.push({
                specPath: spec.specPath,
                exportPath: relativeExportPath,
                ok: true,
              })

              logger.log({
                event: 'autoqa.spec.exported',
                runId: options.runId,
                specPath: spec.specPath,
                exportPath: relativeExportPath,
              })
            } else {
              const relativeExportPath = getRelativeExportPath(cwd, spec.specPath, options.exportDir)
              exports.push({
                specPath: spec.specPath,
                exportPath: relativeExportPath,
                ok: false,
                reason: exportResult.reason,
              })

              logger.log({
                event: 'autoqa.spec.export_failed',
                runId: options.runId,
                specPath: spec.specPath,
                reason: exportResult.reason,
                ...(exportResult.missingLocators ? { missingLocators: exportResult.missingLocators } : {}),
              })
            }
          } catch (exportErr: unknown) {
            // Export failure should not crash the run
            const exportErrMsg = exportErr instanceof Error ? exportErr.message : String(exportErr)
            exports.push({
              specPath: spec.specPath,
              exportPath: getRelativeExportPath(cwd, spec.specPath, options.exportDir),
              ok: false,
              reason: `Export error: ${exportErrMsg}`,
            })

            logger.log({
              event: 'autoqa.spec.export_failed',
              runId: options.runId,
              specPath: spec.specPath,
              reason: `Export error: ${exportErrMsg}`,
            })
          }
        }
      }
    }

    return { ok: true, chromiumVersion, playwrightVersion, specsPassed, specsFailed, traces, exports }
  } catch (err: unknown) {
    const relativeSpecPath = activeSpecPath ? toRelativeSpecPath(activeSpecPath, cwd) : undefined
    const specPart = relativeSpecPath ? `: ${relativeSpecPath}` : ''
    return {
      ok: false,
      code: getRunSpecsCode(err) ?? 'RUN_FAILED',
      message: `Failed to run spec${specPart}${formatCauseSuffix(err)}`,
      cause: err,
      specsPassed,
      specsFailed,
      failedSpecPath: relativeSpecPath,
      failureScreenshotPath,
      traces,
      exports,
    }
  } finally {
    if (browserResult?.persistentContext) {
      await safeClose(browserResult.persistentContext)
    } else {
      await safeClose(browserResult?.browser)
    }
  }
}
