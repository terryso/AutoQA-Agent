/**
 * Repair Coordinator
 *
 * Coordinates the interactive repair mode for fixing failed locators.
 */

import type { Browser, Page } from 'playwright'
import type { LocatorCandidate } from '../ir/types.js'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { createBrowser } from '../browser/create-browser.js'
import type { Logger } from '../logging/index.js'
import { replayToStep } from './replayer.js'
import { RepairStorage } from './storage.js'
import type { RepairModeOptions, RepairModeResult, FailedStepInfo, ReplayResult, ExportAfterRepairResult, UserLocatorChoice } from './types.js'
import type { ActionRecord } from '../ir/types.js'
import { createIRWriter } from '../ir/writer.js'
import {
  injectElementPicker,
  removeElementPicker,
  waitForElementSelection,
  generateAndValidateLocators,
  recommendBestLocator,
  formatLocatorCandidates,
  type ElementInfo,
  type ValidatedLocator,
} from './element-picker.js'
import { createManualRecorder, type ManualRecorder } from './manual-recorder.js'

/**
 * Result of element selection with locator candidates.
 */
export type ElementSelectionResult = {
  ok: true
  elementInfo: ElementInfo
  candidates: ValidatedLocator[]
  recommended: ValidatedLocator | null
} | {
  ok: false
  reason: string
}

/**
 * Format a user-friendly prompt for replay failure.
 *
 * Only extracts failure details when result.ok is false.
 * For successful replay, only shows the general prompt header.
 */
