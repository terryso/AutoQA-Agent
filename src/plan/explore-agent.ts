/**
 * Agent-driven exploration using Claude Agent SDK
 * 
 * This module implements the core exploration logic by calling the Agent SDK,
 * similar to how runAgent works for spec execution.
 */

import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Page } from 'playwright'

import { createBrowserToolsMcpServer } from '../agent/browser-tools-mcp.js'
import type { Logger } from '../logging/index.js'
import type {
  PlanConfig,
  ExplorationResult,
  TranscriptEntry,
  PageNode,
  NavigationEdge,
  GuardrailTrigger,
} from './types.js'

export type ExploreAgentOptions = {
  runId: string
  config: PlanConfig
  page: Page
  cwd: string
  logger: Logger
  debug?: boolean
}

const EXPLORE_ALLOWED_TOOLS = [
  'mcp__browser__snapshot',
  'mcp__browser__navigate',
  'mcp__browser__click',
  'mcp__browser__fill',
  'mcp__browser__select_option',
  'mcp__browser__scroll',
  'mcp__browser__wait',
] as const

function buildExplorePrompt(config: PlanConfig): string {
  const authSection = config.auth
    ? `
Login Credentials:
- Login URL: ${config.auth.loginUrl}
- Username: ${config.auth.username}
- Password: ${config.auth.password}

IMPORTANT: You MUST complete login first before exploring. After navigating to the login URL:
1. Call snapshot() to see the login form
2. Use fill() to enter the username and password
3. Use click() to submit the login form
4. Call snapshot() to verify login succeeded (look for user-specific content or dashboard)
5. If login fails, report the error and stop exploration
`
    : ''

  const guardrailSection = config.guardrails
    ? `
Guardrails (stop exploration when any limit is reached):
- Maximum pages to visit: ${config.guardrails.maxPagesPerRun ?? 50}
- Maximum tool calls: ${config.guardrails.maxAgentTurnsPerRun ?? 200}
- Maximum snapshots: ${config.guardrails.maxSnapshotsPerRun ?? 100}
`
    : ''

  return `You are an AutoQA Exploration Agent. Your task is to explore a web application and document its structure.

Base URL: ${config.baseUrl}
Maximum Depth: ${config.maxDepth ?? 3}
${authSection}
${guardrailSection}

## Your Mission

Systematically explore the web application to discover:
1. All navigable pages and their URLs
2. Interactive elements on each page (buttons, links, inputs, forms)
3. Navigation relationships between pages
4. Form structures and their fields

## Exploration Strategy

1. **Start**: Navigate to the base URL${config.auth ? ' (or login URL if auth is required)' : ''}
2. **On each page**:
   - Call snapshot() to capture the page structure
   - Analyze the snapshot to identify:
     - Clickable elements (buttons, links)
     - Form inputs (text fields, dropdowns, checkboxes)
     - Navigation links to other pages
   - Record the page URL, title, and all interactive elements
3. **Navigate**: Click on internal links to discover new pages (stay within the same domain)
4. **Depth control**: Track how many clicks deep you are from the start page. Stop exploring paths deeper than ${config.maxDepth ?? 3} levels.
5. **Avoid duplicates**: Don't revisit pages you've already explored

## Output Format

After exploring, provide a structured summary in this EXACT JSON format:

\`\`\`json
{
  "pages": [
    {
      "id": "p1",
      "url": "https://example.com/",
      "title": "Home Page",
      "depth": 0,
      "elements": [
        {"id": "e1", "kind": "button", "text": "Login", "selector": "button.login"},
        {"id": "e2", "kind": "link", "text": "About", "href": "/about"}
      ],
      "forms": [
        {"id": "f1", "action": "/search", "fields": [{"name": "q", "type": "text"}]}
      ],
      "links": [
        {"text": "About", "href": "/about", "external": false}
      ]
    }
  ],
  "edges": [
    {"from": "p1", "to": "p2", "trigger": "click", "elementRef": "e2"}
  ],
  "loginStatus": {
    "attempted": true,
    "ok": true
  }
}
\`\`\`

## Rules

- Use ONLY the provided browser tools (snapshot/navigate/click/fill/select_option/scroll/wait)
- Always call snapshot() before interacting with a page to understand its structure
- Stay within the same domain - don't follow external links
- Be thorough but efficient - don't click the same element twice
- If you encounter an error, note it and continue exploring other paths
- When you've explored all reachable pages up to the depth limit, output your findings

## Begin Exploration

Start by navigating to ${config.auth?.loginUrl ?? config.baseUrl} and calling snapshot() to see the initial page structure.
`
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function parseExplorationResult(agentOutput: string): {
  pages: PageNode[]
  edges: NavigationEdge[]
  loginStatus?: { attempted: boolean; ok: boolean }
} | null {
  // Try to extract JSON from the agent's output
  const jsonMatch = agentOutput.match(/```json\s*([\s\S]*?)\s*```/)
  if (!jsonMatch) {
    // Try to find raw JSON object
    const rawMatch = agentOutput.match(/\{[\s\S]*"pages"[\s\S]*\}/)
    if (!rawMatch) return null
    try {
      return JSON.parse(rawMatch[0])
    } catch {
      return null
    }
  }

  try {
    return JSON.parse(jsonMatch[1])
  } catch {
    return null
  }
}

export async function runExploreAgent(options: ExploreAgentOptions): Promise<ExplorationResult> {
  const { runId, config, page, cwd, logger, debug = false } = options
  const startedAt = new Date().toISOString()
  
  const transcript: TranscriptEntry[] = []
  let turnCount = 0
  let snapshotCount = 0
  let guardrailTriggered: GuardrailTrigger | undefined

  const guardrailLimits = {
    maxAgentTurns: config.guardrails?.maxAgentTurnsPerRun ?? 200,
    maxSnapshots: config.guardrails?.maxSnapshotsPerRun ?? 100,
    maxPages: config.guardrails?.maxPagesPerRun ?? 50,
  }

  // Log exploration started
  logger.log({
    event: 'autoqa.plan.explore.started',
    runId,
    url: config.baseUrl,
    depth: config.maxDepth ?? 3,
  })

  // Create MCP server for browser tools
  const server = createBrowserToolsMcpServer({
    page,
    baseUrl: config.baseUrl,
    runId,
    debug,
    cwd,
    specPath: 'explore',
    logger,
  })

  if (debug) {
    process.stderr.write(`[explore] mcp=browser (navigate/click/fill/snapshot)\n`)
  }

  const prompt = buildExplorePrompt(config)
  
  // Record the prompt in transcript
  transcript.push({
    timestamp: new Date().toISOString(),
    runId,
    type: 'agent_prompt',
    prompt,
  })

  let agentOutput = ''
  let lastError: Error | undefined

  try {
    const response = query({
      prompt,
      options: {
        maxTurns: guardrailLimits.maxAgentTurns,
        tools: [],
        mcpServers: {
          browser: server,
        },
        allowedTools: [...EXPLORE_ALLOWED_TOOLS],
        persistSession: false,
      },
    })

    for await (const message of response as any) {
      turnCount++

      // Check guardrails
      if (turnCount >= guardrailLimits.maxAgentTurns) {
        guardrailTriggered = {
          code: 'MAX_AGENT_TURNS',
          limit: guardrailLimits.maxAgentTurns,
          actual: turnCount,
          triggeredAt: new Date().toISOString(),
        }
        logger.log({
          event: 'autoqa.guardrail.triggered',
          runId,
          specPath: 'explore',
          stepIndex: null,
          code: 'MAX_AGENT_TURNS',
          limit: guardrailLimits.maxAgentTurns,
          actual: turnCount,
        })
        break
      }

      if (message?.type === 'assistant') {
        const content = message?.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block?.type === 'text') {
              const text = block?.text ?? ''
              agentOutput += text + '\n'
              if (debug) {
                process.stderr.write(`[explore] ${text.slice(0, 200)}\n`)
              }
            }

            if (block?.type === 'tool_use') {
              const toolName = block?.name ?? ''
              const toolInput = block?.input ?? {}

              // Track snapshots for guardrail
              if (toolName.includes('snapshot')) {
                snapshotCount++
                if (snapshotCount >= guardrailLimits.maxSnapshots) {
                  guardrailTriggered = {
                    code: 'MAX_SNAPSHOTS',
                    limit: guardrailLimits.maxSnapshots,
                    actual: snapshotCount,
                    triggeredAt: new Date().toISOString(),
                  }
                  logger.log({
                    event: 'autoqa.guardrail.triggered',
                    runId,
                    specPath: 'explore',
                    stepIndex: null,
                    code: 'MAX_SNAPSHOTS',
                    limit: guardrailLimits.maxSnapshots,
                    actual: snapshotCount,
                  })
                }
              }

              // Record tool call in transcript
              transcript.push({
                timestamp: new Date().toISOString(),
                runId,
                type: 'tool_call',
                toolName,
                toolInput,
              })

              if (debug) {
                process.stderr.write(`[explore] tool_use=${toolName} input=${safeStringify(toolInput).slice(0, 200)}\n`)
              }
            }
          }
        }
      }

      if (message?.type === 'user') {
        const content = message?.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block?.type === 'tool_result') {
              const isError = Boolean(block?.is_error)
              const resultText = String(block?.content ?? '').slice(0, 500)

              // Record tool result in transcript
              transcript.push({
                timestamp: new Date().toISOString(),
                runId,
                type: 'tool_result',
                isError,
                result: resultText,
              })

              if (debug) {
                process.stderr.write(`[explore] tool_result error=${isError} ${resultText.slice(0, 100)}\n`)
              }
            }
          }
        }
      }
    }
  } catch (err) {
    lastError = err instanceof Error ? err : new Error(String(err))
    logger.log({
      event: 'autoqa.plan.explore.failed',
      runId,
      error: lastError.message,
    })
  }

  const finishedAt = new Date().toISOString()

  // Parse the agent's exploration result
  const parsed = parseExplorationResult(agentOutput)

  // Build the result
  const result: ExplorationResult = {
    runId,
    startUrl: config.baseUrl,
    startedAt,
    finishedAt,
    stats: {
      pagesVisited: parsed?.pages?.length ?? 0,
      elementsFound: parsed?.pages?.reduce((sum, p) => sum + (p.elementSummary?.length ?? 0), 0) ?? 0,
      formsFound: parsed?.pages?.reduce((sum, p) => sum + (p.forms?.length ?? 0), 0) ?? 0,
      linksFound: parsed?.pages?.reduce((sum, p) => sum + (p.links?.length ?? 0), 0) ?? 0,
      maxDepthReached: Math.max(0, ...(parsed?.pages?.map(p => p.depth) ?? [0])),
      configuredDepth: config.maxDepth ?? 3,
    },
    graph: {
      pages: parsed?.pages ?? [],
      edges: parsed?.edges ?? [],
    },
    transcript,
  }

  // Add login status if auth was configured
  if (config.auth) {
    result.login = {
      attempted: parsed?.loginStatus?.attempted ?? true,
      ok: parsed?.loginStatus?.ok ?? false,
    }
    if (!result.login.ok) {
      result.error = {
        message: 'Login failed',
        stage: 'login',
      }
    }
  }

  // Add error if exploration failed
  if (lastError && !result.error) {
    result.error = {
      message: lastError.message,
      stage: 'exploration',
    }
  }

  // Add guardrail trigger info
  if (guardrailTriggered) {
    result.guardrailTriggered = guardrailTriggered
    transcript.push({
      timestamp: guardrailTriggered.triggeredAt,
      runId,
      type: 'guardrail_triggered',
      guardrail: guardrailTriggered,
    })
  }

  // Log completion
  logger.log({
    event: 'autoqa.plan.explore.finished',
    runId,
    stats: result.stats,
  })

  return result
}
