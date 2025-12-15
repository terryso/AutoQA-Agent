import { createRequire } from 'node:module'

import type { BrowserContext, Page } from 'playwright'

import type { MarkdownSpec } from '../markdown/spec-types.js'
import { createBrowser } from '../browser/create-browser.js'
import type { Logger } from '../logging/index.js'

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
  onSpec?: RunSpecFn
}

export type RunSpecsFailureCode =
  | 'BROWSER_LAUNCH_FAILED'
  | 'CONTEXT_CREATE_FAILED'
  | 'PAGE_CREATE_FAILED'
  | 'SPEC_EXECUTION_FAILED'
  | 'RUN_FAILED'

export type RunSpecsResult =
  | { ok: true; chromiumVersion?: string; playwrightVersion?: string; specsPassed: number; specsFailed: number }
  | { ok: false; code: RunSpecsFailureCode; message: string; cause?: unknown; specsPassed?: number; specsFailed?: number }

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

export async function runSpecs(options: RunSpecsOptions): Promise<RunSpecsResult> {
  let browser: Awaited<ReturnType<typeof createBrowser>> | undefined
  const { logger } = options

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
    }
  }

  let activeSpecPath: string | undefined
  let specsPassed = 0
  let specsFailed = 0

  try {
    const chromiumVersion = options.debug ? browser.version() : undefined
    const playwrightVersion = options.debug ? getPlaywrightVersion() : undefined

    for (const spec of options.specs) {
      activeSpecPath = spec.specPath
      const specStartTime = Date.now()

      logger.log({
        event: 'autoqa.spec.started',
        runId: options.runId,
        specPath: spec.specPath,
      })

      let context: BrowserContext | undefined
      try {
        context = await browser.newContext({
          viewport: {
            width: 1024,
            height: 768,
          },
        })
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
        throw setRunSpecsCode(err, 'CONTEXT_CREATE_FAILED')
      }

      let page: Page | undefined

      try {
        try {
          page = await context.newPage()
        } catch (err: unknown) {
          specsFailed++
          logger.log({
            event: 'autoqa.spec.finished',
            runId: options.runId,
            specPath: spec.specPath,
            durationMs: Date.now() - specStartTime,
            ok: false,
            failureReason: `PAGE_CREATE_FAILED: ${formatCauseSuffix(err)}`,
          })
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
          logger.log({
            event: 'autoqa.spec.finished',
            runId: options.runId,
            specPath: spec.specPath,
            durationMs: Date.now() - specStartTime,
            ok: true,
          })
        } catch (err: unknown) {
          specsFailed++
          logger.log({
            event: 'autoqa.spec.finished',
            runId: options.runId,
            specPath: spec.specPath,
            durationMs: Date.now() - specStartTime,
            ok: false,
            failureReason: `SPEC_EXECUTION_FAILED: ${formatCauseSuffix(err)}`,
          })
          throw setRunSpecsCode(err, 'SPEC_EXECUTION_FAILED')
        }
      } finally {
        await safeClose(page)
        await safeClose(context)
      }
    }

    return { ok: true, chromiumVersion, playwrightVersion, specsPassed, specsFailed }
  } catch (err: unknown) {
    const specPart = activeSpecPath ? `: ${activeSpecPath}` : ''
    return {
      ok: false,
      code: getRunSpecsCode(err) ?? 'RUN_FAILED',
      message: `Failed to run spec${specPart}${formatCauseSuffix(err)}`,
      cause: err,
      specsPassed,
      specsFailed,
    }
  } finally {
    await safeClose(browser)
  }
}
