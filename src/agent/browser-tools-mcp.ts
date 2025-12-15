import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

import type { Page } from 'playwright'

import { click, fill, navigate, scroll, wait } from '../tools/index.js'
import type { ContentBlock } from './pre-action-screenshot.js'
import { runWithPreActionScreenshot } from './pre-action-screenshot.js'

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
}

const DEFAULT_JPEG_QUALITY = 60

export function createBrowserToolsMcpServer(options: CreateBrowserToolsMcpServerOptions) {
  let counter = 0
  const nextFileBaseName = (toolName: string) => {
    counter += 1
    return `${toolName}-${counter}`
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

          const content: ContentBlock[] = []
          if (meta.error) content.push({ type: 'text', text: `SCREENSHOT_FAILED: ${meta.error}` })
          content.push({ type: 'text', text: safeStringify(summarizeToolResult(result as any)) })

          return { content, isError: !result.ok }
        },
      ),
    ],
  })
}
