import { query } from '@anthropic-ai/claude-agent-sdk'

import type { Page } from 'playwright'

import type { MarkdownSpec } from '../markdown/spec-types.js'
import type { StepVarInfo } from '../runner/run-specs.js'
import { createBrowserToolsMcpServer } from './browser-tools-mcp.js'
import type { Logger } from '../logging/index.js'
import { redactToolInput } from '../logging/index.js'
import type { Guardrails } from '../config/schema.js'
import { DEFAULT_GUARDRAILS } from '../config/defaults.js'
import {
  GuardrailError,
  createGuardrailCounters,
  checkGuardrails,
  updateCountersOnToolCall,
  updateCountersOnToolResult,
  type GuardrailCounters,
} from './guardrails.js'

export { GuardrailError } from './guardrails.js'

export type RunAgentOptions = {
  runId: string
  baseUrl: string
  debug: boolean
  specPath: string
  spec: MarkdownSpec
  page: Page
  cwd?: string
  logger: Logger
  guardrails?: Required<Guardrails>
  /** Map of stepIndex -> variables used in that step */
  stepVarsMap?: Map<number, StepVarInfo>
}

export const RUN_AGENT_ALLOWED_TOOLS = [
  'mcp__browser__snapshot',
  'mcp__browser__navigate',
  'mcp__browser__click',
  'mcp__browser__fill',
  'mcp__browser__select_option',
  'mcp__browser__scroll',
  'mcp__browser__wait',
  'mcp__browser__assertTextPresent',
  'mcp__browser__assertElementVisible',
] as const

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
- Use ONLY the provided browser tools (snapshot/navigate/click/fill/select_option/scroll/wait/assertTextPresent/assertElementVisible).
- Execute steps in order.
- The browser page starts at about:blank. At the start of Step 1, you MUST call navigate() once (with stepIndex=1) to open the site. If Step 1 is a Navigate step, navigate to its target; otherwise navigate('/').
- Tool inputs MUST be plain strings (do not include Markdown backticks or quotes around values).
- Keep tool inputs minimal and avoid leaking secrets.
- Step tracking: For EVERY tool call, include the stepIndex parameter matching the current step number (1-indexed from the Steps list above). This is critical for tracking progress and error recovery.
- Ref-first execution:
  - Before each interaction step (click/fill/select_option), call snapshot to get an accessibility snapshot.
  - Find the target element in the snapshot and extract its ref like [ref=e15].
  - Call the action tool using ref (preferred) instead of targetDescription.
  - If the ref is not found or action fails, capture a new snapshot and retry once.
  - Only if ref-based action is not possible, fall back to using targetDescription.
  - NEVER guess or invent a ref. A ref must be exactly like e15 and must be copied from a snapshot in this run.
  - For icon-only UI (e.g. the cart icon in the top-right on SauceDemo inventory page), prefer stable attribute-based targetDescription instead of ref, e.g. data-test=shopping-cart-link or class=shopping_cart_link.
- Assertion requirement (CRITICAL):
  - For EVERY step that starts with "Verify" or contains verification/assertion intent, you MUST call at least one assertion tool (assertTextPresent or assertElementVisible) with the correct stepIndex.
  - Do NOT skip assertion tool calls even if you can visually confirm the result from a snapshot. The assertion tool call is required for test recording.
  - For sorting/ordering verification, assert that a specific expected text (e.g. the first product name or price after sorting) is present on the page.
  - Example: To verify "sorted by price ascending", call assertTextPresent with the expected lowest price like "$7.99".
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

const NO_DOWNGRADE_TOOLS = new Set(['mcp__browser__assertElementVisible'])

type StepToolStats = {
  attemptedTools: Set<string>
  okTools: Set<string>
}

function ensureStepStats(map: Map<number, StepToolStats>, stepIndex: number): StepToolStats {
  const existing = map.get(stepIndex)
  if (existing) return existing
  const created: StepToolStats = { attemptedTools: new Set(), okTools: new Set() }
  map.set(stepIndex, created)
  return created
}

function parseStepIndex(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) {
    return value
  }
  if (typeof value === 'string') {
    const s = value.trim()
    if (!/^\d+$/.test(s)) return null
    const parsed = parseInt(s, 10)
    if (!Number.isNaN(parsed) && parsed >= 1) return parsed
  }
  return null
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

  const secrets = [process.env.AUTOQA_PASSWORD, process.env.AUTOQA_USERNAME, process.env.ANTHROPIC_API_KEY]
    .filter((v): v is string => typeof v === 'string' && v.length >= 4)
    .filter((v, idx, arr) => arr.indexOf(v) === idx)
    .sort((a, b) => b.length - a.length)

  let out = line
  for (const secret of secrets) {
    out = out.split(secret).join('[REDACTED]')
  }

  try {
    process.stderr.write(`${out}\n`)
  } catch {
    return
  }
}

