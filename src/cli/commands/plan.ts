/**
 * Plan CLI Commands
 * Implements `autoqa plan explore` command
 * Based on Tech Spec: ts-7-agent-based-intelligent-planner.md
 */
import { Command } from 'commander'
import { randomUUID } from 'node:crypto'

import { createBrowser } from '../../browser/create-browser.js'
import { createLogger } from '../../logging/index.js'
import { explore } from '../../plan/explore.js'
import { writeExplorationResult } from '../../plan/output.js'
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

export function registerPlanCommand(program: Command): void {
  const plan = program
    .command('plan')
    .description('Plan and explore test scenarios')

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
      const logger = createLogger({ runId, cwd: process.cwd(), debug: false, writeToFile: true })

      // Build guardrail config
      const guardrails: GuardrailConfig = {}
      if (options.maxAgentTurns) guardrails.maxAgentTurnsPerRun = options.maxAgentTurns
      if (options.maxSnapshots) guardrails.maxSnapshotsPerRun = options.maxSnapshots
      if (options.maxPages) guardrails.maxPagesPerRun = options.maxPages

      // Build config following Tech Spec structure
      const config: PlanConfig = {
        baseUrl: options.url,
        maxDepth: options.depth,
        maxPages: options.maxPages,
        guardrails: Object.keys(guardrails).length > 0 ? guardrails : undefined,
        auth: options.loginUrl ? {
          loginUrl: options.loginUrl,
          username: options.username,
          password: options.password,
        } : undefined,
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
        console.log(`\nExploration complete.`)
        console.log(`Run ID: ${runId}`)
        console.log(`\nArtifacts:`)
        if (writeOutput.graphPath) console.log(`  Graph: ${writeOutput.graphPath}`)
        if (writeOutput.elementsPath) console.log(`  Elements: ${writeOutput.elementsPath}`)
        if (writeOutput.transcriptPath) console.log(`  Transcript: ${writeOutput.transcriptPath}`)

        console.log(`\nStatistics:`)
        console.log(`  Pages visited: ${result.stats.pagesVisited}`)
        console.log(`  Elements found: ${result.stats.elementsFound}`)
        console.log(`  Forms found: ${result.stats.formsFound}`)
        console.log(`  Links found: ${result.stats.linksFound}`)
        console.log(`  Max depth reached: ${result.stats.maxDepthReached}`)

        if (result.guardrailTriggered) {
          console.log(`\nGuardrail triggered: ${result.guardrailTriggered.code}`)
          console.log(`  Limit: ${result.guardrailTriggered.limit}, Actual: ${result.guardrailTriggered.actual}`)
        }

        if (result.error) {
          console.error(`\nExploration error: ${result.error.message}`)
          console.error(`  Stage: ${result.error.stage}`)
          if (result.error.pageUrl) console.error(`  Page: ${result.error.pageUrl}`)
          await logger.flush()
          process.exit(1)
        }

        await logger.flush()
        process.exit(0)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`Exploration failed: ${msg}`)
        await logger.flush()
        process.exit(1)
      } finally {
        if (browserResult) {
          await browserResult.browser.close().catch(() => {})
        }
      }
    })
}
