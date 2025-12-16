import { query } from '@anthropic-ai/claude-agent-sdk'

import type { Page } from 'playwright'

import type { MarkdownSpec } from '../markdown/spec-types.js'
import { createBrowserToolsMcpServer } from './browser-tools-mcp.js'
import type { Logger } from '../logging/index.js'

export type RunAgentOptions = {
  runId: string
  baseUrl: string
  debug: boolean
  specPath: string
  spec: MarkdownSpec
  page: Page
  cwd?: string
  logger: Logger
}

function buildPrompt(input: Pick<RunAgentOptions, 'baseUrl' | 'specPath' | 'spec'>): string {
  const pre = input.spec.preconditions.map((p) => `- ${p}`).join('\n')
  const steps = input.spec.steps.map((s) => `${s.index}. ${s.text}`).join('\n')

  return `You are an AutoQA agent.

Base URL: ${input.baseUrl}
Spec Path: ${input.specPath}

Preconditions:
${pre}

Steps:
${steps}

Rules:
- Use ONLY the provided browser tools (snapshot/navigate/click/fill/select_option/scroll/wait).
- Execute steps in order.
- The browser page starts at about:blank. Always call navigate('/') first to open the site.
- Tool inputs MUST be plain strings (do not include Markdown backticks or quotes around values).
- Keep tool inputs minimal and avoid leaking secrets.
- Ref-first execution:
  - Before each interaction step (click/fill/select_option), call snapshot to get an accessibility snapshot.
  - Find the target element in the snapshot and extract its ref like [ref=e15].
  - Call the action tool using ref (preferred) instead of targetDescription.
  - If the ref is not found or action fails, capture a new snapshot and retry once.
  - Only if ref-based action is not possible, fall back to using targetDescription.
`
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function safeString(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  return safeStringify(value)
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}…`
}

function getAssistantContent(message: any): unknown {
  if (message && typeof message === 'object') {
    if ('content' in message) return (message as any).content
    if ((message as any).message && typeof (message as any).message === 'object' && 'content' in (message as any).message) {
      return (message as any).message.content
    }
  }
  return undefined
}

function getUserContent(message: any): unknown {
  if (message && typeof message === 'object') {
    if ((message as any).message && typeof (message as any).message === 'object' && 'content' in (message as any).message) {
      return (message as any).message.content
    }
  }
  return undefined
}

function writeDebug(enabled: boolean, line: string): void {
  if (!enabled) return
  try {
    process.stderr.write(`${line}\n`)
  } catch {
    return
  }
}

export async function runAgent(options: RunAgentOptions): Promise<void> {
  if (!process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT) {
    process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = '60000'
  }

  const server = createBrowserToolsMcpServer({
    page: options.page,
    baseUrl: options.baseUrl,
    runId: options.runId,
    debug: options.debug,
    cwd: options.cwd,
    specPath: options.specPath,
    logger: options.logger,
  })

  writeDebug(options.debug, 'mcp=browser (navigate/click/fill/scroll/wait)')

  if (process.env.AUTOQA_PREFLIGHT_NAVIGATE === '1') {
    try {
      writeDebug(options.debug, `preflight=goto ${options.baseUrl}`)
      await options.page.goto(options.baseUrl, { waitUntil: 'domcontentloaded' })
      writeDebug(options.debug, `preflight=url ${options.page.url()}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      writeDebug(options.debug, `preflight_error=${msg}`)
    }
  }

  const response = query({
    prompt: buildPrompt({ baseUrl: options.baseUrl, specPath: options.specPath, spec: options.spec }),
    options: {
      maxTurns: 50,
      tools: [],
      mcpServers: {
        browser: server,
      },
      allowedTools: [
        'mcp__browser__snapshot',
        'mcp__browser__navigate',
        'mcp__browser__click',
        'mcp__browser__fill',
        'mcp__browser__select_option',
        'mcp__browser__scroll',
        'mcp__browser__wait',
      ],
      persistSession: false,
    },
  })

  for await (const message of response as any) {
    if (message?.type === 'system') {
      const subtype = typeof message?.subtype === 'string' ? message.subtype : undefined
      writeDebug(options.debug, subtype ? `system=${subtype}` : `system=${safeStringify(message)}`)

      if (subtype === 'init') {
        try {
          const statuses = await (response as any)?.mcpServerStatus?.()
          if (Array.isArray(statuses)) {
            writeDebug(options.debug, `mcp_status=${safeStringify(statuses)}`)
          }
        } catch {
          
        }
      }
      continue
    }

    if (message?.type === 'assistant') {
      const content = getAssistantContent(message)
      if (typeof content === 'string' && content.length > 0) {
        writeDebug(options.debug, content)
        continue
      }

      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === 'text') {
            const text = safeString(block?.text)
            if (text.length > 0) writeDebug(options.debug, text)
            continue
          }

          if (block?.type === 'tool_use') {
            const name = safeString(block?.name)
            const id = safeString(block?.id)
            const input = block?.input
            writeDebug(
              options.debug,
              `tool_use=${name}${id ? ` id=${id}` : ''} input=${truncate(safeStringify(input), 400)}`,
            )
            continue
          }

          writeDebug(options.debug, `assistant_block=${truncate(safeStringify(block), 400)}`)
        }
        continue
      }

      if (content != null) writeDebug(options.debug, `assistant=${truncate(safeStringify(content), 400)}`)
      continue
    }

    if (message?.type === 'user') {
      const content = getUserContent(message)
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === 'tool_result') {
            const toolUseId = safeString(block?.tool_use_id)
            const isError = Boolean(block?.is_error)
            const text = safeString(block?.content)
            writeDebug(
              options.debug,
              `tool_result${toolUseId ? ` id=${toolUseId}` : ''} is_error=${isError} content=${truncate(text, 400)}`,
            )
            continue
          }
        }
      }
      continue
    }

    if (message?.type === 'error') {
      writeDebug(options.debug, `error=${safeStringify(message)}`)
      continue
    }

    if (message?.type === 'result') {
      writeDebug(options.debug, `result=${safeStringify(message)}`)

      if (message?.subtype === 'success') {
        if (message?.is_error) {
          const errors = Array.isArray(message?.errors) ? message.errors.join('\n') : undefined
          throw new Error(errors && errors.length > 0 ? errors : 'Agent run failed')
        }
        return
      }

      const errors = Array.isArray(message?.errors) ? message.errors.join('\n') : undefined
      throw new Error(errors && errors.length > 0 ? errors : 'Agent run failed')
    }

    writeDebug(options.debug, `message=${safeStringify(message)}`)
  }

  throw new Error('Agent stream ended without a final result')
}
