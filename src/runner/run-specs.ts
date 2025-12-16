import { createRequire } from 'node:module'

import type { BrowserContext, Page } from 'playwright'

import type { MarkdownSpec } from '../markdown/spec-types.js'
import { createBrowser } from '../browser/create-browser.js'
import type { Logger } from '../logging/index.js'
import {
  generateTraceName,
  getTracePath,
  getRelativeTracePath,
  ensureTraceDir,
} from './trace-paths.js'

export type ParsedSpec = {
  specPath: string
  spec: MarkdownSpec
}

export type RunSpecFn = (input: {
  runId: string
  baseUrl: string
  specPath: string
  spec: MarkdownSpec
  page: Page
  logger: Logger
}) => Promise<void> | void

export type RunSpecsOptions = {
  runId: string
  baseUrl: string
  headless: boolean
  debug: boolean
  specs: ParsedSpec[]
  logger: Logger
  cwd: string
  onSpec?: RunSpecFn
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

export type RunSpecsResult =
  | { ok: true; chromiumVersion?: string; playwrightVersion?: string; specsPassed: number; specsFailed: number; traces: SpecTraceInfo[] }
  | { ok: false; code: RunSpecsFailureCode; message: string; cause?: unknown; specsPassed?: number; specsFailed?: number; traces?: SpecTraceInfo[] }

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

async function safeTracingStop(context: BrowserContext, tracePath: string): Promise<TracingOutcome> {
  try {
    await context.tracing.stop({ path: tracePath })
    return { ok: true }
  } catch (err: unknown) {
    return { ok: false, errorCode: getErrorCode(err) }
  }
}

export async function runSpecs(options: RunSpecsOptions): Promise<RunSpecsResult> {
  let browser: Awaited<ReturnType<typeof createBrowser>> | undefined
  const { logger, cwd } = options
  const traces: SpecTraceInfo[] = []

  try {
    browser = await createBrowser({
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
    const chromiumVersion = options.debug ? browser.version() : undefined
    const playwrightVersion = options.debug ? getPlaywrightVersion() : undefined

    try {
      await ensureTraceDir(cwd, options.runId)
    } catch {
      // ignore - tracing will fail gracefully later
    }

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
      const traceAbsPath = getTracePath(cwd, options.runId, traceName)
      const traceRelPath = getRelativeTracePath(cwd, options.runId, traceName)

      let tracingStarted = false
      let tracingStopped = false

      let page: Page | undefined

      try {
        const startOutcome = await safeTracingStart(context)
        tracingStarted = startOutcome.ok
        if (!startOutcome.ok) {
          tracingError = formatTracingError('TRACING_START_FAILED', startOutcome.errorCode)
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
          })
          specsPassed++
          specOk = true
        } catch (err: unknown) {
          specsFailed++
          specOk = false
          failureReason = `SPEC_EXECUTION_FAILED: ${formatCauseSuffix(err)}`
          throw setRunSpecsCode(err, 'SPEC_EXECUTION_FAILED')
        }
      } finally {
        await safeClose(page)

        if (tracingStarted && context) {
          const stopOutcome = await safeTracingStop(context, traceAbsPath)
          tracingStopped = stopOutcome.ok
          if (!stopOutcome.ok) {
            tracingError = formatTracingError('TRACING_STOP_FAILED', stopOutcome.errorCode)
          } else {
            traces.push({ specPath: spec.specPath, tracePath: traceRelPath })
          }
        }

        await safeClose(context)

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
      }
    }

    return { ok: true, chromiumVersion, playwrightVersion, specsPassed, specsFailed, traces }
  } catch (err: unknown) {
    const specPart = activeSpecPath ? `: ${activeSpecPath}` : ''
    return {
      ok: false,
      code: getRunSpecsCode(err) ?? 'RUN_FAILED',
      message: `Failed to run spec${specPart}${formatCauseSuffix(err)}`,
      cause: err,
      specsPassed,
      specsFailed,
      traces,
    }
  } finally {
    await safeClose(browser)
  }
}
