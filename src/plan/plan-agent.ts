import { query } from '@anthropic-ai/claude-agent-sdk'

import type { Logger } from '../logging/index.js'
import type { PlanConfig, ExplorationGraph, TestPlan, FlowPlan, TestCasePlan } from './types.js'
import { createPlannerToolsMcpServer } from './planner-tools-mcp.js'

export type PlanAgentOptions = {
  runId: string
  config: PlanConfig
  graph: ExplorationGraph
  cwd: string
  logger: Logger
  debug?: boolean
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
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

function generateUrlMappingExamples(baseUrl: string, graph: ExplorationGraph, loginUrl?: string): string {
  const url = new URL(baseUrl)
  const origin = url.origin

  let loginOrigin: string | undefined
  let loginPathPrefix: string | undefined
  
  if (loginUrl) {
    try {
      const loginUrlObj = new URL(loginUrl)
      loginOrigin = loginUrlObj.origin
      loginPathPrefix = loginUrlObj.pathname
    } catch {
      // Invalid loginUrl, ignore
    }
  }

  const exampleUrls: string[] = []

  for (const page of graph.pages.slice(0, 5)) {
    try {
      const pageUrl = new URL(page.url)
      if (pageUrl.origin === origin) {
        const relativePath = pageUrl.pathname + pageUrl.hash + pageUrl.search

        // Check if this page matches the configured login URL
        const isLoginPage = loginOrigin && loginPathPrefix &&
          pageUrl.origin === loginOrigin &&
          pageUrl.pathname.startsWith(loginPathPrefix)
        
        const templateVar = isLoginPage ? '{{LOGIN_BASE_URL}}' : '{{BASE_URL}}'

        exampleUrls.push(`  - Actual URL: ${page.url}`)
        exampleUrls.push(`    In test case: ${templateVar}${relativePath}`)
      }
    } catch {
      // Skip invalid URLs
    }
  }

  if (exampleUrls.length === 0) {
    return `URL Mapping and Template Variables:
- For all URLs within the baseUrl domain (${origin}), use {{BASE_URL}} + relative path
- For login pages, use {{LOGIN_BASE_URL}} if different from baseUrl
- For credentials, use {{USERNAME}} and {{PASSWORD}}

Examples:
  - Actual URL: ${baseUrl}
    In test case: {{BASE_URL}}/
  - Actual URL: ${origin}/login
    In test case: {{LOGIN_BASE_URL}}/login`
  }

  return `URL Mapping and Template Variables:
- For all URLs within the baseUrl domain (${origin}), use {{BASE_URL}} + relative path
- For login pages, use {{LOGIN_BASE_URL}} if different from baseUrl
- For credentials, use {{USERNAME}} and {{PASSWORD}}

Examples from explored pages:
${exampleUrls.join('\n')}

Note: If LOGIN_BASE_URL is not provided, it defaults to BASE_URL for all URLs.`
}

export function buildPlanPrompt(options: PlanAgentOptions): string {
  const { config, graph } = options
  const pagesSummaryLines: string[] = []
  for (const page of graph.pages) {
    pagesSummaryLines.push(`- [${page.id}] ${page.url} (depth=${page.depth})`)
  }

  const pagesSummary = pagesSummaryLines.join('\n')
  const testTypes = (config.testTypes && config.testTypes.length > 0)
    ? config.testTypes.join(', ')
    : 'functional, form, navigation, responsive, boundary, security'

  const guardrailLines: string[] = []
  if (config.guardrails?.maxAgentTurnsPerRun != null) {
    guardrailLines.push(`- Maximum planning turns: ${config.guardrails.maxAgentTurnsPerRun}`)
  }
  if (config.guardrails?.maxPagesPerRun != null) {
    guardrailLines.push(`- Maximum pages to consider: ${config.guardrails.maxPagesPerRun}`)
  }

  const guardrailSection = guardrailLines.length > 0
    ? `Guardrails:\n${guardrailLines.join('\n')}`
    : ''

  // Generate URL mapping examples for template variable usage
  const urlMappingExamples = generateUrlMappingExamples(config.baseUrl, graph, config.auth?.loginUrl)

  return `You are an AutoQA Test Planner Agent.

Your task is to design a structured test plan (TestPlan) based on the exploration results of a web application.

Base URL: ${config.baseUrl}
Max exploration depth: ${config.maxDepth}
Planned test types: ${testTypes}
${guardrailSection}

ExplorationGraph summary (pages):
${pagesSummary}

${urlMappingExamples}

# Test Planning Principles

## 1. Comprehensive Scenario Coverage

For each key behavior discovered during exploration (search, forms, login, CRUD operations, navigation), you MUST generate:

**Happy Path Cases:**
- At least ONE test case covering the normal, successful flow
- Use valid inputs and expected user interactions
- Verify successful outcomes and state changes

**Boundary & Negative Cases:**
- At least ONE test case covering edge cases and error conditions
- Examples of boundary/negative scenarios:
  - Empty or missing required fields
  - Invalid input formats (special characters, excessive length)
  - Non-existent search queries (no results)
  - Unauthorized access attempts
  - Invalid credentials for login
  - Boundary values (min/max lengths, numeric limits)

## 2. Test Case Quality Standards

Each test case MUST include:

**Clear Initial State (Preconditions):**
- Specify starting world state: logged in/out, cart empty/populated, specific data exists
- Include environment requirements: URLs accessible, test accounts available
- Use template variables for all URLs and credentials
- Example: "User is logged out", "Shopping cart contains 2 items", "Test product 'Widget-A' exists in inventory"

**Executable Steps with Specific Actions:**
- Use action verbs: Navigate, Click, Fill, Select, Verify, Expect
- Navigation steps MUST include full URLs with template variables
  - CORRECT: "Navigate to {{BASE_URL}}/products/search"
  - WRONG: "Go to search page" (too vague)
- Interaction steps must specify exact element targets
  - CORRECT: "Fill the 'Search' input field with 'laptop'"
  - WRONG: "Enter search term" (missing specifics)

**Verifiable Success Criteria (Expected Results):**
- Each step MUST have a non-empty, specific expectedResult
- Describe observable outcomes that can be automatically verified
- CORRECT: "The search results show at least 1 product matching 'laptop'"
- CORRECT: "Error message 'Username is required' appears below the username field"
- WRONG: "The page works correctly" (too vague)
- WRONG: "User sees results" (not specific enough)

**Test Independence:**
- Each test case should be executable independently
- Avoid dependencies on side effects from other test cases
- Set up required state in preconditions or initial steps

## 3. Markdown Structure Requirements

The generated test cases MUST be executable by the AutoQA runner. Follow these rules strictly:

**Preconditions:**
- MUST include key URLs using template variables ({{BASE_URL}}, {{LOGIN_BASE_URL}})
- Example: "Base URL accessible: {{BASE_URL}}"
- Example: "Login page accessible: {{LOGIN_BASE_URL}}/login"
- If authentication required: "Valid test account available (via AUTOQA_USERNAME / AUTOQA_PASSWORD environment variables)"
- Describe initial state clearly (e.g., "Shopping cart is empty", "User is logged out")

**Steps:**
- Use executable action verbs: Navigate, Click, Fill, Select, Verify, Expect
- Navigation steps MUST include specific URLs with template variables
  - CORRECT: "Navigate to {{BASE_URL}}/products"
  - WRONG: "Navigate to products page" (too vague)
- For pages within the baseUrl domain, always use {{BASE_URL}} + relative path
- For login pages, use {{LOGIN_BASE_URL}} if different from baseUrl
- Verification steps should be specific and testable
  - CORRECT: "Verify the page title is 'Products'"
  - WRONG: "Verify the page loads correctly" (too vague)

**Expected Results:**
- Each step's expectedResult MUST be non-empty and specific
- Describe observable, verifiable outcomes
- CORRECT: "The cart badge shows count of 1"
- WRONG: "The page works as expected" (too vague)

**Credentials and Sensitive Data:**
- Use {{USERNAME}} and {{PASSWORD}} placeholders
- Never include actual credentials in test cases
- Reference environment variables in preconditions

## 4. Output Format

Respond with JSON in the following shape, and nothing else:
{
  "flows": [
    {"id": "flow-id", "name": "Flow Name", "description": "...", "pagePath": ["page-id-1", "page-id-2"]}
  ],
  "cases": [
    {
      "id": "case-id",
      "name": "Test case name",
      "type": "functional" | "form" | "navigation" | "responsive" | "boundary" | "security",
      "priority": "p0" | "p1" | "p2",
      "relatedPageIds": ["page-id-1", "page-id-2"],
      "markdownPath": "relative/path/to/spec.md",
      "preconditions": [
        "Base URL accessible: {{BASE_URL}}",
        "User is logged out",
        "Other specific preconditions with clear initial state..."
      ],
      "steps": [
        {
          "description": "Navigate to {{BASE_URL}}/specific/path",
          "expectedResult": "Specific, verifiable outcome"
        },
        {
          "description": "Click the 'Submit' button",
          "expectedResult": "Form is submitted and success message appears"
        }
      ]
    }
  ]
}

CRITICAL: For each key behavior (search, form, login, CRUD), generate BOTH happy path AND boundary/negative cases.

Do not include any commentary outside of the JSON structure.`
}

function normalizeFlow(flow: any, index: number): FlowPlan {
  const id = typeof flow?.id === 'string' && flow.id.trim().length > 0
    ? flow.id.trim()
    : `flow-${index + 1}`
  const name = typeof flow?.name === 'string' && flow.name.trim().length > 0
    ? flow.name.trim()
    : id
  const description = typeof flow?.description === 'string' ? flow.description : undefined
  const pagePath = Array.isArray(flow?.pagePath)
    ? (flow.pagePath as unknown[]).filter((v) => typeof v === 'string') as string[]
    : undefined

  return { id, name, description, pagePath }
}

const VALID_TYPES: TestCasePlan['type'][] = ['functional', 'form', 'navigation', 'responsive', 'boundary', 'security']
const VALID_PRIORITIES: TestCasePlan['priority'][] = ['p0', 'p1', 'p2']

function normalizeCase(testCase: any, index: number): TestCasePlan {
  const id = typeof testCase?.id === 'string' && testCase.id.trim().length > 0
    ? testCase.id.trim()
    : `case-${index + 1}`
  const name = typeof testCase?.name === 'string' && testCase.name.trim().length > 0
    ? testCase.name.trim()
    : id

  const rawType = typeof testCase?.type === 'string' ? testCase.type.trim() : ''
  const type = (VALID_TYPES as string[]).includes(rawType) ? rawType as TestCasePlan['type'] : 'functional'

  const rawPriority = typeof testCase?.priority === 'string' ? testCase.priority.trim() : ''
  const priority = (VALID_PRIORITIES as string[]).includes(rawPriority)
    ? rawPriority as TestCasePlan['priority']
    : 'p1'

  const relatedPageIds = Array.isArray(testCase?.relatedPageIds)
    ? (testCase.relatedPageIds as unknown[]).filter((v) => typeof v === 'string') as string[]
    : []

  const markdownPath = typeof testCase?.markdownPath === 'string'
    ? testCase.markdownPath
    : ''

  const preconditions = Array.isArray(testCase?.preconditions)
    ? (testCase.preconditions as unknown[]).filter((v) => typeof v === 'string') as string[]
    : undefined

  const steps = Array.isArray(testCase?.steps)
    ? (testCase.steps as unknown[])
      .map((s) => {
        const description = typeof (s as any)?.description === 'string' ? (s as any).description : ''
        const expectedResult = typeof (s as any)?.expectedResult === 'string' ? (s as any).expectedResult : ''
        if (!description && !expectedResult) return null
        return { description, expectedResult }
      })
      .filter((v): v is { description: string; expectedResult: string } => v !== null)
    : undefined

  return {
    id,
    name,
    type,
    priority,
    relatedPageIds,
    markdownPath,
    preconditions,
    steps,
  }
}

function parseTestPlanOutput(jsonText: string, config: PlanConfig, runId: string): TestPlan {
  let parsed: any
  try {
    parsed = JSON.parse(jsonText)
  } catch (err) {
    throw new Error(`Failed to parse TestPlan JSON: ${err instanceof Error ? err.message : String(err)}`)
  }

  const rawFlows = Array.isArray(parsed?.flows) ? parsed.flows as unknown[] : []
  const rawCases = Array.isArray(parsed?.cases) ? parsed.cases as unknown[] : []

  const flows: FlowPlan[] = rawFlows.map((f, index) => normalizeFlow(f, index))
  const cases: TestCasePlan[] = rawCases.map((c, index) => normalizeCase(c, index))

  if (cases.length === 0) {
    throw new Error('Planner Agent returned no test cases in TestPlan')
  }

  return {
    runId,
    generatedAt: new Date().toISOString(),
    configSnapshot: config,
    flows,
    cases,
  }
}

function extractJsonFromOutput(output: string): string {
  const fencedMatch = output.match(/```json\s*([\s\S]*?)```/)
  if (fencedMatch) {
    return fencedMatch[1].trim()
  }

  let startIdx = output.indexOf('{')
  if (startIdx === -1) {
    throw new Error('Failed to extract JSON TestPlan from planner output: no opening brace found')
  }

  let depth = 0
  let endIdx = -1
  for (let i = startIdx; i < output.length; i++) {
    if (output[i] === '{') depth++
    if (output[i] === '}') {
      depth--
      if (depth === 0) {
        endIdx = i
        break
      }
    }
  }

  if (endIdx === -1) {
    throw new Error('Failed to extract JSON TestPlan from planner output: no matching closing brace')
  }

  return output.substring(startIdx, endIdx + 1)
}

export async function runPlanAgent(options: PlanAgentOptions): Promise<TestPlan> {
  const { runId, config, graph, cwd, logger, debug = false } = options

  logger.log({
    event: 'autoqa.plan.generate.started',
    runId,
    baseUrl: config.baseUrl,
    pageCount: graph.pages.length,
  })

  const prompt = buildPlanPrompt(options)

  let agentOutput = ''
  let lastError: Error | undefined

  try {
    const maxTurns = config.guardrails?.maxAgentTurnsPerRun ?? 40

    const plannerServer = createPlannerToolsMcpServer({
      graph,
      cwd,
      runId,
      logger,
    })

    const response = query({
      prompt,
      options: {
        maxTurns,
        tools: [],
        mcpServers: {
          planner: plannerServer,
        },
        allowedTools: [
          'mcp__planner__list_known_pages',
          'mcp__planner__get_page_snapshot',
          'mcp__planner__propose_test_cases_for_page',
        ],
        persistSession: false,
      },
    })

    for await (const message of response as any) {
      if (message?.type === 'assistant') {
        const content = getAssistantContent(message)
        if (typeof content === 'string') {
          agentOutput += content + '\n'
          if (debug) {
            // Avoid leaking secrets; only log length
            try {
              process.stderr.write(`[plan] assistant text chunk len=${content.length}\n`)
            } catch {}
          }
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block?.type === 'text') {
              const text = typeof block.text === 'string' ? block.text : ''
              if (text.length > 0) {
                agentOutput += text + '\n'
                if (debug) {
                  try {
                    process.stderr.write(`[plan] assistant text block len=${text.length}\n`)
                  } catch {}
                }
              }
            }
          }
        }
        continue
      }

      if (message?.type === 'result') {
        const text = typeof message?.result === 'string' ? message.result : (typeof message?.text === 'string' ? message.text : '')
        if (text.length > 0) {
          agentOutput += text
          if (debug) {
            try {
              process.stderr.write(`[plan] result text len=${text.length}\n`)
            } catch {}
          }
        }
        continue
      }

      if (debug && message?.type === 'error') {
        try {
          process.stderr.write(`[plan] error message=${safeStringify(message)}\n`)
        } catch {}
      }
    }
  } catch (err) {
    lastError = err instanceof Error ? err : new Error(String(err))
  }

  if (!agentOutput || agentOutput.trim().length === 0) {
    if (lastError) {
      throw lastError
    }
    throw new Error('Planner Agent produced no output')
  }

  const jsonText = extractJsonFromOutput(agentOutput)
  const plan = parseTestPlanOutput(jsonText, config, runId)

  logger.log({
    event: 'autoqa.plan.generate.finished',
    runId,
    caseCount: plan.cases.length,
  })

  return plan
}
