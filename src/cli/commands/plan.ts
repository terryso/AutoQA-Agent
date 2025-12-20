/**
 * Plan CLI Commands
 * Implements `autoqa plan explore` command
 * Based on Tech Spec: ts-7-agent-based-intelligent-planner.md
 */
import { Command } from 'commander'
import { randomUUID } from 'node:crypto'

import { createBrowser } from '../../browser/create-browser.js'
import { readConfig } from '../../config/read.js'
import { createLogger } from '../../logging/index.js'
import { explore } from '../../plan/explore.js'
import { writeExplorationResult } from '../../plan/output.js'
import { generateTestPlan } from '../../plan/orchestrator.js'
import type { PlanConfig, GuardrailConfig } from '../../plan/types.js'

const DEFAULT_MAX_DEPTH = 3
const VALID_TEST_TYPES = ['functional', 'form', 'navigation', 'responsive', 'boundary', 'security'] as const
const GUARDRAIL_EXIT_CODE = 10
const CONFIG_ERROR_EXIT_CODE = 2
const RUNTIME_ERROR_EXIT_CODE = 1

function validateDepth(value: string): number {
  const parsed = parseInt(value, 10)
  if (isNaN(parsed) || parsed < 0 || parsed > 10) {
    throw new Error('Depth must be a number between 0 and 10')
  }
  return parsed
}

function validatePositiveInt(value: string): number {
  const parsed = parseInt(value, 10)
  if (isNaN(parsed) || parsed < 1) {
    throw new Error('Value must be a positive integer')
  }
  return parsed
}

function validateUrl(value: string): string {
  try {
    new URL(value)
    return value
  } catch {
    throw new Error(`Invalid URL: ${value}`)
  }
}

function validateTestTypes(types: string): string[] {
  const typeList = types.split(',').map((t: string) => t.trim().toLowerCase())
  const invalid = typeList.filter(t => !VALID_TEST_TYPES.includes(t as any))
  if (invalid.length > 0) {
    throw new Error(`Invalid test types: ${invalid.join(', ')}. Valid types: ${VALID_TEST_TYPES.join(', ')}`)
  }
  return typeList
}

function sanitizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/password[=:]\s*[^\s&]+/gi, 'password=***')
    .replace(/token[=:]\s*[^\s&]+/gi, 'token=***')
    .replace(/api[_-]?key[=:]\s*[^\s&]+/gi, 'apikey=***')
    .replace(/secret[=:]\s*[^\s&]+/gi, 'secret=***')
}

function mergeConfigWithOptions(fileConfig: any, options: any): { config: PlanConfig; guardrails: GuardrailConfig } {
  const planConfig = fileConfig?.plan || {}
  
  const guardrails: GuardrailConfig = {}
  if (options.maxAgentTurns) guardrails.maxAgentTurnsPerRun = options.maxAgentTurns
  else if (planConfig.guardrails?.maxAgentTurnsPerRun) guardrails.maxAgentTurnsPerRun = planConfig.guardrails.maxAgentTurnsPerRun
  
  if (options.maxSnapshots) guardrails.maxSnapshotsPerRun = options.maxSnapshots
  else if (planConfig.guardrails?.maxSnapshotsPerRun) guardrails.maxSnapshotsPerRun = planConfig.guardrails.maxSnapshotsPerRun
  
  if (options.maxPages) guardrails.maxPagesPerRun = options.maxPages
  else if (planConfig.guardrails?.maxPagesPerRun) guardrails.maxPagesPerRun = planConfig.guardrails.maxPagesPerRun
  
  const baseUrl = options.url || planConfig.baseUrl
  if (!baseUrl) {
    throw new Error('baseUrl is required (provide via --url or autoqa.config.json plan.baseUrl)')
  }
  
  let testTypes: PlanConfig['testTypes'] = planConfig.testTypes
  if (options.testTypes) {
    testTypes = validateTestTypes(options.testTypes) as PlanConfig['testTypes']
  }
  
  const config: PlanConfig = {
    baseUrl,
    maxDepth: options.depth ?? planConfig.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxPages: options.maxPages ?? planConfig.maxPages,
    testTypes,
    guardrails: Object.keys(guardrails).length > 0 ? guardrails : undefined,
    auth: options.loginUrl ? {
      loginUrl: options.loginUrl,
      username: options.username,
      password: options.password,
    } : undefined,
  }
  
  return { config, guardrails }
}

type ConfigResult = { ok: true; config: PlanConfig } | { ok: false; exitCode: number }

