import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Browser } from 'playwright'

import type { Logger } from '../logging/index.js'
import type { PlanConfig, ExplorationGraph, TestPlan, ExplorationResult } from './types.js'
import { writeTestPlan, writeExplorationResult, writePlanSummary, type WriteTestPlanOutput } from './output.js'
import { runPlanAgent, type PlanAgentOptions } from './plan-agent.js'
import { explore } from './explore.js'

export type GenerateTestPlanOptions = {
  runId: string
  config: PlanConfig
  cwd?: string
  logger: Logger
  debug?: boolean
}

export type GenerateTestPlanResult = {
  plan: TestPlan
  output: WriteTestPlanOutput
}

export type RunPlanOptions = {
  runId: string
  config: PlanConfig
  browser: Browser
  cwd?: string
  logger: Logger
  debug?: boolean
  mode?: 'full' | 'explore-only' | 'generate-only'
}

export type RunPlanResult = {
  exploration?: ExplorationResult
  plan?: TestPlan
  explorationOutput?: {
    graphPath?: string
    elementsPath?: string
    transcriptPath?: string
    errors: string[]
  }
  planOutput?: WriteTestPlanOutput
  guardrailTriggered?: boolean
}

function sanitizeRunId(value: string): string {
  const cleaned = (value ?? '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
  if (cleaned === '.' || cleaned === '..') return 'unknown'
  return cleaned.length > 0 ? cleaned : 'unknown'
}

async function readExplorationGraph(cwd: string, runId: string): Promise<ExplorationGraph> {
  const safeRunId = sanitizeRunId(runId)
  const dir = resolve(cwd, '.autoqa', 'runs', safeRunId, 'plan-explore')
  const graphPath = resolve(dir, 'explore-graph.json')
  let raw: string
  try {
    raw = await readFile(graphPath, 'utf-8')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Failed to read exploration graph from ${graphPath}: ${msg}`)
  }

  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Failed to parse exploration graph JSON: ${msg}`)
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.pages) || !Array.isArray(parsed.edges)) {
    throw new Error('Invalid ExplorationGraph structure in explore-graph.json')
  }

  return parsed as ExplorationGraph
}

export async function generateTestPlan(options: GenerateTestPlanOptions): Promise<GenerateTestPlanResult> {
  const { runId, config, logger } = options
  const cwd = options.cwd ?? process.cwd()
  const debug = options.debug === true

  const graph = await readExplorationGraph(cwd, runId)

  logger.log({
    event: 'autoqa.plan.generate.orchestrator.started',
    runId,
    pageCount: graph.pages.length,
  })

  const planAgentOptions: PlanAgentOptions = {
    runId,
    config,
    graph,
    cwd,
    logger,
    debug,
  }

  const plan = await runPlanAgent(planAgentOptions)
  const output = await writeTestPlan(plan, { cwd, runId })

  if (output.errors.length > 0) {
    logger.log({
      event: 'autoqa.plan.generate.orchestrator.output_errors',
      runId,
      errors: output.errors,
    })
  }

  logger.log({
    event: 'autoqa.plan.generate.orchestrator.finished',
    runId,
    caseCount: plan.cases.length,
    specCount: output.specPaths.length,
  })

  return { plan, output }
}

export async function runPlan(options: RunPlanOptions): Promise<RunPlanResult> {
  const { runId, config, browser, logger, mode = 'full' } = options
  const cwd = options.cwd ?? process.cwd()
  const debug = options.debug === true

  const result: RunPlanResult = {}

  logger.log({
    event: 'autoqa.plan.started',
    runId,
    baseUrl: config.baseUrl,
  })

  try {
    if (mode === 'full' || mode === 'explore-only') {
      logger.log({
        event: 'autoqa.plan.explore.started',
        runId,
        url: config.baseUrl,
        depth: config.maxDepth,
      })

      const explorationResult = await explore({
        config,
        browser,
        logger,
        runId,
        cwd,
      })

      result.exploration = explorationResult
      result.guardrailTriggered = !!explorationResult.guardrailTriggered

      const explorationOutput = await writeExplorationResult(explorationResult, { runId, cwd })
      result.explorationOutput = explorationOutput

      logger.log({
        event: 'autoqa.plan.explore.finished',
        runId,
        stats: explorationResult.stats,
      })

      if (mode === 'explore-only') {
        logger.log({
          event: 'autoqa.plan.finished',
          runId,
          pagesVisited: explorationResult.stats.pagesVisited,
          caseCount: 0,
          specCount: 0,
        })
        return result
      }
    }

    if (mode === 'full' || mode === 'generate-only') {
      logger.log({
        event: 'autoqa.plan.generate.started',
        runId,
        baseUrl: config.baseUrl,
        pageCount: result.exploration?.graph.pages.length ?? 0,
      })

      const testPlanResult = await generateTestPlan({
        runId,
        config,
        logger,
        cwd,
        debug,
      })

      result.plan = testPlanResult.plan
      result.planOutput = testPlanResult.output

      logger.log({
        event: 'autoqa.plan.generate.finished',
        runId,
        caseCount: testPlanResult.plan.cases.length,
      })

      logger.log({
        event: 'autoqa.plan.finished',
        runId,
        pagesVisited: result.exploration?.stats.pagesVisited ?? 0,
        caseCount: testPlanResult.plan.cases.length,
        specCount: testPlanResult.output.specPaths.length,
      })
    }

    const summaryResult = await writePlanSummary({
      runId,
      cwd,
      exploration: result.exploration,
      plan: result.plan,
      guardrailTriggered: result.guardrailTriggered,
      exitCode: result.guardrailTriggered ? 10 : 0,
    })

    if (summaryResult.error) {
      logger.log({
        event: 'autoqa.plan.generate.orchestrator.output_errors',
        runId,
        errors: [summaryResult.error],
      })
    }

    return result
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.log({
      event: 'autoqa.plan.failed',
      runId,
      error: errorMessage,
    })

    await writePlanSummary({
      runId,
      cwd,
      exploration: result.exploration,
      plan: result.plan,
      guardrailTriggered: result.guardrailTriggered,
      exitCode: 1,
    }).catch((summaryError) => {
      logger.log({
        event: 'autoqa.plan.generate.orchestrator.output_errors',
        runId,
        errors: [summaryError instanceof Error ? summaryError.message : String(summaryError)],
      })
    })

    throw error
  }
}
