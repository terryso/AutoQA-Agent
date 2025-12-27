/**
 * IR Replayer
 *
 * Replays IR records to a target step for repair mode.
 */

import type { Page } from 'playwright'

import type { ActionRecord } from '../ir/types.js'
import type { Logger } from '../logging/index.js'
import type { ReplayOptions, ReplayResult, ReplayFailureReason } from './types.js'

/**
 * Default timeout for each replay action in milliseconds.
 */
const DEFAULT_ACTION_TIMEOUT = 10000

/**
 * Replay IR records to a target step.
 *
 * @param records - The IR records to replay
 * @param targetStep - The target step index to replay to
 * @param options - Replay options
 * @returns Result of the replay operation
 */
export async function replayToStep(
  records: ActionRecord[],
  targetStep: number,
  options: ReplayOptions,
): Promise<ReplayResult> {
  const { page, runId, logger, timeout = DEFAULT_ACTION_TIMEOUT } = options

  logger?.log({
    event: 'autoqa.repair.replay.started',
    runId,
    targetStep,
    totalRecords: records.length,
  })

  // Filter records to replay (only those before targetStep)
  const recordsToReplay = records.filter((r) => (r.stepIndex ?? -1) < targetStep)

  if (recordsToReplay.length === 0) {
    // First step is the one needing repair - check for pageUrl fallback
    const firstRecord = records[0]
    if (firstRecord?.pageUrl) {
      logger?.log({
        event: 'autoqa.repair.replay.pageurl_fallback',
        runId,
        pageUrl: firstRecord.pageUrl,
      })

      try {
        await page.goto(firstRecord.pageUrl, { timeout })
        return {
          ok: true,
          replayedCount: 0,
          currentStepIndex: 0,
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          ok: false,
          replayedCount: 0,
          failedAtStep: 0,
          error: `Failed to navigate to pageUrl: ${message}`,
          reason: 'navigation_failed',
          canContinueManually: true,
        }
      }
    }

    // No records to replay and no pageUrl
    return {
      ok: true,
      replayedCount: 0,
      currentStepIndex: 0,
    }
  }

  let replayedCount = 0

  for (const record of recordsToReplay) {
    const stepIndex = record.stepIndex ?? -1

    // Skip records that didn't succeed originally
    if (!record.outcome.ok) {
      logger?.log({
        event: 'autoqa.repair.replay.skipped',
        runId,
        stepIndex,
        reason: 'original_outcome_failed',
      })
      continue
    }

    // Check if record can be replayed (needs chosenLocator for element-targeting tools)
    if (!canReplayRecord(record)) {
      logger?.log({
        event: 'autoqa.repair.replay.stopped',
        runId,
        stepIndex,
        reason: 'no_chosen_locator',
      })

      return {
        ok: false,
        replayedCount,
        failedAtStep: stepIndex,
        error: `Step ${stepIndex} (${record.toolName}) cannot be replayed: missing chosenLocator`,
        reason: 'no_chosen_locator',
        canContinueManually: true,
      }
    }

    try {
      await replayRecord(page, record, timeout)
      replayedCount++

      logger?.log({
        event: 'autoqa.repair.replay.step_success',
        runId,
        stepIndex,
        toolName: record.toolName,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      const reason = extractFailureReason(err)

      logger?.log({
        event: 'autoqa.repair.replay.step_failed',
        runId,
        stepIndex,
        toolName: record.toolName,
        error: message,
        reason,
      })

      return {
        ok: false,
        replayedCount,
        failedAtStep: stepIndex,
        error: `Step ${stepIndex} (${record.toolName}) failed: ${message}`,
        reason,
        canContinueManually: true,
      }
    }
  }

  logger?.log({
    event: 'autoqa.repair.replay.completed',
    runId,
    replayedCount,
    targetStep,
  })

  return {
    ok: true,
    replayedCount,
    currentStepIndex: targetStep,
  }
}

/**
 * Check if a record can be replayed.
 */
function canReplayRecord(record: ActionRecord): boolean {
  const { toolName, element } = record

  // Navigate, wait, and assertions can always be replayed from toolInput
  if (toolName === 'navigate' || toolName === 'wait' || toolName.startsWith('assert')) {
    return true
  }

  // Element-targeting tools need chosenLocator
  if (toolName === 'click' || toolName === 'fill' || toolName === 'select_option') {
    return element?.chosenLocator?.code !== undefined
  }

  // scroll can be replayed from toolInput
  if (toolName === 'scroll') {
    return true
  }

  return false
}

/**
 * Replay a single record.
 */
async function replayRecord(page: Page, record: ActionRecord, timeout: number): Promise<void> {
  const { toolName, toolInput } = record

  switch (toolName) {
    case 'navigate': {
      const url = toolInput?.url as string | undefined
      if (!url) throw new Error('navigate: missing url in toolInput')
      await page.goto(url, { timeout })
      return
    }

    case 'wait': {
      const seconds = toolInput?.seconds as number | undefined
      const duration = seconds ? seconds * 1000 : 1000
      await page.waitForDuration(duration)
      return
    }

    case 'click': {
      const locatorCode = record.element?.chosenLocator?.code
      if (!locatorCode) throw new Error('click: missing chosenLocator')
      await executeLocatorCode(page, locatorCode, timeout)
      return
    }

    case 'fill': {
      const locatorCode = record.element?.chosenLocator?.code
      const value = toolInput?.value as string | undefined
      if (!locatorCode) throw new Error('fill: missing chosenLocator')
      const element = await getElementFromCode(page, locatorCode)
      await element.fill(value ?? '')
      return
    }

    case 'select_option': {
      const locatorCode = record.element?.chosenLocator?.code
      const value = toolInput?.value as string | undefined
      if (!locatorCode) throw new Error('select_option: missing chosenLocator')
      if (!value) throw new Error('select_option: missing value in toolInput')
      const element = await getElementFromCode(page, locatorCode)
      // selectOption accepts string | string[] | null
      // Empty string will fail, so validate before calling
      await element.selectOption(value)
      return
    }

    case 'scroll': {
      const direction = toolInput?.direction as string | undefined
      const amount = toolInput?.amount as number | undefined

      if (direction === 'down') {
        await page.evaluate((pixels) => {
          window.scrollBy({ top: pixels ?? 300, behavior: 'instant' })
        }, amount)
      } else if (direction === 'up') {
        await page.evaluate((pixels) => {
          window.scrollBy({ top: -(pixels ?? 300), behavior: 'instant' })
        }, amount)
      }
      return
    }

    case 'assertTextPresent':
    case 'assertElementVisible': {
      // Assertions are replayed as waits to verify state
      // These don't throw during replay - they're just checks
      const locatorCode = record.element?.chosenLocator?.code
      if (locatorCode) {
        const element = await getElementFromCode(page, locatorCode)
        await element.waitFor({ state: 'visible', timeout })
      } else if (toolName === 'assertTextPresent' && toolInput?.text) {
        // For assertTextPresent without a locator, wait for text content in page
        const text = toolInput.text as string
        await page.waitForFunction(
          (t) => document.body.textContent?.includes(t as string) ?? false,
          text,
          { timeout }
        )
      }
      return
    }

    default:
      throw new Error(`Unknown toolName: ${toolName}`)
  }
}

/**
 * Execute locator code and return the element.
 */
async function getElementFromCode(page: Page, code: string) {
  // Parse locator code like "page.locator('#submit-btn')" or "page.getByRole('button', { name: 'Submit' })"
  // For replay, we use a simplified approach - extract the selector and use page.locator

  // Remove "page." prefix
  const cleanCode = code.replace(/^page\./, '')

  // Helper to extract quoted string value (handles single, double, and backtick quotes)
  const extractQuotedValue = (str: string, key?: string): string | null => {
    if (key) {
      // Match key: 'value' or key: "value" or key: `value`
      const patterns = [
        new RegExp(`${key}\\s*:\\s*['"]([^'"]+)['"]`),
        new RegExp(`${key}\\s*:\\s*\`([^\`]+)\``),
      ]
      for (const pattern of patterns) {
        const match = str.match(pattern)
        if (match) return match[1]
      }
      // Handle escaped quotes in value
      const escapedPattern = new RegExp(`${key}\\s*:\\s*['"]((?:[^'"]|(?<=\\\\)['"])+)['"]`)
      const escapedMatch = str.match(escapedPattern)
      if (escapedMatch) return escapedMatch[1]
      return null
    }

    // Match 'value' or "value" or `value`
    const patterns = [
      /['"]([^'"]+)['"]/,
      /[`.]([^\`]+)[`]/,
    ]
    for (const pattern of patterns) {
      const match = str.match(pattern)
      if (match) return match[1]
    }
    return null
  }

  if (cleanCode.startsWith('locator(')) {
    // Extract selector from page.locator('selector')
    const match = extractQuotedValue(cleanCode)
    if (match) {
      return page.locator(match)
    }
  }

  if (cleanCode.startsWith('getByRole(')) {
    // Extract role from first argument
    const roleMatch = extractQuotedValue(cleanCode)
    if (roleMatch) {
      const options: { name?: string | RegExp } = {}
      // Try to extract name option
      const nameMatch = extractQuotedValue(cleanCode, 'name')
      if (nameMatch) {
        options.name = nameMatch
      }
      return page.getByRole(roleMatch as any, options)
    }
  }

  if (cleanCode.startsWith('getByTestId(')) {
    const match = extractQuotedValue(cleanCode)
    if (match) {
      return page.getByTestId(match)
    }
  }

  if (cleanCode.startsWith('getByPlaceholder(')) {
    const match = extractQuotedValue(cleanCode)
    if (match) {
      return page.getByPlaceholder(match)
    }
  }

  if (cleanCode.startsWith('getByLabel(')) {
    const match = extractQuotedValue(cleanCode)
    if (match) {
      return page.getByLabel(match)
    }
  }

  if (cleanCode.startsWith('getByText(')) {
    const match = extractQuotedValue(cleanCode)
    if (match) {
      return page.getByText(match)
    }
  }

  // Fallback: try to evaluate as a raw selector
  // Remove trailing () and any leading method name
  const fallbackSelector = cleanCode.replace(/^\w+\([^)]*\)$/, '').replace(/^[^.]+\./, '')
  if (fallbackSelector && fallbackSelector !== cleanCode) {
    return page.locator(fallbackSelector)
  }

  // Last resort: use the original code stripped of page.
  return page.locator(cleanCode)
}

/**
 * Execute locator code with click action.
 */
async function executeLocatorCode(page: Page, code: string, timeout: number): Promise<void> {
  const element = await getElementFromCode(page, code)
  await element.click({ timeout })
}

/**
 * Extract failure reason from error.
 */
function extractFailureReason(err: unknown): ReplayFailureReason {
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase()

  if (message.includes('timeout') || message.includes('timed out')) {
    return 'timeout'
  }
  if (message.includes('not found') || message.includes('not visible')) {
    return 'locator_not_found'
  }
  if (message.includes('found more than one') || message.includes('not unique')) {
    return 'locator_not_unique'
  }
  if (message.includes('navigate') || message.includes('navigation')) {
    return 'navigation_failed'
  }

  return 'unexpected_page_state'
}
