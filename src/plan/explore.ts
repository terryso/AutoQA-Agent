/**
 * Exploration Orchestrator
 * Agent-driven exploration using Claude Agent SDK
 * Based on Tech Spec: ts-7-agent-based-intelligent-planner.md
 */
import type { Browser } from 'playwright'
import type { Logger } from '../logging/index.js'
import { runExploreAgent } from './explore-agent.js'
import type {
  PlanConfig,
  ExplorationResult,
} from './types.js'

export type ExploreOptions = {
  config: PlanConfig
  browser: Browser
  logger: Logger
  runId: string
  cwd?: string
}

/**
 * Main exploration entry point
 * Creates browser context and delegates to Agent-driven exploration
 * 
 * The actual exploration logic is driven by the Claude Agent SDK.
 * We provide the Agent with browser tools (navigate/click/fill/snapshot)
 * and a prompt describing the exploration task. The Agent decides
 * how to explore the application, what elements to interact with,
 * and how to handle login if required.
 */
export async function explore(options: ExploreOptions): Promise<ExplorationResult> {
  const { config, browser, logger, runId, cwd = process.cwd() } = options
  const debug = process.env.DEBUG === '1' || process.env.AUTOQA_DEBUG === '1'

  // Create browser context and page
  // Use viewport null for fullscreen (consistent with run command debug mode)
  const context = await browser.newContext({
    viewport: null, // This enables fullscreen like run command
  })
  const page = await context.newPage()

  if (debug) {
    console.error('[explore] Browser context and page created successfully')
  }

  try {
    // Delegate to Agent-driven exploration
    // The Agent will:
    // 1. Navigate to the base URL (or login URL if auth is configured)
    // 2. Use snapshot() to observe page structure
    // 3. Identify interactive elements and navigation links
    // 4. Click links to discover new pages
    // 5. Fill forms if needed for login
    // 6. Build a structured map of the application
    const result = await runExploreAgent({
      runId,
      config,
      page,
      cwd,
      logger,
      debug,
    })

    return result
  } finally {
    // Clean up browser resources
    await page.close().catch(() => {})
    await context.close().catch(() => {})
  }
}