export async function runAgent(options: RunAgentOptions): Promise<void> {
  if (!process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT) {
    process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = '60000'
  }

  const guardrailLimits = {
    maxToolCallsPerSpec: options.guardrails?.maxToolCallsPerSpec ?? DEFAULT_GUARDRAILS.maxToolCallsPerSpec,
    maxConsecutiveErrors: options.guardrails?.maxConsecutiveErrors ?? DEFAULT_GUARDRAILS.maxConsecutiveErrors,
    maxRetriesPerStep: options.guardrails?.maxRetriesPerStep ?? DEFAULT_GUARDRAILS.maxRetriesPerStep,
  }

  const counters: GuardrailCounters = createGuardrailCounters()
  const toolUseMeta = new Map<string, { stepIndex: number | null; toolName: string }>()
  const stepToolStats = new Map<number, StepToolStats>()

  const server = createBrowserToolsMcpServer({
    page: options.page,
    baseUrl: options.baseUrl,
    runId: options.runId,
    debug: options.debug,
    cwd: options.cwd,
    specPath: options.specPath,
    logger: options.logger,
    stepVarsMap: options.stepVarsMap,
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
      allowedTools: [...RUN_AGENT_ALLOWED_TOOLS],
      persistSession: false,
    },
  })

  const tryAbortStream = async (): Promise<void> => {
    const anyResponse = response as any

    try {
      anyResponse?.abortController?.abort?.()
    } catch {}

    const fn = anyResponse?.return
    if (typeof fn === 'function') {
      try {
        await fn.call(anyResponse)
      } catch {
        return
      }
    }
  }

  try {
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

              updateCountersOnToolCall(counters)
              const stepIndex = parseStepIndex((input as any)?.stepIndex)
              if (id) toolUseMeta.set(id, { stepIndex, toolName: name })

              if (stepIndex != null && name) {
                const stats = ensureStepStats(stepToolStats, stepIndex)
                stats.attemptedTools.add(name)
              }

              const violation = checkGuardrails(counters, guardrailLimits, stepIndex)
              if (violation) {
                options.logger.log({
                  event: 'autoqa.guardrail.triggered',
                  runId: options.runId,
                  specPath: options.specPath,
                  stepIndex,
                  code: violation.code,
                  limit: violation.limit,
                  actual: violation.actual,
                })
                await tryAbortStream()
                throw violation
              }

              writeDebug(
                options.debug,
                `tool_use=${name}${id ? ` id=${id}` : ''} input=${truncate(
                  safeStringify(
                    input && typeof input === 'object' ? redactToolInput(name, input as any) : input,
                  ),
                  400,
                )}`,
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

              const meta = toolUseId ? toolUseMeta.get(toolUseId) : undefined
              const stepIndex = meta?.stepIndex ?? null
              const toolName = meta?.toolName ?? ''
              if (toolUseId) toolUseMeta.delete(toolUseId)

              if (!isError && stepIndex != null && toolName) {
                const stats = ensureStepStats(stepToolStats, stepIndex)
                stats.okTools.add(toolName)
              }
              updateCountersOnToolResult(counters, stepIndex, isError)

              const violation = checkGuardrails(counters, guardrailLimits, stepIndex)
              if (violation) {
                options.logger.log({
                  event: 'autoqa.guardrail.triggered',
                  runId: options.runId,
                  specPath: options.specPath,
                  stepIndex,
                  code: violation.code,
                  limit: violation.limit,
                  actual: violation.actual,
                })
                await tryAbortStream()
                throw violation
              }

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

          for (const [stepIndex, stats] of stepToolStats.entries()) {
            for (const toolName of NO_DOWNGRADE_TOOLS) {
              if (!stats.attemptedTools.has(toolName)) continue
              if (stats.okTools.has(toolName)) continue
              throw new Error(`STEP_VALIDATION_FAILED: stepIndex=${stepIndex} attempted ${toolName} but never succeeded`)
            }
          }
          return
        }

        const errors = Array.isArray(message?.errors) ? message.errors.join('\n') : undefined
        throw new Error(errors && errors.length > 0 ? errors : 'Agent run failed')
      }

      writeDebug(options.debug, `message=${safeStringify(message)}`)
    }

    throw new Error('Agent stream ended without a final result')
  } finally {
    await tryAbortStream()
  }
}
