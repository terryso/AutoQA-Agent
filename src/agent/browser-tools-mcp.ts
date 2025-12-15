import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

import type { Page } from 'playwright'

import { click, fill, navigate, scroll, wait } from '../tools/index.js'
import type { ContentBlock } from './pre-action-screenshot.js'
import { runWithPreActionScreenshot } from './pre-action-screenshot.js'
import type { Logger } from '../logging/index.js'
import { redactToolInput, sanitizeRelativePath } from '../logging/index.js'

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
}

const DEFAULT_JPEG_QUALITY = 60

export function createBrowserToolsMcpServer(options: CreateBrowserToolsMcpServerOptions) {
  let counter = 0
  const nextFileBaseName = (toolName: string) => {
    counter += 1
    return `${toolName}-${counter}`
  }

  const { logger, specPath } = options
  const cwd = options.cwd ?? process.cwd()

  function logToolCall(toolName: string, toolInput: Record<string, unknown>): void {
    logger.log({
      event: 'autoqa.tool.called',
      runId: options.runId,
      specPath,
      toolName,
      stepIndex: null,
      toolInput: redactToolInput(toolName, toolInput),
    })
  }

  function logToolResult(
    toolName: string,
    startTime: number,
    result: { ok: boolean; error?: any },
    meta: { error?: string; screenshot?: { mimeType?: string; width?: number; height?: number; path?: string } },
  ): void {
    const event: any = {
      event: 'autoqa.tool.result',
      runId: options.runId,
      specPath,
      toolName,
      stepIndex: null,
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

    logger.log(event)
  }

  return createSdkMcpServer({
    name: 'autoqa-browser-tools',
    version: '0.0.0',
    tools: [
      tool(
        'navigate',
        'Navigate the page to a given URL (absolute or /path relative to baseUrl). Captures a pre-action screenshot and returns it as an image block.',
        {
          url: z.string(),
        },
        async (args) => {
          const url = normalizeToolStringInput(args.url)
          const startTime = Date.now()
          logToolCall('navigate', { url })
          writeDebug(options.debug, `mcp_tool=navigate url=${url}`)
          const { result, meta } = await runWithPreActionScreenshot({
            page: options.page,
            runId: options.runId,
            debug: options.debug,
            cwd: options.cwd,
            fileBaseName: nextFileBaseName('navigate'),
            quality: DEFAULT_JPEG_QUALITY,
            action: () => navigate({ page: options.page, baseUrl: options.baseUrl, url }),
          })

          logToolResult('navigate', startTime, result as any, meta)

          const content: ContentBlock[] = []
          if (meta.error) content.push({ type: 'text', text: `SCREENSHOT_FAILED: ${meta.error}` })
          content.push({ type: 'text', text: safeStringify(summarizeToolResult(result as any)) })

          return { content, isError: !result.ok }
        },
      ),
      tool(
        'click',
        'Click an element described by targetDescription. Captures a pre-action screenshot and returns it as an image block.',
        {
          targetDescription: z.string(),
        },
        async (args) => {
          const targetDescription = normalizeToolStringInput(args.targetDescription)
          const startTime = Date.now()
          logToolCall('click', { targetDescription })
          writeDebug(options.debug, `mcp_tool=click target=${targetDescription}`)
          const { result, meta } = await runWithPreActionScreenshot({
            page: options.page,
            runId: options.runId,
            debug: options.debug,
            cwd: options.cwd,
            fileBaseName: nextFileBaseName('click'),
            quality: DEFAULT_JPEG_QUALITY,
            action: () => click({ page: options.page, targetDescription }),
          })

          logToolResult('click', startTime, result as any, meta)

          const content: ContentBlock[] = []
          if (meta.error) content.push({ type: 'text', text: `SCREENSHOT_FAILED: ${meta.error}` })
          content.push({ type: 'text', text: safeStringify(summarizeToolResult(result as any)) })

          return { content, isError: !result.ok }
        },
      ),
      tool(
        'fill',
        'Fill an input described by targetDescription with the provided text. Captures a pre-action screenshot and returns it as an image block.',
        {
          targetDescription: z.string(),
          text: z.string(),
        },
        async (args) => {
          const targetDescription = normalizeToolStringInput(args.targetDescription)
          const text = normalizeToolStringInput(args.text)
          const startTime = Date.now()
          logToolCall('fill', { targetDescription, text })
          writeDebug(options.debug, `mcp_tool=fill target=${targetDescription} text_len=${text.length}`)
          const { result, meta } = await runWithPreActionScreenshot({
            page: options.page,
            runId: options.runId,
            debug: options.debug,
            cwd: options.cwd,
            fileBaseName: nextFileBaseName('fill'),
            quality: DEFAULT_JPEG_QUALITY,
            action: () => fill({ page: options.page, targetDescription, text }),
          })

          logToolResult('fill', startTime, result as any, meta)

          const content: ContentBlock[] = []
          if (meta.error) content.push({ type: 'text', text: `SCREENSHOT_FAILED: ${meta.error}` })
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
        },
        async (args) => {
          const startTime = Date.now()
          logToolCall('scroll', { direction: args.direction, amount: args.amount })
          writeDebug(options.debug, `mcp_tool=scroll direction=${args.direction} amount=${args.amount}`)
          const { result, meta } = await runWithPreActionScreenshot({
            page: options.page,
            runId: options.runId,
            debug: options.debug,
            cwd: options.cwd,
            fileBaseName: nextFileBaseName('scroll'),
            quality: DEFAULT_JPEG_QUALITY,
            action: () => scroll({ page: options.page, direction: args.direction, amount: args.amount }),
          })

          logToolResult('scroll', startTime, result as any, meta)

          const content: ContentBlock[] = []
          if (meta.error) content.push({ type: 'text', text: `SCREENSHOT_FAILED: ${meta.error}` })
          content.push({ type: 'text', text: safeStringify(summarizeToolResult(result as any)) })

          return { content, isError: !result.ok }
        },
      ),
      tool(
        'wait',
        'Wait for N seconds. Optional pre-action screenshot (kept for consistency).',
        {
          seconds: z.number(),
        },
        async (args) => {
          const startTime = Date.now()
          logToolCall('wait', { seconds: args.seconds })
          writeDebug(options.debug, `mcp_tool=wait seconds=${args.seconds}`)
          const { result, meta } = await runWithPreActionScreenshot({
            page: options.page,
            runId: options.runId,
            debug: options.debug,
            cwd: options.cwd,
            fileBaseName: nextFileBaseName('wait'),
            quality: DEFAULT_JPEG_QUALITY,
            action: () => wait({ page: options.page, seconds: args.seconds }),
          })

          logToolResult('wait', startTime, result as any, meta)

          const content: ContentBlock[] = []
          if (meta.error) content.push({ type: 'text', text: `SCREENSHOT_FAILED: ${meta.error}` })
          content.push({ type: 'text', text: safeStringify(summarizeToolResult(result as any)) })

          return { content, isError: !result.ok }
        },
      ),
    ],
  })
}
