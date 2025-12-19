/**
 * IR (Intermediate Representation) Types for Action Recording
 *
 * These types define the structure for recording browser actions during test execution,
 * enabling stable locator generation and future export to Playwright tests.
 */

/**
 * Fingerprint of an element at the time of interaction.
 * Used to verify that locator candidates resolve to the same element.
 */
export type ElementFingerprint = {
  tagName?: string
  role?: string
  accessibleName?: string
  id?: string
  nameAttr?: string
  typeAttr?: string
  placeholder?: string
  ariaLabel?: string
  testId?: string
  textSnippet?: string
}

/**
 * Locator candidate kinds in priority order (highest to lowest):
 * 1. getByTestId - Most stable, explicit test attribute
 * 2. getByRole - Semantic, accessibility-friendly
 * 3. getByLabel - Good for form inputs
 * 4. getByPlaceholder - Good for inputs without labels
 * 5. cssId - Stable if IDs are meaningful
 * 6. cssAttr - Fallback for other attributes
 * 7. text - Lowest priority, may be unstable
 */
export type LocatorKind =
  | 'getByTestId'
  | 'getByRole'
  | 'getByLabel'
  | 'getByPlaceholder'
  | 'cssId'
  | 'cssAttr'
  | 'text'

/**
 * Validation result for a locator candidate.
 * All fields are optional as validation may be partial.
 */
export type LocatorValidation = {
  unique: boolean
  visible?: boolean
  enabled?: boolean
  editable?: boolean
  fingerprintMatch?: boolean
  error?: string
}

/**
 * A candidate locator for an element.
 */
export type LocatorCandidate = {
  kind: LocatorKind
  value: string
  code: string
  validation: LocatorValidation
}

/**
 * Element information recorded for actions that target specific elements.
 */
export type ElementRecord = {
  fingerprint: ElementFingerprint
  locatorCandidates: LocatorCandidate[]
  chosenLocator?: LocatorCandidate
}

/**
 * Tool names that can be recorded in IR.
 */
export type IRToolName =
  | 'navigate'
  | 'click'
  | 'fill'
  | 'select_option'
  | 'scroll'
  | 'wait'
  | 'assertTextPresent'
  | 'assertElementVisible'

/**
 * Fill value representation for IR storage.
 * Supports both template variables (e.g., {{USERNAME}}) and literal values.
 */
export type FillValue =
  | { kind: 'template_var'; name: string }
  | { kind: 'literal'; value: string }
  | { kind: 'redacted' }

/**
 * Outcome of a tool execution.
 */
export type ActionOutcome = {
  ok: boolean
  errorCode?: string
  errorMessage?: string
}

/**
 * Redacted tool input for IR storage.
 * Sensitive data (like fill text) is replaced with length or markers.
 * For fill actions, use fillValue field instead of text.
 */
export type RedactedToolInput = Record<string, unknown> & {
  /** Structured fill value for fill actions */
  fillValue?: FillValue
}

/**
 * A single action record in the IR.
 */
export type ActionRecord = {
  runId: string
  specPath: string
  stepIndex: number | null
  stepText?: string
  toolName: IRToolName
  toolInput: RedactedToolInput
  outcome: ActionOutcome
  pageUrl?: string
  element?: ElementRecord
  timestamp: number
}

/**
 * Tools that target specific elements and should have element fingerprinting.
 */
export const ELEMENT_TARGETING_TOOLS: ReadonlySet<IRToolName> = new Set([
  'click',
  'fill',
  'select_option',
  'assertElementVisible',
])

/**
 * Check if a tool targets a specific element.
 */
export function isElementTargetingTool(toolName: string): toolName is 'click' | 'fill' | 'select_option' | 'assertElementVisible' {
  return ELEMENT_TARGETING_TOOLS.has(toolName as IRToolName)
}
