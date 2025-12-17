import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

import type { Locator, Page } from 'playwright'

import { click, fill, navigate, scroll, wait, assertTextPresent, assertElementVisible } from '../tools/index.js'
import { toToolError } from '../tools/playwright-error.js'
import type { ContentBlock } from './pre-action-screenshot.js'
import { runWithPreActionScreenshot } from './pre-action-screenshot.js'
import type { Logger } from '../logging/index.js'
import { redactToolInput, sanitizeRelativePath } from '../logging/index.js'
import { captureSnapshots, writeSnapshotsIfNeeded, type SnapshotMeta } from '../browser/snapshot.js'

type ArtifactMode = 'all' | 'fail' | 'none'
type ToolContextMode = 'screenshot' | 'snapshot' | 'none'

function getArtifactMode(): ArtifactMode | undefined {
  const raw = (process.env.AUTOQA_ARTIFACTS ?? '').trim().toLowerCase()
  if (raw === 'all' || raw === 'fail' || raw === 'none') return raw
  return undefined
}

function shouldWriteArtifacts(debug: boolean, toolOk: boolean): boolean {
  const mode = getArtifactMode()
  if (mode === 'all') return true
  if (mode === 'none') return false
  if (mode === 'fail') return !toolOk
  return !toolOk
}

function getToolContextMode(): ToolContextMode {
  const raw = (process.env.AUTOQA_TOOL_CONTEXT ?? '').trim().toLowerCase()
  if (raw === 'screenshot' || raw === 'snapshot' || raw === 'none') return raw
  return 'screenshot'
}

function normalizeToolStringInput(value: string): string {
  const s = (value ?? '').trim()
  if (s.length >= 2 && s.startsWith('`') && s.endsWith('`')) {
    return s.slice(1, -1).trim()
  }
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    return s.slice(1, -1).trim()
  }
  return s
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function isValidSnapshotRef(ref: string): boolean {
  return /^e\d+$/.test(ref)
}

function writeDebug(enabled: boolean, line: string): void {
  if (!enabled) return
  try {
    process.stderr.write(`${line}\n`)
  } catch {
    return
  }
}

function summarizeToolResult(result: { ok: boolean; data?: unknown; error?: any; screenshot?: unknown }): unknown {
  if (result.ok) {
    return {
      ok: true,
      data: result.data,
      screenshot: result.screenshot,
    }
  }

  const err = result.error ?? {}
  return {
    ok: false,
    error: {
      code: err.code,
      message: err.message,
      retriable: err.retriable,
    },
    screenshot: result.screenshot,
  }
}

export type CreateBrowserToolsMcpServerOptions = {
  page: Page
  baseUrl: string
  runId: string
  debug: boolean
  cwd?: string
  specPath: string
  logger: Logger
  onToolCall?: (toolName: string, stepIndex: number | null, isError: boolean) => void
}

function parseStepIndex(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) {
    return value
  }
  if (typeof value === 'string') {
    const s = value.trim()
    if (!/^\d+$/.test(s)) return null
    const parsed = parseInt(s, 10)
    if (!Number.isNaN(parsed) && parsed >= 1) {
      return parsed
    }
  }
  return null
}

 const stepIndexSchema = z
   .preprocess((value) => {
     if (typeof value === 'string') {
       const s = value.trim()
       if (!/^\d+$/.test(s)) return value
       return parseInt(s, 10)
     }
     return value
   }, z.number().int().positive())
   .optional()

const DEFAULT_JPEG_QUALITY = 60