function formatReplayFailurePrompt(result: ReplayResult, failedSteps: FailedStepInfo[]): string {
  const lines = [
    '',
    '⚠️  重放失败 / Replay Failed',
    '════════════════════════════════════════════════════',
  ]

  // Type narrow to failure variant before accessing failure-specific properties
  if (!result.ok) {
    if (result.failedAtStep !== undefined) {
      lines.push(`失败步骤 / Failed Step: ${result.failedAtStep}`)
    }

    if (result.reason) {
      const reasonMap: Record<string, string> = {
        locator_not_found: '元素未找到 / Element not found',
        locator_not_unique: '元素不唯一 / Element not unique',
        navigation_failed: '导航失败 / Navigation failed',
        timeout: '超时 / Timeout',
        unexpected_page_state: '页面状态异常 / Unexpected page state',
        no_chosen_locator: '缺少有效的 locator / Missing valid locator',
      }
      lines.push(`原因 / Reason: ${reasonMap[result.reason] || result.reason}`)
    }

    if (result.error) {
      lines.push(`错误 / Error: ${result.error}`)
    }
  }

  lines.push('')
  lines.push('建议 / Suggestion: 手动操作到目标状态后继续 / Manually navigate to target state then continue')
  lines.push('')
  lines.push(`待修复步骤 / Steps needing repair: ${failedSteps.map(s => `#${s.stepIndex}`).join(', ')}`)
  lines.push('════════════════════════════════════════════════════')
  lines.push('')

  return lines.join('\n')
}

/**
 * Load the spec markdown file for export.
 */
async function loadSpecFile(specPath: string, cwd: string): Promise<any> {
  const fullPath = resolve(cwd, specPath)
  const content = await readFile(fullPath, 'utf-8')

  try {
    const { parseMarkdownSpec } = await import('../markdown/parse-markdown-spec.js')
    const result = parseMarkdownSpec(content)

    if (result.ok) {
      return result.spec
    }

    // Return minimal spec structure on parse failure
    return {
      title: specPath.split('/').pop()?.replace('.md', '') || 'Untitled Spec',
      description: '',
      steps: [],
    }
  } catch {
    // Return minimal spec structure if parser fails
    return {
      title: specPath.split('/').pop()?.replace('.md', '') || 'Untitled Spec',
      description: '',
      steps: [],
    }
  }
}

/**
 * Attempt export after repairs are complete.
 */
async function exportAfterRepairs(
  cwd: string,
  runId: string,
  specPath: string,
  baseUrl: string,
  loginBaseUrl: string | undefined,
  logger: Logger | undefined,
): Promise<ExportAfterRepairResult> {
  try {
    const spec = await loadSpecFile(specPath, cwd)

    const { exportFromIR } = await import('../runner/export-from-ir.js')
    const result = await exportFromIR({
      cwd,
      runId,
      specPath,
      spec,
      baseUrl,
      loginBaseUrl,
    })

    if (result.ok) {
      logger?.log({
        event: 'autoqa.repair.export_after_repair.success',
        runId,
        specPath,
        exportPath: result.exportPath,
      })

      return {
        ok: true,
        exportPath: result.exportPath,
      }
    }

    logger?.log({
      event: 'autoqa.repair.export_after_repair.failed',
      runId,
      specPath,
      reason: result.reason,
      missingLocators: result.missingLocators,
    })

    return {
      ok: false,
      reason: result.reason,
      missingLocators: result.missingLocators,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)

    logger?.log({
      event: 'autoqa.repair.export_after_repair.error',
      runId,
      specPath,
      error: message,
    })

    return {
      ok: false,
      reason: `Export failed: ${message}`,
    }
  }
}

/**
 * Repair Coordinator state.
 */
type CoordinatorState = {
  options: RepairModeOptions
  browser: Browser | null
  page: Page | null
  failedSteps: FailedStepInfo[]
  replayResult: ReplayResult | null
  elementPickerEnabled: boolean
  storage: RepairStorage
  repairsSaved: number
  /** Signal handler cleanup function */
  cleanupSignalHandler: (() => void) | null
  /** Manual recorder instance */
  manualRecorder: ManualRecorder | null
  /** Manual recording start step index */
  manualRecordingStartStep: number
  /** Manually recorded steps */
  manualSteps: ActionRecord[]
}

/**
 * Creates a new RepairCoordinator instance.
 */
export function createRepairCoordinator(options: RepairModeOptions): RepairCoordinator {
  return new RepairCoordinatorImpl(options)
}

/**
 * Interface for the repair coordinator.
 */
export interface RepairCoordinator {
  /**
   * Start the repair mode with a headed browser.
   */
  startRepairMode(): Promise<RepairModeResult>

  /**
   * Finish repair mode and attempt export.
   *
   * Should be called when all repairs are complete.
   * Will attempt to export the test with applied repairs.
   */
  finishRepairMode(): Promise<RepairModeResult>

  /**
   * Get the list of failed steps that need repair.
   */
  getFailedSteps(): FailedStepInfo[]

  /**
   * Get the replay result from IR replay.
   */
  getReplayResult(): ReplayResult | null

  /**
   * Get the active page for manual continuation.
   */
  getPage(): Page | null

  /**
   * Clean up resources (close browser, etc.).
   */
  cleanup(): Promise<void>

  /**
   * Enable element picker on the current page.
   *
   * Injects the element picker script and sets up
   * event listeners for element selection.
   */
  enableElementPicker(): Promise<void>

  /**
   * Disable element picker on the current page.
   *
   * Removes injected DOM elements and event listeners.
   */
  disableElementPicker(): Promise<void>

  /**
   * Wait for user to select an element on the page.
   *
   * Returns element info and generated locator candidates.
   */
  waitForElementSelection(timeout?: number): Promise<ElementSelectionResult>

  /**
   * Display locator candidates and get user choice.
   *
   * Formats candidates for CLI display and returns
   * the user's selection.
   */
  promptLocatorChoice(
    candidates: ValidatedLocator[],
    writeErr?: (line: string) => void,
  ): Promise<UserLocatorChoice>

  /**
   * Save a repair record for a failed step.
   *
   * Persists the chosen locator to repairs.json for future exports.
   *
   * @param stepIndex - The step index being repaired
   * @param stepText - The step text description
   * @param chosenLocator - The locator chosen by the user
   */
  saveRepair(
    stepIndex: number,
    stepText: string,
    chosenLocator: LocatorCandidate,
  ): Promise<void>

  /**
   * Get the number of repairs saved in this session.
   */
  getRepairsSavedCount(): number

  /**
   * Enable manual recording mode.
   *
   * Starts recording user's manual browser actions.
   * Recorded actions will be appended to IR when finishManualMode is called.
   */
  enableManualMode(startStepIndex?: number): Promise<void>

  /**
   * Finish manual recording mode.
   *
   * Stops recording and returns the manually recorded steps.
   * These steps can be appended to the IR for export.
   */
  finishManualMode(): Promise<{
    ok: true
    manualSteps: ActionRecord[]
    stepsCount: number
    sensitiveFieldsRedacted: number
  }>

  /**
   * Check if manual recording is currently active.
   */
  isManualModeActive(): boolean
}

/**
 * Internal implementation of RepairCoordinator.
 */
class RepairCoordinatorImpl implements RepairCoordinator {
  private state: CoordinatorState

  constructor(options: RepairModeOptions) {
    const { logger, runId, cwd } = options

    this.state = {
      options,
      browser: null,
      page: null,
      failedSteps: [],
      replayResult: null,
      elementPickerEnabled: false,
      storage: new RepairStorage(cwd, runId, logger),
      repairsSaved: 0,
      cleanupSignalHandler: null,
      manualRecorder: null,
      manualRecordingStartStep: 0,
      manualSteps: [],
    }
  }

  async startRepairMode(): Promise<RepairModeResult> {
    const { logger, runId, specPath, cwd, baseUrl, writeErr, replayTimeout } = this.state.options

    logger?.log({
      event: 'autoqa.repair.started',
      runId,
      specPath,
      repairMode: true,
    })

    // Set up signal handler for graceful shutdown (Ctrl+C)
    this.setupSignalHandler()

    try {
      // Read IR records to find failed steps
      const { getSpecActionRecords } = await import('../runner/ir-reader.js')
      const records = await getSpecActionRecords(cwd, runId, specPath)

      // Identify steps missing valid locators
      const { hasValidChosenLocator } = await import('../runner/ir-reader.js')
      const failedSteps: FailedStepInfo[] = records
        .filter((r) => {
          if (!r.outcome.ok) return false
          const isElementTargeting =
            r.toolName === 'click' ||
            r.toolName === 'fill' ||
            r.toolName === 'select_option' ||
            r.toolName === 'assertElementVisible'
          return isElementTargeting && !hasValidChosenLocator(r)
        })
        .map((r) => ({
          stepIndex: r.stepIndex ?? -1,
          stepText: r.stepText ?? `Step ${r.stepIndex}`,
          toolName: r.toolName,
          pageUrl: r.pageUrl,
        }))

      this.state.failedSteps = failedSteps

      if (failedSteps.length === 0) {
        return {
          ok: false,
          reason: 'No failed steps found that need repair',
        }
      }

      // Launch headed browser for repair mode
      const browserResult = await createBrowser({ headless: false })
      this.state.browser = browserResult.browser

      logger?.log({
        event: 'autoqa.repair.browser_launched',
        runId,
        specPath,
        headless: false,
      })

      // Create a page context for replay
      let context
      if (browserResult.persistentContext) {
        context = browserResult.persistentContext
      } else {
        try {
          context = await this.state.browser.newContext()
        } catch (contextError) {
          logger?.log({
            event: 'autoqa.repair.context_failed',
            runId,
            error: contextError instanceof Error ? contextError.message : String(contextError),
          })
          // Cleanup browser before returning error
          await this.state.browser.close()
          this.state.browser = null
          return {
            ok: false,
            reason: `Failed to create browser context: ${contextError instanceof Error ? contextError.message : String(contextError)}`,
          }
        }
      }
      this.state.page = await context.newPage()

      // Find the first failed step index for replay target
      const firstFailedStepIndex = failedSteps[0].stepIndex

      logger?.log({
        event: 'autoqa.repair.steps_identified',
        runId,
        specPath,
        failedStepCount: failedSteps.length,
        firstFailedStepIndex,
        failedSteps: failedSteps.map((s) => ({
          stepIndex: s.stepIndex,
          toolName: s.toolName,
        })),
      })

      // Replay IR to the first failed step
      const replayResult = await replayToStep(records, firstFailedStepIndex, {
        page: this.state.page,
        runId,
        logger,
        timeout: replayTimeout,
      })

      this.state.replayResult = replayResult

      if (!replayResult.ok) {
        logger?.log({
          event: 'autoqa.repair.replay.failed',
          runId,
          failedAtStep: replayResult.failedAtStep,
          reason: replayResult.reason,
          error: replayResult.error,
        })

        // Display user prompt on stderr
        if (writeErr) {
          writeErr(formatReplayFailurePrompt(replayResult, failedSteps))
        }

        // Return success anyway - user can continue manually
        return {
          ok: true,
          repairsSaved: 0,
        }
      }

      logger?.log({
        event: 'autoqa.repair.replay.succeeded',
        runId,
        replayedCount: replayResult.replayedCount,
        currentStepIndex: replayResult.currentStepIndex,
      })

      return {
        ok: true,
        repairsSaved: 0,
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        ok: false,
        reason: `Failed to start repair mode: ${message}`,
      }
    }
  }

  getFailedSteps(): FailedStepInfo[] {
    return this.state.failedSteps
  }

  getReplayResult(): ReplayResult | null {
    return this.state.replayResult
  }

  getPage(): Page | null {
    return this.state.page
  }

  async cleanup(): Promise<void> {
    // Remove signal handler if installed
    if (this.state.cleanupSignalHandler) {
      this.state.cleanupSignalHandler()
      this.state.cleanupSignalHandler = null
    }

    // Remove element picker if enabled
    if (this.state.elementPickerEnabled && this.state.page) {
      try {
        await removeElementPicker(this.state.page)
        this.state.elementPickerEnabled = false
      } catch {
        // Ignore cleanup errors
      }
    }

    if (this.state.page) {
      await this.state.page.close()
      this.state.page = null
    }
    if (this.state.browser) {
      await this.state.browser.close()
      this.state.browser = null
    }
  }

  async enableElementPicker(): Promise<void> {
    const { logger, runId, specPath } = this.state.options

    if (!this.state.page) {
      throw new Error('Cannot enable element picker: no active page')
    }

    if (this.state.elementPickerEnabled) {
      logger?.log({
        event: 'autoqa.repair.element_picker.already_enabled',
        runId,
        specPath,
      })
      return
    }

    await injectElementPicker(this.state.page)
    this.state.elementPickerEnabled = true

    logger?.log({
      event: 'autoqa.repair.element_picker.enabled',
      runId,
      specPath,
    })
  }

  async disableElementPicker(): Promise<void> {
    const { logger, runId, specPath } = this.state.options

    if (!this.state.page) {
      return
    }

    if (!this.state.elementPickerEnabled) {
      return
    }

    try {
      await removeElementPicker(this.state.page)
      this.state.elementPickerEnabled = false

      logger?.log({
        event: 'autoqa.repair.element_picker.disabled',
        runId,
        specPath,
      })
    } catch (err) {
      logger?.log({
        event: 'autoqa.repair.element_picker.disable_failed',
        runId,
        specPath,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  async waitForElementSelection(timeout?: number): Promise<ElementSelectionResult> {
    const { logger, runId, specPath } = this.state.options

    if (!this.state.page) {
      return {
        ok: false,
        reason: 'No active page for element selection',
      }
    }

    if (!this.state.elementPickerEnabled) {
      return {
        ok: false,
        reason: 'Element picker not enabled. Call enableElementPicker() first.',
      }
    }

    try {
      logger?.log({
        event: 'autoqa.repair.element_selection.waiting',
        runId,
        specPath,
      })

      const elementInfo = await waitForElementSelection(this.state.page, { timeout })

      logger?.log({
        event: 'autoqa.repair.element_selection.received',
        runId,
        specPath,
        tagName: elementInfo.tagName,
        hasTestId: !!elementInfo.testId,
        hasId: !!elementInfo.id,
      })

      // Generate and validate locator candidates
      const candidates = await generateAndValidateLocators(this.state.page, elementInfo, {
        logger,
        runId,
        specPath,
      })

      const recommended = recommendBestLocator(candidates)

      logger?.log({
        event: 'autoqa.repair.locator_candidates.generated',
        runId,
        specPath,
        candidateCount: candidates.length,
        recommendedUnique: recommended?.validation.unique ?? false,
      })

      return {
        ok: true,
        elementInfo,
        candidates,
        recommended,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)

      logger?.log({
        event: 'autoqa.repair.element_selection.failed',
        runId,
        specPath,
        error: message,
      })

      return {
        ok: false,
        reason: message,
      }
    }
  }

  async promptLocatorChoice(
    candidates: ValidatedLocator[],
    writeErr?: (line: string) => void,
  ): Promise<UserLocatorChoice> {
    const { logger, runId, specPath } = this.state.options

    if (candidates.length === 0) {
      return { action: 'skip' }
    }

    // Format and display candidates
    const formatted = formatLocatorCandidates(candidates)

    if (writeErr) {
      writeErr('\n')
      writeErr('═════════════════════════════════════════════════════\n')
      writeErr('📌 选中的元素:\n')
      writeErr('═════════════════════════════════════════════════════\n')
      writeErr(formatted)
      writeErr('\n')
      writeErr('选项:\n')
      writeErr('  [序号] 使用对应的 locator\n')
      writeErr('  [Y]    使用推荐的 locator\n')
      writeErr('  [s]    跳过此步骤\n')
      writeErr('  [m]    手动继续 / Manual continuation\n')
      writeErr('  [q]    退出修复模式\n')
      writeErr('请选择: _\n')
    }

    // For now, return recommended as default choice
    // In a full interactive CLI, this would wait for actual user input
    const recommended = recommendBestLocator(candidates)

    logger?.log({
      event: 'autoqa.repair.locator_prompt.displayed',
      runId,
      specPath,
      candidateCount: candidates.length,
      hasUnique: candidates.some(c => c.validation.unique),
    })

    // Default: use recommended if unique, otherwise skip
    if (recommended && recommended.validation.unique) {
      return {
        action: 'use',
        selected: {
          kind: recommended.kind,
          value: recommended.value,
          code: recommended.code,
          validation: recommended.validation,
        },
      }
    }

    return { action: 'skip' }
  }

  async saveRepair(
    stepIndex: number,
    stepText: string,
    chosenLocator: LocatorCandidate,
  ): Promise<void> {
    const { logger, runId, specPath } = this.state.options

    logger?.log({
      event: 'autoqa.repair.save_requested',
      runId,
      specPath,
      stepIndex,
      stepText,
    })

    await this.state.storage.saveRepair(
      specPath,
      stepIndex,
      stepText,
      chosenLocator,
    )

    this.state.repairsSaved++

    logger?.log({
      event: 'autoqa.repair.saved',
      runId,
      specPath,
      stepIndex,
      totalRepairsSaved: this.state.repairsSaved,
    })
  }

  getRepairsSavedCount(): number {
    return this.state.repairsSaved
  }

  /**
   * Set up signal handler for graceful shutdown.
   */
  setupSignalHandler(): void {
    const { logger, runId, specPath } = this.state.options

    // Remove existing handler if any
    if (this.state.cleanupSignalHandler) {
      return
    }

    let cleanupCalled = false

    const handleSignal = async (signalName: string): Promise<void> => {
      if (cleanupCalled) {
        return
      }
      cleanupCalled = true

      logger?.log({
        event: 'autoqa.repair.signal_received',
        runId,
        specPath,
        signal: signalName,
        repairsSaved: this.state.repairsSaved,
      })

      // Auto-save any completed repairs before exiting
      if (this.state.repairsSaved > 0) {
        logger?.log({
          event: 'autoqa.repair.auto_saving',
          runId,
          specPath,
          repairsCount: this.state.repairsSaved,
        })

        // Repairs are already saved via saveRepair(), just log
        logger?.log({
          event: 'autoqa.repair.auto_save_complete',
          runId,
          specPath,
          repairsCount: this.state.repairsSaved,
        })
      }

      // Cleanup resources
      await this.cleanup()

      // Exit process
      process.exit(0)
    }

    // Handle SIGINT (Ctrl+C)
    const sigintHandler = () => {
      handleSignal('SIGINT')
    }

    // Handle SIGTERM
    const sigtermHandler = () => {
      handleSignal('SIGTERM')
    }

    process.on('SIGINT', sigintHandler)
    process.on('SIGTERM', sigtermHandler)

    // Store cleanup function
    this.state.cleanupSignalHandler = () => {
      process.off('SIGINT', sigintHandler)
      process.off('SIGTERM', sigtermHandler)
    }

    logger?.log({
      event: 'autoqa.repair.signal_handler_installed',
      runId,
      specPath,
    })
  }

  /**
   * Finish repair mode and attempt export.
   */
  async finishRepairMode(): Promise<RepairModeResult> {
    const { logger, runId, specPath, cwd, baseUrl, loginBaseUrl } = this.state.options

    logger?.log({
      event: 'autoqa.repair.finishing',
      runId,
      specPath,
      repairsSaved: this.state.repairsSaved,
    })

    // Stop manual recording if active
    if (this.state.manualRecorder?.isActive()) {
      await this.state.manualRecorder.stop()
      this.state.manualRecorder = null
    }

    // Remove signal handler
    if (this.state.cleanupSignalHandler) {
      this.state.cleanupSignalHandler()
      this.state.cleanupSignalHandler = null
    }

    // Attempt export with repairs applied
    const exportResult = await exportAfterRepairs(
      cwd,
      runId,
      specPath,
      baseUrl,
      loginBaseUrl,
      logger,
    )

    // Cleanup resources
    await this.cleanup()

    logger?.log({
      event: 'autoqa.repair.finished',
      runId,
      specPath,
      repairsSaved: this.state.repairsSaved,
      exportOk: exportResult.ok,
    })

    return {
      ok: true,
      repairsSaved: this.state.repairsSaved,
      exportResult,
    }
  }

  async enableManualMode(startStepIndex?: number): Promise<void> {
    const { logger, runId, specPath, writeErr } = this.state.options

    if (!this.state.page) {
      throw new Error('Cannot enable manual mode: no active page')
    }

    if (this.state.manualRecorder?.isActive()) {
      logger?.log({
        event: 'autoqa.repair.manual_mode.already_active',
        runId,
        specPath,
      })
      return
    }

    // Use the next step index if not provided
    const nextStepIndex = startStepIndex ?? (this.state.replayResult?.currentStepIndex ?? 0) + 1
    this.state.manualRecordingStartStep = nextStepIndex

    // Create and start manual recorder
    this.state.manualRecorder = createManualRecorder({
      page: this.state.page,
      runId,
      specPath,
      startStepIndex: nextStepIndex,
      logger,
      onStepRecorded: (step) => {
        this.state.manualSteps.push(step)
      },
    })

    await this.state.manualRecorder.start()

    logger?.log({
      event: 'autoqa.repair.manual_mode.enabled',
      runId,
      specPath,
      startStepIndex: nextStepIndex,
    })

    // Show user prompt (Subtask 4.2)
    if (writeErr) {
      writeErr('\n')
      writeErr('📝 手动记录模式已启用\n')
      writeErr('════════════════════════════════════════════════════\n')
      writeErr('请在浏览器中完成操作，完成后调用 finishManualMode() 结束记录\n')
      writeErr('提示: 敏感字段（如密码）将自动使用模板变量替换\n')
      writeErr('════════════════════════════════════════════════════\n')
    }
  }

  async finishManualMode(): Promise<{
    ok: true
    manualSteps: ActionRecord[]
    stepsCount: number
    sensitiveFieldsRedacted: number
  }> {
    const { logger, runId, specPath, cwd, writeErr } = this.state.options

    if (!this.state.manualRecorder?.isActive()) {
      logger?.log({
        event: 'autoqa.repair.manual_mode.not_active',
        runId,
        specPath,
      })

      return {
        ok: true,
        manualSteps: this.state.manualSteps,
        stepsCount: this.state.manualSteps.length,
        sensitiveFieldsRedacted: 0,
      }
    }

    const result = await this.state.manualRecorder.stop()

    logger?.log({
      event: 'autoqa.repair.manual_mode.finished',
      runId,
      specPath,
      stepsCount: result.stepsCount,
      sensitiveFieldsRedacted: result.sensitiveFieldsRedacted,
    })

    // Append manual steps to IR file (Subtask 3.4)
    if (result.stepsCount > 0) {
      try {
        const irWriter = createIRWriter(cwd, runId)
        await irWriter.writeAll(result.steps)

        logger?.log({
          event: 'autoqa.repair.manual_steps_appended_to_ir',
          runId,
          specPath,
          stepsCount: result.stepsCount,
        })
      } catch (err) {
        logger?.log({
          event: 'autoqa.repair.manual_steps_append_failed',
          runId,
          specPath,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    this.state.manualRecorder = null

    // Show feedback to user (Subtask 4.3)
    if (writeErr) {
      const sensitiveInfo = result.sensitiveFieldsRedacted > 0
        ? ` (${result.sensitiveFieldsRedacted} 个敏感字段已脱敏)` : ''
      writeErr(`\n✅ 已捕获 ${result.stepsCount} 个手动操作步骤${sensitiveInfo}\n`)
    }

    return {
      ok: true,
      manualSteps: result.steps,
      stepsCount: result.stepsCount,
      sensitiveFieldsRedacted: result.sensitiveFieldsRedacted,
    }
  }

  isManualModeActive(): boolean {
    return this.state.manualRecorder?.isActive() ?? false
  }
}

/**
 * Check if export result suggests repair mode.
 */
export function shouldSuggestRepairMode(result: import('../runner/export-from-ir.js').ExportResult): boolean {
  if (result.ok) return false
  return 'suggestRepairMode' in result ? result.suggestRepairMode === true : false
}

/**
 * Get failed steps from export result.
 */
export function extractFailedSteps(result: import('../runner/export-from-ir.js').ExportResult): FailedStepInfo[] {
  if (result.ok || !result.missingLocators) return []

  return result.missingLocators.map((detail, index) => {
    // Parse details like "click at step 3" or "fill at step 5"
    const match = detail.match(/(\w+) at step (\d+)/)
    if (match) {
      return {
        stepIndex: parseInt(match[2], 10),
        stepText: `Step ${match[2]}`,
        toolName: match[1],
      }
    }
    return {
      stepIndex: -1,
      stepText: `Unknown step ${index}`,
      toolName: 'unknown',
    }
  })
}