function loadAndMergeConfig(cwd: string, options: any): ConfigResult {
  const configResult = readConfig(cwd)
  if (!configResult.ok) {
    console.error(`❌ Configuration error: ${configResult.error.message}`)
    return { ok: false, exitCode: CONFIG_ERROR_EXIT_CODE }
  }

  try {
    const merged = mergeConfigWithOptions(configResult.config, options)
    return { ok: true, config: merged.config }
  } catch (error) {
    console.error(`❌ ${sanitizeErrorMessage(error)}`)
    return { ok: false, exitCode: CONFIG_ERROR_EXIT_CODE }
  }
}

async function closeBrowserSafely(browserResult: any): Promise<void> {
  if (!browserResult) return
  
  const closeOperations = []
  if (browserResult.persistentContext) {
    closeOperations.push(
      browserResult.persistentContext.close().catch((err: any) => {
        console.error(`Warning: Failed to close persistent context: ${err.message}`)
      })
    )
  }
  if (browserResult.browser) {
    closeOperations.push(
      browserResult.browser.close().catch((err: any) => {
        console.error(`Warning: Failed to close browser: ${err.message}`)
      })
    )
  }
  
  await Promise.allSettled(closeOperations)
}

export function registerPlanCommand(program: Command): void {
  const plan = program
    .command('plan')
    .description('Plan and explore test scenarios')
    .option('--config <path>', 'Path to autoqa.config.json (default: ./autoqa.config.json)')

  plan
    .command('explore')
    .description('Explore a web application and generate page structure')
    .requiredOption('-u, --url <url>', 'Target application URL', validateUrl)
    .option('-d, --depth <number>', 'Maximum exploration depth (0-10)', validateDepth)
    .option('--max-pages <number>', 'Maximum pages to visit', validatePositiveInt)
    .option('--max-agent-turns <number>', 'Maximum agent tool calls (guardrail)', validatePositiveInt)
    .option('--max-snapshots <number>', 'Maximum snapshots to capture (guardrail)', validatePositiveInt)
    .option('--login-url <url>', 'Login page URL (optional)', validateUrl)
    .option('--username <username>', 'Login username (optional)')
    .option('--password <password>', 'Login password (optional)')
    .option('--headless', 'Run browser in headless mode', false)
    .action(async (options) => {
      const runId = randomUUID()
      const cwd = process.cwd()
      const logger = createLogger({ runId, cwd, debug: false, writeToFile: true })

      const configLoad = loadAndMergeConfig(cwd, options)
      if (!configLoad.ok) {
        process.exit(configLoad.exitCode)
      }
      const config = configLoad.config

      let browserResult = null
      try {
        browserResult = await createBrowser({ headless: options.headless })

        const result = await explore({
          config,
          browser: browserResult.browser,
          logger,
          runId,
          cwd: process.cwd(),
        })

        const writeOutput = await writeExplorationResult(result, { runId, cwd: process.cwd() })

        if (writeOutput.errors.length > 0) {
          console.error(`Errors writing exploration results:`)
          writeOutput.errors.forEach((e) => console.error(`  - ${e}`))
        }

        // Report results
        console.log(`\n✅ Exploration completed for runId: ${runId}`)
        console.log(`📊 Pages visited: ${result.stats.pagesVisited}`)
        console.log(`📄 Max depth reached: ${result.stats.maxDepthReached}`)
        console.log(`📁 Results written to: .autoqa/runs/${runId}/plan-explore/`)

        if (writeOutput.errors.length > 0) {
          console.error(`\n⚠️ Errors occurred:`)
          writeOutput.errors.forEach((e) => console.error(`  - ${e}`))
        }
      } catch (error) {
        logger.log({ event: 'autoqa.plan.explore.failed', runId, error: sanitizeErrorMessage(error) })
        console.error(`❌ Exploration failed: ${sanitizeErrorMessage(error)}`)
        process.exit(RUNTIME_ERROR_EXIT_CODE)
      } finally {
        await closeBrowserSafely(browserResult)
      }
    })

  plan
    .command('generate')
    .description('Generate test plan and Markdown specs from exploration artifacts')
    .requiredOption('--run-id <runId>', 'Exploration run ID to generate tests from')
    .requiredOption('-u, --url <url>', 'Target application URL', validateUrl)
    .option('--test-types <types>', 'Comma-separated list of test types (functional,form,navigation,responsive,boundary,security)')
    .option('--max-agent-turns <number>', 'Maximum agent turns for planning', validatePositiveInt)
    .action(async (options) => {
      const runId = options.runId
      const cwd = process.cwd()
      const logger = createLogger({ runId, cwd, debug: false, writeToFile: true })
      
      const configLoad = loadAndMergeConfig(cwd, options)
      if (!configLoad.ok) {
        process.exit(configLoad.exitCode)
      }
      const config = configLoad.config

      try {
        const result = await generateTestPlan({
          runId,
          config,
          logger,
          cwd: process.cwd(),
        })

        console.log(`\n✅ Test plan generated for runId: ${runId}`)
        console.log(`📋 Test cases created: ${result.plan.cases.length}`)
        console.log(`📁 Test specs written to: .autoqa/runs/${runId}/plan/specs/`)

        if (result.output.errors.length > 0) {
          console.error(`\n⚠️ Errors occurred:`)
          result.output.errors.forEach((e) => console.error(`  - ${e}`))
        }
      } catch (error) {
        logger.log({ event: 'autoqa.plan.generate.failed', runId, error: sanitizeErrorMessage(error) })
        console.error(`❌ Test plan generation failed: ${sanitizeErrorMessage(error)}`)
        process.exit(RUNTIME_ERROR_EXIT_CODE)
      }
    })

  // Combined command: explore + generate
  plan
    .command('run')
    .description('Run exploration and test case generation in sequence')
    .requiredOption('-u, --url <url>', 'Target application URL', validateUrl)
    .option('-d, --depth <number>', 'Maximum exploration depth (0-10)', validateDepth)
    .option('--max-pages <number>', 'Maximum pages to visit', validatePositiveInt)
    .option('--max-agent-turns <number>', 'Maximum agent tool calls (guardrail)', validatePositiveInt)
    .option('--max-snapshots <number>', 'Maximum snapshots to capture (guardrail)', validatePositiveInt)
    .option('--test-types <types>', 'Comma-separated list of test types')
    .option('--login-url <url>', 'Login page URL (optional)', validateUrl)
    .option('--username <username>', 'Login username (optional)')
    .option('--password <password>', 'Login password (optional)')
    .option('--headless', 'Run browser in headless mode', false)
    .action(async (options) => {
      const runId = randomUUID()
      const cwd = process.cwd()
      const logger = createLogger({ runId, cwd, debug: false, writeToFile: true })

      const configResult = readConfig(cwd)
      if (!configResult.ok) {
        console.error(`❌ Configuration error: ${configResult.error.message}`)
        process.exit(2)
      }

      let config: PlanConfig
      try {
        const merged = mergeConfigWithOptions(configResult.config, options)
        config = merged.config
      } catch (error) {
        console.error(`❌ ${error instanceof Error ? error.message : String(error)}`)
        process.exit(2)
      }

      let browserResult = null

      try {
        // Step 1: Exploration
        console.log(`🔍 Starting exploration...`)
        browserResult = await createBrowser({ headless: options.headless })

        const explorationResult = await explore({
          config,
          browser: browserResult.browser,
          logger,
          runId,
          cwd: process.cwd(),
        })

        const explorationOutput = await writeExplorationResult(explorationResult, { runId, cwd: process.cwd() })

        if (explorationOutput.errors.length > 0) {
          console.error(`\n⚠️ Exploration errors:`)
          explorationOutput.errors.forEach((e) => console.error(`  - ${e}`))
        }

        console.log(`\n✅ Exploration completed`)
        console.log(`📊 Pages visited: ${explorationResult.stats.pagesVisited}`)
        console.log(`📁 Exploration results: .autoqa/runs/${runId}/plan-explore/`)

        // Step 2: Generate test cases
        console.log(`\n📋 Generating test cases...`)
        const testPlanResult = await generateTestPlan({
          runId,
          config,
          logger,
          cwd: process.cwd(),
        })

        console.log(`\n✅ Test plan generated`)
        console.log(`📝 Test cases created: ${testPlanResult.plan.cases.length}`)
        console.log(`📁 Test specs: .autoqa/runs/${runId}/plan/specs/`)

        if (testPlanResult.output.errors.length > 0) {
          console.error(`\n⚠️ Test plan errors:`)
          testPlanResult.output.errors.forEach((e) => console.error(`  - ${e}`))
        }

        // Summary
        console.log(`\n🎉 Plan command completed successfully!`)
        console.log(`Run ID: ${runId}`)
        console.log(`Total artifacts:`)
        if (explorationOutput.graphPath) console.log(`  - Exploration graph: ${explorationOutput.graphPath}`)
        if (explorationOutput.elementsPath) console.log(`  - Elements: ${explorationOutput.elementsPath}`)
        if (explorationOutput.transcriptPath) console.log(`  - Transcript: ${explorationOutput.transcriptPath}`)
        console.log(`  - Test plan: .autoqa/runs/${runId}/plan/test-plan.json`)
        console.log(`  - Test specs: ${testPlanResult.output.specPaths.length} files`)

      } catch (error) {
        logger.log({ event: 'autoqa.plan.failed', runId, error: sanitizeErrorMessage(error) })
        console.error(`❌ Plan command failed: ${sanitizeErrorMessage(error)}`)
        process.exit(RUNTIME_ERROR_EXIT_CODE)
      } finally {
        await closeBrowserSafely(browserResult)
      }
    })

  plan
    .description('Plan and explore test scenarios (default: run full exploration + generation)')
    .requiredOption('-u, --url <url>', 'Target application URL', validateUrl)
    .option('-d, --depth <number>', 'Maximum exploration depth (0-10)', validateDepth)
    .option('--max-pages <number>', 'Maximum pages to visit', validatePositiveInt)
    .option('--max-agent-turns <number>', 'Maximum agent tool calls (guardrail)', validatePositiveInt)
    .option('--max-snapshots <number>', 'Maximum snapshots to capture (guardrail)', validatePositiveInt)
    .option('--test-types <types>', 'Comma-separated list of test types')
    .option('--login-url <url>', 'Login page URL (optional)', validateUrl)
    .option('--username <username>', 'Login username (optional)')
    .option('--password <password>', 'Login password (optional)')
    .option('--headless', 'Run browser in headless mode', false)
    .action(async (options) => {
      const runId = randomUUID()
      const cwd = process.cwd()
      const logger = createLogger({ runId, cwd, debug: false, writeToFile: true })

      const configLoad = loadAndMergeConfig(cwd, options)
      if (!configLoad.ok) {
        process.exit(configLoad.exitCode)
      }
      const config = configLoad.config

      let browserResult = null

      try {
        console.log(`🔍 Starting exploration...`)
        browserResult = await createBrowser({ headless: options.headless })

        const explorationResult = await explore({
          config,
          browser: browserResult.browser,
          logger,
          runId,
          cwd: process.cwd(),
        })

        const explorationOutput = await writeExplorationResult(explorationResult, { runId, cwd: process.cwd() })

        if (explorationOutput.errors.length > 0) {
          console.error(`\n⚠️ Exploration errors:`)
          explorationOutput.errors.forEach((e) => console.error(`  - ${e}`))
        }

        console.log(`\n✅ Exploration completed`)
        console.log(`📊 Pages visited: ${explorationResult.stats.pagesVisited}`)
        console.log(`📁 Exploration results: .autoqa/runs/${runId}/plan-explore/`)

        if (explorationResult.guardrailTriggered) {
          console.warn(`\n⚠️ Guardrail triggered: ${explorationResult.guardrailTriggered.code}`)
          console.warn(`   Limit: ${explorationResult.guardrailTriggered.limit}, Actual: ${explorationResult.guardrailTriggered.actual}`)
          logger.log({ 
            event: 'autoqa.plan.explore.finished', 
            runId, 
            stats: explorationResult.stats 
          })
          process.exit(GUARDRAIL_EXIT_CODE)
        }

        console.log(`\n📋 Generating test cases...`)
        const testPlanResult = await generateTestPlan({
          runId,
          config,
          logger,
          cwd: process.cwd(),
        })

        console.log(`\n✅ Test plan generated`)
        console.log(`📝 Test cases created: ${testPlanResult.plan.cases.length}`)
        console.log(`📁 Test specs: .autoqa/runs/${runId}/plan/specs/`)

        if (testPlanResult.output.errors.length > 0) {
          console.error(`\n⚠️ Test plan errors:`)
          testPlanResult.output.errors.forEach((e) => console.error(`  - ${e}`))
        }

        console.log(`\n🎉 Plan command completed successfully!`)
        console.log(`Run ID: ${runId}`)
        console.log(`Total artifacts:`)
        if (explorationOutput.graphPath) console.log(`  - Exploration graph: ${explorationOutput.graphPath}`)
        if (explorationOutput.elementsPath) console.log(`  - Elements: ${explorationOutput.elementsPath}`)
        if (explorationOutput.transcriptPath) console.log(`  - Transcript: ${explorationOutput.transcriptPath}`)
        console.log(`  - Test plan: .autoqa/runs/${runId}/plan/test-plan.json`)
        console.log(`  - Test specs: ${testPlanResult.output.specPaths.length} files`)

      } catch (error) {
        logger.log({ event: 'autoqa.plan.failed', runId, error: sanitizeErrorMessage(error) })
        console.error(`❌ Plan command failed: ${sanitizeErrorMessage(error)}`)
        process.exit(RUNTIME_ERROR_EXIT_CODE)
      } finally {
        await closeBrowserSafely(browserResult)
      }
    })
}
