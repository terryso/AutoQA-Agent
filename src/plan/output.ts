/**
 * Exploration Output Module
 * Writes three artifact files as required by AC2:
 * - explore-graph.json: Page nodes + navigation edges
 * - explore-elements.json: Interactive elements per page
 * - explore-transcript.jsonl: Agent tool calls and thinking
 */
import { mkdir, writeFile, appendFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'

import type {
  ExplorationResult,
  ExplorationGraph,
  ExplorationElements,
  TranscriptEntry,
  TestPlan,
  TestCasePlan,
  GuardrailTrigger,
} from './types.js'

export type WriteExplorationResultOptions = {
  cwd?: string
  runId: string
}

export type WriteExplorationOutput = {
  graphPath?: string
  elementsPath?: string
  transcriptPath?: string
  errors: string[]
}

function sanitizePathSegment(value: string): string {
  const cleaned = (value ?? '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
  if (cleaned === '.' || cleaned === '..') return 'unknown'
  return cleaned.length > 0 ? cleaned : 'unknown'
}

function validateRelativePath(path: string): boolean {
  if (!path || typeof path !== 'string') return false
  if (path.includes('..')) return false
  if (path.startsWith('/')) return false
  if (path.includes('\\')) return false
  const normalized = path.replace(/\/+/g, '/')
  return normalized === path
}

/**
 * Write explore-graph.json
 * Contains page nodes and navigation edges
 */
async function writeExplorationGraph(
  graph: ExplorationGraph,
  dir: string,
  runId: string,
): Promise<{ path?: string; error?: string }> {
  const fileName = 'explore-graph.json'
  const absPath = resolve(dir, fileName)
  const relPath = `.autoqa/runs/${runId}/plan-explore/${fileName}`

  try {
    // Validate graph structure
    if (!graph || typeof graph !== 'object') {
      return { error: 'Invalid graph: not an object' }
    }

    if (!graph.pages || !Array.isArray(graph.pages)) {
      return { error: 'Invalid graph: pages array is required' }
    }

    if (!graph.edges || !Array.isArray(graph.edges)) {
      return { error: 'Invalid graph: edges array is required' }
    }

    // Validate each page
    for (const page of graph.pages) {
      if (!page.id || !page.url) {
        return { error: 'Invalid page: missing required id or url' }
      }
    }

    const content = JSON.stringify(graph, null, 2)
    await writeFile(absPath, content, { encoding: 'utf-8', mode: 0o600 })
    return { path: relPath }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { error: `Failed to write explore-graph.json: ${msg}` }
  }
}

/**
 * Write explore-elements.json
 * Contains interactive elements per page
 */
async function writeExplorationElements(
  result: ExplorationResult,
  dir: string,
  runId: string,
): Promise<{ path?: string; error?: string }> {
  const fileName = 'explore-elements.json'
  const absPath = resolve(dir, fileName)
  const relPath = `.autoqa/runs/${runId}/plan-explore/${fileName}`

  const elements: ExplorationElements = {
    runId: result.runId,
    generatedAt: new Date().toISOString(),
    pages: result.graph.pages.map((page) => ({
      pageId: page.id,
      pageUrl: page.url,
      elements: page.elementSummary,
      forms: page.forms,
    })),
  }

  try {
    const content = JSON.stringify(elements, null, 2)
    await writeFile(absPath, content, { encoding: 'utf-8', mode: 0o600 })
    return { path: relPath }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { error: `Failed to write explore-elements.json: ${msg}` }
  }
}

/**
 * Write explore-transcript.jsonl
 * Contains Agent tool calls and thinking (one JSON per line)
 */
async function writeExplorationTranscript(
  transcript: TranscriptEntry[],
  dir: string,
  runId: string,
): Promise<{ path?: string; error?: string }> {
  const fileName = 'explore-transcript.jsonl'
  const absPath = resolve(dir, fileName)
  const relPath = `.autoqa/runs/${runId}/plan-explore/${fileName}`

  try {
    const lines = transcript.map((entry) => JSON.stringify(entry)).join('\n')
    await writeFile(absPath, lines + '\n', { encoding: 'utf-8', mode: 0o600 })
    return { path: relPath }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { error: `Failed to write explore-transcript.jsonl: ${msg}` }
  }
}

/**
 * Write all exploration artifacts
 * Creates three files as required by Story 7.1 AC2
 */
export async function writeExplorationResult(
  result: ExplorationResult,
  options: WriteExplorationResultOptions,
): Promise<WriteExplorationOutput> {
  const cwd = options.cwd ?? process.cwd()
  const runId = sanitizePathSegment(options.runId)
  const dir = resolve(cwd, '.autoqa', 'runs', runId, 'plan-explore')
  const errors: string[] = []
  const output: WriteExplorationOutput = { errors }

  try {
    await mkdir(dir, { recursive: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(`Failed to create output directory: ${msg}`)
    return output
  }

  // Write explore-graph.json
  const graphResult = await writeExplorationGraph(result.graph, dir, runId)
  if (graphResult.path) {
    output.graphPath = graphResult.path
  } else if (graphResult.error) {
    errors.push(graphResult.error)
  }

  // Write explore-elements.json
  const elementsResult = await writeExplorationElements(result, dir, runId)
  if (elementsResult.path) {
    output.elementsPath = elementsResult.path
  } else if (elementsResult.error) {
    errors.push(elementsResult.error)
  }

  // Write explore-transcript.jsonl
  const transcriptResult = await writeExplorationTranscript(result.transcript, dir, runId)
  if (transcriptResult.path) {
    output.transcriptPath = transcriptResult.path
  } else if (transcriptResult.error) {
    errors.push(transcriptResult.error)
  }

  return output
}

export type WriteTestPlanOptions = {
  cwd?: string
  runId: string
}

export type WriteTestPlanOutput = {
  planPath?: string
  specPaths: string[]
  errors: string[]
}

export function buildMarkdownForTestCase(testCase: TestCasePlan): string {
  const lines: string[] = []

  lines.push(`# ${testCase.name}`)
  lines.push('')
  lines.push(`Type: ${testCase.type} | Priority: ${testCase.priority.toUpperCase()}`)
  lines.push('')

  lines.push('## Preconditions')
  const preconditions = testCase.preconditions && testCase.preconditions.length > 0
    ? testCase.preconditions
    : ['Environment is prepared and application is reachable.']
  for (const p of preconditions) {
    lines.push(`- ${p}`)
  }

  lines.push('')
  lines.push('## Steps')
  const steps = testCase.steps && testCase.steps.length > 0
    ? testCase.steps
    : []

  if (steps.length === 0) {
    lines.push('1. Execute the main user journey for this test case.')
    lines.push('   - Expected: The application behaves as described in the test case name and type.')
  } else {
    steps.forEach((step, index) => {
      const n = index + 1
      lines.push(`${n}. ${step.description}`)
      const expected = step.expectedResult.trim()
      if (expected.length > 0) {
        lines.push(`   - Expected: ${expected}`)
      }
    })
  }

  lines.push('')
  return lines.join('\n')
}

export async function writeTestPlan(
  plan: TestPlan,
  options: WriteTestPlanOptions,
): Promise<WriteTestPlanOutput> {
  const cwd = options.cwd ?? process.cwd()
  const runId = sanitizePathSegment(options.runId)
  const baseDir = resolve(cwd, '.autoqa', 'runs', runId, 'plan')
  const specsDir = resolve(baseDir, 'specs')
  const errors: string[] = []
  const specPaths: string[] = []
  const output: WriteTestPlanOutput = { errors, specPaths }

  try {
    await mkdir(specsDir, { recursive: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(`Failed to create plan output directory: ${msg}`)
    return output
  }

  const planAbsPath = resolve(baseDir, 'test-plan.json')
  const planRelPath = `.autoqa/runs/${runId}/plan/test-plan.json`

  try {
    const content = JSON.stringify(plan, null, 2)
    await writeFile(planAbsPath, content, { encoding: 'utf-8', mode: 0o600 })
    output.planPath = planRelPath
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(`Failed to write test-plan.json: ${msg}`)
  }

  for (const testCase of plan.cases) {
    const rawRel = (testCase.markdownPath ?? '').trim()
    const safeRel = rawRel.length > 0
      ? rawRel
      : `${sanitizePathSegment(`${testCase.type}-${testCase.priority}-${testCase.id}`)}.md`
    
    if (!validateRelativePath(safeRel)) {
      errors.push(`Invalid markdownPath for case ${testCase.id}: path traversal or absolute path not allowed`)
      continue
    }

    const specAbsPath = resolve(specsDir, safeRel)
    if (!specAbsPath.startsWith(specsDir)) {
      errors.push(`Invalid markdownPath for case ${testCase.id}: resolved path outside specs directory`)
      continue
    }
    
    const specDir = dirname(specAbsPath)

    try {
      if (specDir !== specsDir) {
        await mkdir(specDir, { recursive: true })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`Failed to create directory for spec ${safeRel}: ${msg}`)
      continue
    }

    try {
      const markdown = buildMarkdownForTestCase(testCase)
      await writeFile(specAbsPath, markdown, { encoding: 'utf-8', mode: 0o600 })
      const relPath = `.autoqa/runs/${runId}/plan/specs/${safeRel}`
      specPaths.push(relPath)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`Failed to write spec ${safeRel}: ${msg}`)
    }
  }

  return output
}

/**
 * Plan summary artifact structure
 * Written to .autoqa/runs/<runId>/plan/plan-summary.json
 * 
 * Provides a high-level overview of the plan execution including:
 * - Exploration statistics (pages visited, elements found, etc.)
 * - Test plan statistics (cases generated, test types, priorities)
 * - Guardrail information if triggered
 * - Exit code for the plan execution
 */
export type PlanSummary = {
  /** Unique identifier for this plan run */
  runId: string
  /** ISO 8601 timestamp when the summary was generated */
  generatedAt: string
  /** Base URL of the application under test */
  baseUrl: string
  /** Statistics from the exploration phase */
  exploration: {
    /** Number of pages visited during exploration */
    pagesVisited: number
    /** Total number of interactive elements found */
    elementsFound: number
    /** Number of forms discovered */
    formsFound: number
    /** Number of links discovered */
    linksFound: number
    /** Maximum depth reached during exploration */
    maxDepthReached: number
    /** Configured maximum depth for exploration */
    configuredDepth: number
  }
  /** Statistics from the test plan generation phase */
  testPlan: {
    /** Total number of test cases generated */
    casesGenerated: number
    /** List of unique test types in the plan */
    testTypes: string[]
    /** Count of test cases by priority level */
    priorities: {
      /** Critical priority test cases */
      p0: number
      /** High priority test cases */
      p1: number
      /** Medium priority test cases */
      p2: number
    }
  }
  /** Information about guardrail trigger if it occurred */
  guardrailTriggered?: {
    /** Guardrail code that was triggered */
    code: string
    /** Configured limit for the guardrail */
    limit: number
    /** Actual value that exceeded the limit */
    actual: number
    /** ISO 8601 timestamp when guardrail was triggered */
    triggeredAt: string
  }
  /** Snapshot of effective configuration at plan time */
  effectiveConfig?: {
    baseUrl: string
    maxDepth: number
    maxPages?: number
    testTypes?: string[]
  }
  /** Exit code: 0 for success, 10 for guardrail, 1 for error, 2 for config error */
  exitCode: number
}

export type WritePlanSummaryOptions = {
  runId: string
  cwd?: string
  exploration?: ExplorationResult
  plan?: TestPlan
  guardrailTriggered?: boolean
  exitCode: number
}

export async function writePlanSummary(options: WritePlanSummaryOptions): Promise<{ path?: string; error?: string }> {
  const { runId, exploration, plan, guardrailTriggered, exitCode } = options
  const cwd = options.cwd ?? process.cwd()
  const safeRunId = sanitizePathSegment(runId)
  const baseDir = resolve(cwd, '.autoqa', 'runs', safeRunId, 'plan')
  const absPath = resolve(baseDir, 'plan-summary.json')
  const relPath = `.autoqa/runs/${safeRunId}/plan/plan-summary.json`

  try {
    await mkdir(baseDir, { recursive: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { error: `Failed to create plan directory: ${msg}` }
  }

  const summary: PlanSummary = {
    runId,
    generatedAt: new Date().toISOString(),
    baseUrl: exploration?.startUrl || plan?.configSnapshot.baseUrl || 'unknown',
    exploration: {
      pagesVisited: exploration?.stats.pagesVisited ?? 0,
      elementsFound: exploration?.stats.elementsFound ?? 0,
      formsFound: exploration?.stats.formsFound ?? 0,
      linksFound: exploration?.stats.linksFound ?? 0,
      maxDepthReached: exploration?.stats.maxDepthReached ?? 0,
      configuredDepth: exploration?.stats.configuredDepth ?? 0,
    },
    testPlan: (() => {
      if (!plan || !plan.cases.length) {
        return {
          casesGenerated: 0,
          testTypes: [],
          priorities: { p0: 0, p1: 0, p2: 0 },
        }
      }
      
      const typeSet = new Set<string>()
      const priorities = { p0: 0, p1: 0, p2: 0 }
      
      for (const testCase of plan.cases) {
        typeSet.add(testCase.type)
        if (testCase.priority === 'p0') priorities.p0++
        else if (testCase.priority === 'p1') priorities.p1++
        else if (testCase.priority === 'p2') priorities.p2++
      }
      
      return {
        casesGenerated: plan.cases.length,
        testTypes: Array.from(typeSet),
        priorities,
      }
    })(),
    exitCode,
  }

  if (guardrailTriggered && exploration?.guardrailTriggered) {
    summary.guardrailTriggered = {
      code: exploration.guardrailTriggered.code,
      limit: exploration.guardrailTriggered.limit,
      actual: exploration.guardrailTriggered.actual,
      triggeredAt: exploration.guardrailTriggered.triggeredAt,
    }
  }

  if (plan?.configSnapshot) {
    summary.effectiveConfig = {
      baseUrl: plan.configSnapshot.baseUrl,
      maxDepth: plan.configSnapshot.maxDepth,
      maxPages: plan.configSnapshot.maxPages,
      testTypes: plan.configSnapshot.testTypes,
    }
  }

  try {
    const content = JSON.stringify(summary, null, 2)
    await writeFile(absPath, content, { encoding: 'utf-8', mode: 0o600 })
    return { path: relPath }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { error: `Failed to write plan-summary.json: ${msg}` }
  }
}
