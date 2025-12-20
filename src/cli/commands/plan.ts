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
  
  const config: PlanConfig = {
    baseUrl,
    maxDepth: options.depth ?? planConfig.maxDepth ?? 3,
    maxPages: options.maxPages ?? planConfig.maxPages,
    testTypes: options.testTypes ? options.testTypes.split(',').map((t: string) => t.trim().toLowerCase()) : planConfig.testTypes,
    guardrails: Object.keys(guardrails).length > 0 ? guardrails : undefined,
    auth: options.loginUrl ? {
      loginUrl: options.loginUrl,
      username: options.username,
      password: options.password,
    } : undefined,
  }
  
  return { config, guardrails }
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
    .option('-d, --depth <number>', 'Maximum exploration depth (0-10)', validateDepth, 3)
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
        logger.log({ event: 'autoqa.plan.explore.failed', runId, error: error instanceof Error ? error.message : String(error) })
        console.error(`❌ Exploration failed: ${error instanceof Error ? error.message : String(error)}`)
        process.exit(1)
      } finally {
        // Close browser properly - persistentContext or browser
        if (browserResult?.persistentContext) {
          await browserResult.persistentContext.close().catch(() => {})
        } else if (browserResult?.browser) {
          await browserResult.browser.close().catch(() => {})
        }
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

      try {
        const result = await generateTestPlan({
          runId,
          config,
          logger,
          cwd: process.cwd(),
        })

        // Report results
        console.log(`\n✅ Test plan generated for runId: ${runId}`)
        console.log(`📋 Test cases created: ${result.plan.cases.length}`)
        console.log(`📁 Test specs written to: .autoqa/runs/${runId}/plan/specs/`)

        if (result.output.errors.length > 0) {
          console.error(`\n⚠️ Errors occurred:`)
          result.output.errors.forEach((e) => console.error(`  - ${e}`))
        }
      } catch (error) {
        logger.log({ event: 'autoqa.plan.generate.failed', runId, error: error instanceof Error ? error.message : String(error) })
        console.error(`❌ Test plan generation failed: ${error instanceof Error ? error.message : String(error)}`)
        process.exit(1)
      }
    })

  // Combined command: explore + generate
  plan
    .command('run')
    .description('Run exploration and test case generation in sequence')
    .requiredOption('-u, --url <url>', 'Target application URL', validateUrl)
    .option('-d, --depth <number>', 'Maximum exploration depth (0-10)', validateDepth, 3)
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
        logger.log({ event: 'autoqa.plan.failed', runId, error: error instanceof Error ? error.message : String(error) })
        console.error(`❌ Plan command failed: ${error instanceof Error ? error.message : String(error)}`)
        process.exit(1)
      } finally {
        // Close browser properly - persistentContext or browser
        if (browserResult?.persistentContext) {
          await browserResult.persistentContext.close().catch(() => {})
        } else if (browserResult?.browser) {
          await browserResult.browser.close().catch(() => {})
        }
      }
    })
}