export function createBrowserToolsMcpServer(options: CreateBrowserToolsMcpServerOptions) {
  let counter = 0
  const nextFileBaseName = (toolName: string) => {
    counter += 1
    return `${toolName}-${counter}`
  }

  const { logger, specPath } = options
  const cwd = options.cwd ?? process.cwd()

  function logToolCall(toolName: string, toolInput: Record<string, unknown>, stepIndex: number | null): void {
    logger.log({
      event: 'autoqa.tool.called',
      runId: options.runId,
      specPath,
      toolName,
      stepIndex,
      toolInput: redactToolInput(toolName, toolInput),
    })
  }

  function logToolResult(
    toolName: string,
    startTime: number,
    result: { ok: boolean; error?: any },
    stepIndex: number | null,
    meta: {
      error?: string
      screenshot?: { mimeType?: string; width?: number; height?: number; path?: string }
      snapshot?: SnapshotMeta
    },
  ): void {
    if (options.onToolCall) {
      options.onToolCall(toolName, stepIndex, !result.ok)
    }

    const event: any = {
      event: 'autoqa.tool.result',
      runId: options.runId,
      specPath,
      toolName,
      stepIndex,
      toolDurationMs: Date.now() - startTime,
      ok: result.ok,
    }

    if (!result.ok && result.error) {
      event.error = {
        code: result.error.code,
        message: result.error.message,
        retriable: result.error.retriable,
      }
    }

    if (meta.screenshot?.path) {
      event.screenshot = {
        mimeType: meta.screenshot.mimeType,
        width: meta.screenshot.width,
        height: meta.screenshot.height,
        relativePath: sanitizeRelativePath(meta.screenshot.path, cwd),
      }
    } else if (meta.error) {
      event.screenshotError = meta.error
    }

    if (meta.snapshot?.ariaPath || meta.snapshot?.axPath) {
      event.snapshot = {
        ariaRelativePath: meta.snapshot.ariaPath,
        axRelativePath: meta.snapshot.axPath,
      }
    }
    if (meta.snapshot?.error) {
      event.snapshotError = meta.snapshot.error
    }

    logger.log(event)
  }

  async function capturePreActionSnapshot() {
    try {
      return await captureSnapshots(options.page)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        aria: { ok: false as const, error: `Failed to capture ARIA snapshot: ${msg}` },
        ax: { ok: false as const, error: `Failed to capture AX snapshot: ${msg}` },
      }
    }
  }

  async function resolveRefLocator(ref: string): Promise<Locator> {
    try {
      const snapshotForAI = (options.page as any)?._snapshotForAI
      if (typeof snapshotForAI === 'function') {
        await snapshotForAI.call(options.page, { timeout: 5000 })
      }
    } catch {
    }
    return options.page.locator(`aria-ref=${ref}`).first()
  }

  return createSdkMcpServer({
    name: 'autoqa-browser-tools',
    version: '0.0.0',
    tools: [
      tool(
        'snapshot',
        'Capture an accessibility snapshot that includes stable refs for interactable elements.',
        {
          stepIndex: stepIndexSchema,
        },
        async (args) => {
          const stepIndex = parseStepIndex((args as any).stepIndex)
          const fileBaseName = nextFileBaseName('snapshot')
          const startTime = Date.now()
          logToolCall('snapshot', {}, stepIndex)
          writeDebug(options.debug, `mcp_tool=snapshot stepIndex=${stepIndex}`)

          const snapshotCapture = await capturePreActionSnapshot()

          const snapshotMeta = await writeSnapshotsIfNeeded(
            snapshotCapture,
            { cwd: options.cwd, runId: options.runId, fileBaseName },
            shouldWriteArtifacts(options.debug, true),
          )

          logToolResult('snapshot', startTime, { ok: true } as any, stepIndex, { snapshot: snapshotMeta })

          const content: ContentBlock[] = []
          if (snapshotMeta.error) content.push({ type: 'text', text: `SNAPSHOT_FAILED: ${snapshotMeta.error}` })

          const full = snapshotCapture.ax.ok && snapshotCapture.ax.json && typeof (snapshotCapture.ax.json as any).full === 'string'
            ? String((snapshotCapture.ax.json as any).full)
            : ''
          content.push({ type: 'text', text: full.length > 0 ? full : 'NO_AX_SNAPSHOT_AVAILABLE' })

          return { content, isError: false }
        },
      ),
      tool(
        'navigate',
        'Navigate the page to a given URL (absolute or /path relative to baseUrl). Captures a pre-action screenshot and returns it as an image block.',
        {
          url: z.string(),
          stepIndex: stepIndexSchema,
        },
        async (args) => {
          const stepIndex = parseStepIndex((args as any).stepIndex)
          const contextMode = getToolContextMode()
          const url = normalizeToolStringInput(args.url)
          const fileBaseName = nextFileBaseName('navigate')
          const startTime = Date.now()
          logToolCall('navigate', { url }, stepIndex)
          writeDebug(options.debug, `mcp_tool=navigate url=${url} stepIndex=${stepIndex}`)

          const snapshotCapturePromise = contextMode === 'snapshot' ? capturePreActionSnapshot() : Promise.resolve(undefined)

          const { result, meta } = await runWithPreActionScreenshot({
            page: options.page,
            runId: options.runId,
            debug: options.debug,
            cwd: options.cwd,
            fileBaseName,
            quality: DEFAULT_JPEG_QUALITY,
            action: async () => {
              await snapshotCapturePromise
              return navigate({ page: options.page, baseUrl: options.baseUrl, url })
            },
          })

          const snapshotCapture = await snapshotCapturePromise
          const snapshotMeta = snapshotCapture
            ? await writeSnapshotsIfNeeded(
              snapshotCapture,
              { cwd: options.cwd, runId: options.runId, fileBaseName },
              shouldWriteArtifacts(options.debug, Boolean(result.ok)),
            )
            : ({ captured: false } as SnapshotMeta)

          logToolResult('navigate', startTime, result as any, stepIndex, { ...meta, snapshot: snapshotMeta })

          const content: ContentBlock[] = []
          if (meta.error) content.push({ type: 'text', text: `SCREENSHOT_FAILED: ${meta.error}` })
          if (!result.ok && meta.imageBlock) content.push(meta.imageBlock)
          if (snapshotMeta.error) content.push({ type: 'text', text: `SNAPSHOT_FAILED: ${snapshotMeta.error}` })
          content.push({ type: 'text', text: safeStringify(summarizeToolResult(result as any)) })

          return { content, isError: !result.ok }
        },
      ),
      tool(
        'click',
        'Click an element described by targetDescription. Captures a pre-action screenshot and returns it as an image block.',
        {
          targetDescription: z.string().optional(),
          ref: z.string().optional(),
          stepIndex: stepIndexSchema,
        },
        async (args) => {
          const stepIndex = parseStepIndex((args as any).stepIndex)
          const contextMode = getToolContextMode()
          const targetDescription = typeof (args as any).targetDescription === 'string' ? normalizeToolStringInput((args as any).targetDescription) : ''
          const ref = typeof (args as any).ref === 'string' ? normalizeToolStringInput((args as any).ref) : ''
          const fileBaseName = nextFileBaseName('click')
          const startTime = Date.now()
          logToolCall('click', { targetDescription, ref }, stepIndex)
          writeDebug(
            options.debug,
            `mcp_tool=click targetLength=${targetDescription.length}${ref ? ` refLength=${ref.length}` : ''} stepIndex=${stepIndex}`,
          )

          if (ref && !isValidSnapshotRef(ref)) {
            const result = {
              ok: false as const,
              error: {
                code: 'INVALID_INPUT' as const,
                message: `Invalid ref: ${ref}. Ref must come from snapshot like e15.`,
                retriable: false,
                cause: undefined,
              },
            }

            logToolResult('click', startTime, result as any, stepIndex, {})
            return {
              content: [{ type: 'text', text: safeStringify(summarizeToolResult(result as any)) }],
              isError: true,
            }
          }

          const snapshotCapturePromise = contextMode === 'snapshot' ? capturePreActionSnapshot() : Promise.resolve(undefined)

          const { result, meta } = await runWithPreActionScreenshot({
            page: options.page,
            runId: options.runId,
            debug: options.debug,
            cwd: options.cwd,
            fileBaseName,
            quality: DEFAULT_JPEG_QUALITY,
            action: async () => {
              await snapshotCapturePromise
              if (ref) {
                try {
                  const locator = await resolveRefLocator(ref)
                  const count = await locator.count()
                  if (count <= 0) {
                    return {
                      ok: false as const,
                      error: {
                        code: 'ELEMENT_NOT_FOUND',
                        message: `Ref not found: ${ref}`,
                        retriable: true,
                        cause: undefined,
                      },
                    }
                  }
                  await locator.click()
                  return { ok: true as const, data: { ref, targetDescription } }
                } catch (err: unknown) {
                  return { ok: false as const, error: toToolError(err) }
                }
              }
              return click({ page: options.page, targetDescription })
            },
          })

          const snapshotCapture = await snapshotCapturePromise
          const snapshotMeta = snapshotCapture
            ? await writeSnapshotsIfNeeded(
              snapshotCapture,
              { cwd: options.cwd, runId: options.runId, fileBaseName },
              shouldWriteArtifacts(options.debug, Boolean(result.ok)),
            )
            : ({ captured: false } as SnapshotMeta)

          logToolResult('click', startTime, result as any, stepIndex, { ...meta, snapshot: snapshotMeta })

          const content: ContentBlock[] = []
          if (meta.error) content.push({ type: 'text', text: `SCREENSHOT_FAILED: ${meta.error}` })
          if (!result.ok && meta.imageBlock) content.push(meta.imageBlock)
          if (snapshotMeta.error) content.push({ type: 'text', text: `SNAPSHOT_FAILED: ${snapshotMeta.error}` })
          content.push({ type: 'text', text: safeStringify(summarizeToolResult(result as any)) })

          return { content, isError: !result.ok }
        },
      ),
      tool(
        'fill',
        'Fill an input described by targetDescription with the provided text. Captures a pre-action screenshot and returns it as an image block.',
        {
          targetDescription: z.string().optional(),
          ref: z.string().optional(),
          text: z.string(),
          stepIndex: stepIndexSchema,
        },
        async (args) => {
          const stepIndex = parseStepIndex((args as any).stepIndex)
          const contextMode = getToolContextMode()
          const targetDescription = typeof (args as any).targetDescription === 'string' ? normalizeToolStringInput((args as any).targetDescription) : ''
          const ref = typeof (args as any).ref === 'string' ? normalizeToolStringInput((args as any).ref) : ''
          const text = normalizeToolStringInput(args.text)
          const fileBaseName = nextFileBaseName('fill')
          const startTime = Date.now()
          logToolCall('fill', { targetDescription, ref, text }, stepIndex)
          writeDebug(
            options.debug,
            `mcp_tool=fill targetLength=${targetDescription.length}${ref ? ` refLength=${ref.length}` : ''} textLength=${text.length} stepIndex=${stepIndex}`,
          )

          if (ref && !isValidSnapshotRef(ref)) {
            const result = {
              ok: false as const,
              error: {
                code: 'INVALID_INPUT' as const,
                message: `Invalid ref: ${ref}. Ref must come from snapshot like e15.`,
                retriable: false,
                cause: undefined,
              },
            }

            logToolResult('fill', startTime, result as any, stepIndex, {})
            return {
              content: [{ type: 'text', text: safeStringify(summarizeToolResult(result as any)) }],
              isError: true,
            }
          }

          const snapshotCapturePromise = contextMode === 'snapshot' ? capturePreActionSnapshot() : Promise.resolve(undefined)

          const { result, meta } = await runWithPreActionScreenshot({
            page: options.page,
            runId: options.runId,
            debug: options.debug,
            cwd: options.cwd,
            fileBaseName,
            quality: DEFAULT_JPEG_QUALITY,
            action: async () => {
              await snapshotCapturePromise
              if (ref) {
                try {
                  const locator = await resolveRefLocator(ref)
                  const count = await locator.count()
                  if (count <= 0) {
                    return {
                      ok: false as const,
                      error: {
                        code: 'ELEMENT_NOT_FOUND',
                        message: `Ref not found: ${ref}`,
                        retriable: true,
                        cause: undefined,
                      },
                    }
                  }
                  try {
                    await locator.fill(text)
                    return { ok: true as const, data: { ref, targetDescription, textLength: text.length } }
                  } catch (err: unknown) {
                    try {
                      const descendant = locator.locator('input, textarea, [contenteditable="true"]').first()
                      const dcount = await descendant.count()
                      if (dcount > 0) {
                        await descendant.fill(text)
                        return { ok: true as const, data: { ref, targetDescription, textLength: text.length } }
                      }
                    } catch {
                    }
                    throw err
                  }
                } catch (err: unknown) {
                  return { ok: false as const, error: toToolError(err) }
                }
              }
              return fill({ page: options.page, targetDescription, text })
            },
          })

          const snapshotCapture = await snapshotCapturePromise
          const snapshotMeta = snapshotCapture
            ? await writeSnapshotsIfNeeded(
              snapshotCapture,
              { cwd: options.cwd, runId: options.runId, fileBaseName },
              shouldWriteArtifacts(options.debug, Boolean(result.ok)),
            )
            : ({ captured: false } as SnapshotMeta)

          logToolResult('fill', startTime, result as any, stepIndex, { ...meta, snapshot: snapshotMeta })

          const content: ContentBlock[] = []
          if (meta.error) content.push({ type: 'text', text: `SCREENSHOT_FAILED: ${meta.error}` })
          if (!result.ok && meta.imageBlock) content.push(meta.imageBlock)
          if (snapshotMeta.error) content.push({ type: 'text', text: `SNAPSHOT_FAILED: ${snapshotMeta.error}` })
          content.push({ type: 'text', text: safeStringify(summarizeToolResult(result as any)) })

          return { content, isError: !result.ok }
        },
      ),
      tool(
        'select_option',
        'Select an option in a dropdown using a ref from the latest snapshot.',
        {
          ref: z.string(),
          label: z.string(),
          stepIndex: stepIndexSchema,
        },
        async (args) => {
          const stepIndex = parseStepIndex((args as any).stepIndex)
          const contextMode = getToolContextMode()
          const ref = normalizeToolStringInput(args.ref)
          const label = normalizeToolStringInput(args.label)
          const fileBaseName = nextFileBaseName('select_option')
          const startTime = Date.now()
          logToolCall('select_option', { ref, label }, stepIndex)
          writeDebug(options.debug, `mcp_tool=select_option ref=${ref} label=${label} stepIndex=${stepIndex}`)

          if (!isValidSnapshotRef(ref)) {
            const result = {
              ok: false as const,
              error: {
                code: 'INVALID_INPUT' as const,
                message: `Invalid ref: ${ref}. Ref must come from snapshot like e15.`,
                retriable: false,
                cause: undefined,
              },
            }

            logToolResult('select_option', startTime, result as any, stepIndex, {})
            return {
              content: [{ type: 'text', text: safeStringify(summarizeToolResult(result as any)) }],
              isError: true,
            }
          }

          const snapshotCapturePromise = contextMode === 'snapshot' ? capturePreActionSnapshot() : Promise.resolve(undefined)

          const { result, meta } = await runWithPreActionScreenshot({
            page: options.page,
            runId: options.runId,
            debug: options.debug,
            cwd: options.cwd,
            fileBaseName,
            quality: DEFAULT_JPEG_QUALITY,
            action: async () => {
              await snapshotCapturePromise
              try {
                const locator = await resolveRefLocator(ref)
                const count = await locator.count()
                if (count <= 0) {
                  return {
                    ok: false as const,
                    error: {
                      code: 'ELEMENT_NOT_FOUND',
                      message: `Ref not found: ${ref}`,
                      retriable: true,
                      cause: undefined,
                    },
                  }
                }
                await locator.selectOption({ label })
                return { ok: true as const, data: { ref, label } }
              } catch (err: unknown) {
                return { ok: false as const, error: toToolError(err) }
              }
            },
          })

          const snapshotCapture = await snapshotCapturePromise
          const snapshotMeta = snapshotCapture
            ? await writeSnapshotsIfNeeded(
              snapshotCapture,
              { cwd: options.cwd, runId: options.runId, fileBaseName },
              shouldWriteArtifacts(options.debug, Boolean(result.ok)),
            )
            : ({ captured: false } as SnapshotMeta)

          logToolResult('select_option', startTime, result as any, stepIndex, { ...meta, snapshot: snapshotMeta })

          const content: ContentBlock[] = []
          if (meta.error) content.push({ type: 'text', text: `SCREENSHOT_FAILED: ${meta.error}` })
          if (!result.ok && meta.imageBlock) content.push(meta.imageBlock)
          if (snapshotMeta.error) content.push({ type: 'text', text: `SNAPSHOT_FAILED: ${snapshotMeta.error}` })
          content.push({ type: 'text', text: safeStringify(summarizeToolResult(result as any)) })

          return { content, isError: !result.ok }
        },
      ),
      tool(
        'scroll',
        'Scroll the page up or down by an amount. Captures a pre-action screenshot and returns it as an image block.',
        {
          direction: z.enum(['up', 'down']),
          amount: z.number(),
          stepIndex: stepIndexSchema,
        },
        async (args) => {
          const stepIndex = parseStepIndex((args as any).stepIndex)
          const contextMode = getToolContextMode()
          const fileBaseName = nextFileBaseName('scroll')
          const startTime = Date.now()
          logToolCall('scroll', { direction: args.direction, amount: args.amount }, stepIndex)
          writeDebug(options.debug, `mcp_tool=scroll direction=${args.direction} amount=${args.amount} stepIndex=${stepIndex}`)

          const snapshotCapturePromise = contextMode === 'snapshot' ? capturePreActionSnapshot() : Promise.resolve(undefined)

          const { result, meta } = await runWithPreActionScreenshot({
            page: options.page,
            runId: options.runId,
            debug: options.debug,
            cwd: options.cwd,
            fileBaseName,
            quality: DEFAULT_JPEG_QUALITY,
            action: async () => {
              await snapshotCapturePromise
              return scroll({ page: options.page, direction: args.direction, amount: args.amount })
            },
          })

          const snapshotCapture = await snapshotCapturePromise
          const snapshotMeta = snapshotCapture
            ? await writeSnapshotsIfNeeded(
              snapshotCapture,
              { cwd: options.cwd, runId: options.runId, fileBaseName },
              shouldWriteArtifacts(options.debug, Boolean(result.ok)),
            )
            : ({ captured: false } as SnapshotMeta)

          logToolResult('scroll', startTime, result as any, stepIndex, { ...meta, snapshot: snapshotMeta })

          const content: ContentBlock[] = []
          if (meta.error) content.push({ type: 'text', text: `SCREENSHOT_FAILED: ${meta.error}` })
          if (!result.ok && meta.imageBlock) content.push(meta.imageBlock)
          if (snapshotMeta.error) content.push({ type: 'text', text: `SNAPSHOT_FAILED: ${snapshotMeta.error}` })
          content.push({ type: 'text', text: safeStringify(summarizeToolResult(result as any)) })

          return { content, isError: !result.ok }
        },
      ),
      tool(
        'wait',
        'Wait for N seconds. Optional pre-action screenshot (kept for consistency).',
        {
          seconds: z.number(),
          stepIndex: stepIndexSchema,
        },
        async (args) => {
          const stepIndex = parseStepIndex((args as any).stepIndex)
          const contextMode = getToolContextMode()
          const fileBaseName = nextFileBaseName('wait')
          const startTime = Date.now()
          logToolCall('wait', { seconds: args.seconds }, stepIndex)
          writeDebug(options.debug, `mcp_tool=wait seconds=${args.seconds} stepIndex=${stepIndex}`)

          const snapshotCapturePromise = contextMode === 'snapshot' ? capturePreActionSnapshot() : Promise.resolve(undefined)

          const { result, meta } = await runWithPreActionScreenshot({
            page: options.page,
            runId: options.runId,
            debug: options.debug,
            cwd: options.cwd,
            fileBaseName,
            quality: DEFAULT_JPEG_QUALITY,
            action: async () => {
              await snapshotCapturePromise
              return wait({ page: options.page, seconds: args.seconds })
            },
          })

          const snapshotCapture = await snapshotCapturePromise
          const snapshotMeta = snapshotCapture
            ? await writeSnapshotsIfNeeded(
              snapshotCapture,
              { cwd: options.cwd, runId: options.runId, fileBaseName },
              shouldWriteArtifacts(options.debug, Boolean(result.ok)),
            )
            : ({ captured: false } as SnapshotMeta)

          logToolResult('wait', startTime, result as any, stepIndex, { ...meta, snapshot: snapshotMeta })

          const content: ContentBlock[] = []
          if (meta.error) content.push({ type: 'text', text: `SCREENSHOT_FAILED: ${meta.error}` })
          if (!result.ok && meta.imageBlock) content.push(meta.imageBlock)
          if (snapshotMeta.error) content.push({ type: 'text', text: `SNAPSHOT_FAILED: ${snapshotMeta.error}` })
          content.push({ type: 'text', text: safeStringify(summarizeToolResult(result as any)) })

          return { content, isError: !result.ok }
        },
      ),
      tool(
        'assertTextPresent',
        'Assert that the page contains the specified text. Returns ok=true if found, ok=false with ASSERTION_FAILED if not found.',
        {
          text: z.string(),
          stepIndex: stepIndexSchema,
        },
        async (args) => {
          const stepIndex = parseStepIndex((args as any).stepIndex)
          const contextMode = getToolContextMode()
          const text = normalizeToolStringInput(args.text)
          const fileBaseName = nextFileBaseName('assertTextPresent')
          const startTime = Date.now()
          logToolCall('assertTextPresent', { text }, stepIndex)
          writeDebug(options.debug, `mcp_tool=assertTextPresent textLength=${text.length} stepIndex=${stepIndex}`)

          const snapshotCapturePromise = contextMode === 'snapshot' ? capturePreActionSnapshot() : Promise.resolve(undefined)

          const { result, meta } = await runWithPreActionScreenshot({
            page: options.page,
            runId: options.runId,
            debug: options.debug,
            cwd: options.cwd,
            fileBaseName,
            quality: DEFAULT_JPEG_QUALITY,
            action: async () => {
              await snapshotCapturePromise
              return assertTextPresent({ page: options.page, text })
            },
          })

          const snapshotCapture = await snapshotCapturePromise
          const snapshotMeta = snapshotCapture
            ? await writeSnapshotsIfNeeded(
              snapshotCapture,
              { cwd: options.cwd, runId: options.runId, fileBaseName },
              shouldWriteArtifacts(options.debug, Boolean(result.ok)),
            )
            : ({ captured: false } as SnapshotMeta)

          logToolResult('assertTextPresent', startTime, result as any, stepIndex, { ...meta, snapshot: snapshotMeta })

          const content: ContentBlock[] = []
          if (meta.error) content.push({ type: 'text', text: `SCREENSHOT_FAILED: ${meta.error}` })
          if (!result.ok && meta.imageBlock) content.push(meta.imageBlock)
          if (snapshotMeta.error) content.push({ type: 'text', text: `SNAPSHOT_FAILED: ${snapshotMeta.error}` })
          content.push({ type: 'text', text: safeStringify(summarizeToolResult(result as any)) })

          return { content, isError: !result.ok }
        },
      ),
      tool(
        'assertElementVisible',
        'Assert that an element described by targetDescription or ref is visible on the page. Returns ok=true if visible, ok=false with ASSERTION_FAILED if not visible.',
        {
          targetDescription: z.string().optional(),
          ref: z.string().optional(),
          stepIndex: stepIndexSchema,
        },
        async (args) => {
          const stepIndex = parseStepIndex((args as any).stepIndex)
          const contextMode = getToolContextMode()
          const targetDescription = typeof (args as any).targetDescription === 'string' ? normalizeToolStringInput((args as any).targetDescription) : ''
          const ref = typeof (args as any).ref === 'string' ? normalizeToolStringInput((args as any).ref) : ''
          const fileBaseName = nextFileBaseName('assertElementVisible')
          const startTime = Date.now()
          logToolCall('assertElementVisible', { targetDescription, ref }, stepIndex)
          writeDebug(
            options.debug,
            `mcp_tool=assertElementVisible targetLength=${targetDescription.length}${ref ? ` refLength=${ref.length}` : ''} stepIndex=${stepIndex}`,
          )

          if (ref && !isValidSnapshotRef(ref)) {
            const result = {
              ok: false as const,
              error: {
                code: 'INVALID_INPUT' as const,
                message: `Invalid ref: ${ref}. Ref must come from snapshot like e15.`,
                retriable: false,
                cause: undefined,
              },
            }

            logToolResult('assertElementVisible', startTime, result as any, stepIndex, {})
            return {
              content: [{ type: 'text', text: safeStringify(summarizeToolResult(result as any)) }],
              isError: true,
            }
          }

          const snapshotCapturePromise = contextMode === 'snapshot' ? capturePreActionSnapshot() : Promise.resolve(undefined)

          const { result, meta } = await runWithPreActionScreenshot({
            page: options.page,
            runId: options.runId,
            debug: options.debug,
            cwd: options.cwd,
            fileBaseName,
            quality: DEFAULT_JPEG_QUALITY,
            action: async () => {
              await snapshotCapturePromise
              if (!ref && !targetDescription) {
                return {
                  ok: false as const,
                  error: {
                    code: 'INVALID_INPUT' as const,
                    message: 'Either ref or targetDescription is required',
                    retriable: false,
                    cause: undefined,
                  },
                }
              }
              if (ref) {
                try {
                  const locator = await resolveRefLocator(ref)
                  const count = await locator.count()
                  if (count <= 0) {
                    return {
                      ok: false as const,
                      error: {
                        code: 'ASSERTION_FAILED' as const,
                        message: `Ref not found or not visible: ${ref}`,
                        retriable: true,
                        cause: undefined,
                      },
                    }
                  }
                  const isVisible = await locator.isVisible()
                  if (isVisible) {
                    return { ok: true as const, data: { ref, targetDescription } }
                  }
                  return {
                    ok: false as const,
                    error: {
                      code: 'ASSERTION_FAILED' as const,
                      message: `Element with ref not visible: ${ref}`,
                      retriable: true,
                      cause: undefined,
                    },
                  }
                } catch (err: unknown) {
                  return { ok: false as const, error: toToolError(err, { defaultCode: 'ASSERTION_FAILED' }) }
                }
              }
              return assertElementVisible({ page: options.page, targetDescription })
            },
          })

          const snapshotCapture = await snapshotCapturePromise
          const snapshotMeta = snapshotCapture
            ? await writeSnapshotsIfNeeded(
              snapshotCapture,
              { cwd: options.cwd, runId: options.runId, fileBaseName },
              shouldWriteArtifacts(options.debug, Boolean(result.ok)),
            )
            : ({ captured: false } as SnapshotMeta)

          logToolResult('assertElementVisible', startTime, result as any, stepIndex, { ...meta, snapshot: snapshotMeta })

          const content: ContentBlock[] = []
          if (meta.error) content.push({ type: 'text', text: `SCREENSHOT_FAILED: ${meta.error}` })
          if (!result.ok && meta.imageBlock) content.push(meta.imageBlock)
          if (snapshotMeta.error) content.push({ type: 'text', text: `SNAPSHOT_FAILED: ${snapshotMeta.error}` })
          content.push({ type: 'text', text: safeStringify(summarizeToolResult(result as any)) })

          return { content, isError: !result.ok }
        },
      ),
    ],
  })
}
