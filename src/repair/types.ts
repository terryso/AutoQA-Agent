/**
 * Repair Mode Types
 *
 * Types for the interactive repair mode that allows users to fix failed locators.
 */

import type { LocatorCandidate } from '../ir/types.js'

/**
 * A single repair record for a failed step.
 */
export type RepairRecord = {
  /** Run ID that generated the original IR */
  runId: string
  /** Path to the spec file */
  specPath: string
  /** Step index in the spec */
  stepIndex: number
  /** Step text for reference */
  stepText: string
  /** Timestamp when the repair was created */
  timestamp: number
  /** The chosen locator for this step */
  chosenLocator: LocatorCandidate
  /** ISO timestamp of when repair was completed */
  repairedAt: string
  /** Whether user confirmed this repair */
  userConfirmed: boolean
}

/**
 * Structure of the repairs.json file.
 */
export type RepairFile = {
  runId: string
  createdAt: string
  updatedAt: string
  repairs: RepairRecord[]
}

/**
 * Options for starting repair mode.
 */
export type RepairModeOptions = {
  runId: string
  specPath: string
  cwd: string
  baseUrl: string
  loginBaseUrl?: string
  logger?: import('../logging/index.js').Logger
  /** Function to write output to stderr (for user prompts) */
  writeErr?: (line: string) => void
  /** Timeout for each replay action in milliseconds (default: 10000) */
  replayTimeout?: number
}

/**
 * Result of starting repair mode.
 *
 * **Success variant** (`ok: true`):
 * - `repairsSaved`: Number of repair records saved in this session
 * - `exportResult`: Result of attempting to export after repairs (optional)
 *
 * **Failure variant** (`ok: false`):
 * - `reason`: Human-readable failure reason
 */
export type RepairModeResult =
  | { ok: true; repairsSaved: number; exportResult?: ExportAfterRepairResult }
  | { ok: false; reason: string }

/**
 * Result of export attempt after repair mode.
 */
export type ExportAfterRepairResult = {
  ok: boolean
  exportPath?: string
  reason?: string
  missingLocators?: string[]
}

/**
 * Information about a failed step that needs repair.
 */
export type FailedStepInfo = {
  stepIndex: number
  stepText: string
  toolName: string
  pageUrl?: string
}

/**
 * Reasons for replay failure.
 */
export type ReplayFailureReason =
  | 'locator_not_found'
  | 'locator_not_unique'
  | 'navigation_failed'
  | 'timeout'
  | 'unexpected_page_state'
  | 'no_chosen_locator'

/**
 * Result of replaying IR to a target step.
 *
 * **Success variant** (`ok: true`):
 * - `replayedCount`: Number of steps successfully replayed
 * - `currentStepIndex`: The step index replay reached (target step)
 *
 * **Failure variant** (`ok: false`):
 * - `replayedCount`: Number of steps replayed before failure
 * - `failedAtStep`: Index of the step that failed
 * - `error`: Human-readable error message
 * - `reason`: Machine-readable failure reason code
 * - `canContinueManually`: Set to `true` if user can manually navigate to target state
 *   and continue. Set to `false` for unrecoverable errors (e.g., browser crash).
 */
export type ReplayResult =
  | {
      ok: true
      replayedCount: number
      currentStepIndex: number
    }
  | {
      ok: false
      replayedCount: number
      failedAtStep: number
      error: string
      reason: ReplayFailureReason
      canContinueManually: boolean
    }

/**
 * Options for replaying IR.
 */
export type ReplayOptions = {
  /** The page to use for replay */
  page: import('playwright').Page
  /** Run ID for logging */
  runId: string
  /** Logger instance */
  logger?: import('../logging/index.js').Logger
  /** Timeout for each action in milliseconds */
  timeout?: number
}

/**
 * Options for manual recording mode.
 */
export type ManualRecordingOptions = {
  /** Playwright page to record actions from */
  page: import('playwright').Page
  /** Run ID for logging context */
  runId: string
  /** Path to the spec file */
  specPath: string
  /** Step index to start recording from */
  startStepIndex: number
  /** Logger instance */
  logger?: import('../logging/index.js').Logger
  /** Optional callback for each recorded step */
  onStepRecorded?: (step: import('../ir/types.js').ActionRecord) => void
}

/**
 * Result of manual recording session.
 */
export type ManualRecordingResult = {
  ok: boolean
  steps: import('../ir/types.js').ActionRecord[]
  stepsCount: number
  sensitiveFieldsRedacted: number
  error?: string
}

/**
 * User choice for locator selection prompt.
 *
 * Extended to include 'manual' action for manual continuation mode.
 */
export type UserLocatorChoice =
  | { action: 'use'; selected?: import('../ir/types.js').LocatorCandidate }
  | { action: 'skip' }
  | { action: 'exit' }
  | { action: 'manual' }
