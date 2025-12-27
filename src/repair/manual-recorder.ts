/**
 * Manual Recorder for Interactive Repair Mode
 *
 * Records user's manual browser actions and converts them to IR format.
 * Detects and redacts sensitive fields like passwords.
 */

import type { Page } from 'playwright'
import type { ActionRecord, IRToolName, FillValue } from '../ir/types.js'
import type { Logger } from '../logging/index.js'
import type { ManualRecordingOptions, ManualRecordingResult } from './types.js'

/**
 * Captured event from browser page.
 */
interface CapturedEvent {
  type: 'click' | 'fill' | 'select_option' | 'navigate'
  timestamp: number
  selector?: string
  value?: string
  url?: string
  elementInfo?: {
    tagName: string
    id?: string
    name?: string
    type?: string
    placeholder?: string
  }
}

/**
 * Result of sensitive field detection.
 */
interface SensitiveFieldDetection {
  isSensitive: boolean
  templateVar?: string
  reason: string
}

/**
 * Priority patterns for sensitive field detection.
 * Ordered from highest to lowest priority.
 */
const SENSITIVE_PATTERNS: Array<{
  priority: number
  templateVar: string
  test: (info: CapturedEvent['elementInfo']) => boolean
  reason: string
}> = [
  {
    priority: 100,
    templateVar: 'PASSWORD',
    test: (info) => info?.type === 'password',
    reason: 'type="password"',
  },
  {
    priority: 90,
    templateVar: 'PASSWORD',
    test: (info) => {
      const name = info?.name?.toLowerCase() ?? ''
      return name.includes('password') || name.includes('passwd') || name.includes('pwd')
    },
    reason: 'name contains password/passwd/pwd',
  },
  {
    priority: 85,
    templateVar: 'PASSWORD',
    test: (info) => {
      const id = typeof info?.id === 'string' ? info.id.toLowerCase() : ''
      return id.includes('password') || id.includes('passwd') || id.includes('pwd')
    },
    reason: 'id contains password/passwd/pwd',
  },
  {
    priority: 70,
    templateVar: 'SECRET',
    test: (info) => {
      const name = info?.name?.toLowerCase() ?? ''
      return name.includes('secret') || name.includes('token') || name.includes('api')
    },
    reason: 'name contains secret/token/api',
  },
  {
    priority: 60,
    templateVar: 'PIN',
    test: (info) => {
      const name = info?.name?.toLowerCase() ?? ''
      return name.includes('pin') || name.includes('otp') || name.includes('code')
    },
    reason: 'name contains pin/otp/code',
  },
  {
    priority: 50,
    templateVar: 'EMAIL',
    test: (info) => info?.type === 'email',
    reason: 'type="email"',
  },
  {
    priority: 40,
    templateVar: 'USERNAME',
    test: (info) => {
      const name = info?.name?.toLowerCase() ?? ''
      return name.includes('username') || name.includes('user') || name === 'user'
    },
    reason: 'name contains username/user',
  },
]

/**
 * Detect if a field is sensitive based on element attributes.
 *
 * @param elementInfo - Element information from the captured event
 * @returns Detection result with template variable name and reason
 */
export function detectSensitiveField(
  elementInfo: CapturedEvent['elementInfo'],
): SensitiveFieldDetection {
  if (!elementInfo) {
    return { isSensitive: false, reason: 'No element info' }
  }

  // Check patterns in priority order
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(elementInfo)) {
      return {
        isSensitive: true,
        templateVar: pattern.templateVar,
        reason: pattern.reason,
      }
    }
  }

  return { isSensitive: false, reason: 'No sensitive patterns matched' }
}

/**
 * Convert a captured value to FillValue representation.
 *
 * @param value - The actual value entered
 * @param detection - Sensitive field detection result
 * @returns FillValue with template variable or literal/redacted
 */
export function valueToFillValue(
  value: string,
  detection: SensitiveFieldDetection,
): FillValue {
  if (detection.isSensitive) {
    return { kind: 'template_var', name: detection.templateVar }
  }

  // For non-sensitive fields, store as literal
  return { kind: 'literal', value }
}

/**
 * Create an ActionRecord from a captured event.
 *
 * @param event - The captured browser event
 * @param options - Recording options for context
 * @param detection - Optional sensitive field detection result
 * @returns ActionRecord in IR format
 */
function eventToActionRecord(
  event: CapturedEvent,
  options: ManualRecordingOptions,
  detection?: SensitiveFieldDetection,
): ActionRecord {
  const { runId, specPath, startStepIndex } = options
  const timestamp = event.timestamp

  let toolName: IRToolName
  let toolInput: Record<string, unknown>
  let elementInfo: CapturedEvent['elementInfo'] | undefined

  switch (event.type) {
    case 'navigate': {
      toolName = 'navigate'
      toolInput = { url: event.url ?? '' }
      break
    }

    case 'click': {
      toolName = 'click'
      toolInput = {}
      elementInfo = event.elementInfo
      break
    }

    case 'fill': {
      toolName = 'fill'
      const fillValue = detection
        ? valueToFillValue(event.value ?? '', detection)
        : { kind: 'literal' as const, value: event.value ?? '' }

      toolInput = {
        fillValue,
        // For logging, include a safe representation
        value: detection?.isSensitive ? `{{${detection.templateVar}}}` : event.value,
      }
      elementInfo = event.elementInfo
      break
    }

    case 'select_option': {
      toolName = 'select_option'
      toolInput = { value: event.value ?? '' }
      elementInfo = event.elementInfo
      break
    }

    default: {
      // Fallback for unknown event types
      toolName = 'wait'
      toolInput = { seconds: 0 }
    }
  }

  return {
    runId,
    specPath,
    stepIndex: null, // Manual steps don't have original step indices
    toolName,
    toolInput,
    outcome: { ok: true },
    timestamp,
    // Include element info if available
    ...(elementInfo && {
      element: {
        fingerprint: {
          tagName: elementInfo.tagName,
          id: elementInfo.id,
          nameAttr: elementInfo.name,
          typeAttr: elementInfo.type,
          placeholder: elementInfo.placeholder,
        },
        locatorCandidates: [],
      },
    }),
  }
}

/**
 * Manual Recorder class for recording user browser actions.
 *
 * Injects event listeners into the page to capture click, fill,
 * select_option, and navigate events during manual continuation mode.
 */
export class ManualRecorder {
  private readonly options: ManualRecordingOptions
  private readonly recordedEvents: CapturedEvent[] = []
  private readonly logger?: Logger
  private isRecording: boolean = false
  private sensitiveFieldsRedacted: number = 0

  // Event handler cleanup functions
  private cleanupFunctions: Array<() => void> = []

  constructor(options: ManualRecordingOptions) {
    this.options = options
    this.logger = options.logger
  }

  /**
   * Check if recording is currently active.
   */
  isActive(): boolean {
    return this.isRecording
  }

  /**
   * Start recording user actions on the page.
   *
   * Injects event listeners to capture clicks, input changes,
   * and navigation events.
   */
  async start(): Promise<void> {
    if (this.isRecording) {
      this.logger?.log({
        event: 'autoqa.repair.manual_recorder.already_active',
        runId: this.options.runId,
        specPath: this.options.specPath,
      })
      return
    }

    const { page, runId, specPath, startStepIndex } = this.options

    this.logger?.log({
      event: 'autoqa.repair.manual_recorder.started',
      runId,
      specPath,
      startStepIndex,
    })

    // Clear any previous events
    this.recordedEvents.length = 0
    this.sensitiveFieldsRedacted = 0
    this.isRecording = true

    // Inject recording script into page
    await this.injectRecordingScript(page)

    this.logger?.log({
      event: 'autoqa.repair.manual_recorder.script_injected',
      runId,
      specPath,
    })
  }

  /**
   * Inject recording script into the page.
   *
   * Sets up event listeners for click, input, change, and navigation events.
   * Captured events are sent via console.log for Node.js to intercept.
   */
  private async injectRecordingScript(page: Page): Promise<void> {
    await page.evaluate(() => {
      // Store events to be picked up
      ;(window as any).__autoqa_manual_events__ = []

      const logEvent = (eventType: string, data: Record<string, unknown>) => {
        const event = {
          type: eventType,
          timestamp: Date.now(),
          ...data,
        }
        ;(window as any).__autoqa_manual_events__.push(event)
        // Also log for immediate pickup
        console.log('__AUTOQA_MANUAL_EVENT__:' + JSON.stringify(event))
      }

      // Capture click events
      const clickHandler = (e: MouseEvent) => {
        const target = e.target as Element
        logEvent('click', {
          selector: getElementSelector(target),
          elementInfo: extractElementInfo(target),
        })
      }

      // Capture input events (for text fields)
      const inputHandler = (e: Event) => {
        const target = e.target as HTMLInputElement
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
          // Only log on change/blur to avoid recording every keystroke
          const value = target.value ?? ''
          logEvent('fill', {
            selector: getElementSelector(target),
            value,
            elementInfo: extractElementInfo(target),
          })
        }
      }

      // Capture change events (for selects and checkboxes)
      const changeHandler = (e: Event) => {
        const target = e.target as HTMLSelectElement | HTMLInputElement
        if (target.tagName === 'SELECT') {
          const select = target as HTMLSelectElement
          logEvent('select_option', {
            selector: getElementSelector(target),
            value: select.value ?? '',
            elementInfo: extractElementInfo(target),
          })
        }
      }

      // Helper to generate CSS selector for element
      function getElementSelector(el: Element): string {
        if (el.id) {
          return `#${el.id}`
        }
        if (el.className && typeof el.className === 'string') {
          const classes = el.className.split(' ').filter((c) => c).slice(0, 2)
          if (classes.length > 0) {
            return `${el.tagName.toLowerCase()}.${classes[0]}`
          }
        }
        return el.tagName.toLowerCase()
      }

      // Helper to extract element info
      function extractElementInfo(el: Element) {
        return {
          tagName: el.tagName.toLowerCase(),
          id: el.id || undefined,
          name: (el as HTMLInputElement).name || undefined,
          type: (el as HTMLInputElement).type || undefined,
          placeholder: (el as HTMLInputElement).placeholder || undefined,
        }
      }

      // Register handlers with capture to intercept early
      document.body.addEventListener('click', clickHandler, true)
      document.body.addEventListener('input', inputHandler, true)
      document.body.addEventListener('change', changeHandler, true)

      // Store cleanup function
      ;(window as any).__autoqa_manual_cleanup__ = () => {
        document.body.removeEventListener('click', clickHandler, true)
        document.body.removeEventListener('input', inputHandler, true)
        document.body.removeEventListener('change', changeHandler, true)
        delete (window as any).__autoqa_manual_events__
      }
    })

    // Set up console listener to capture events
    const consoleHandler = (msg: any) => {
      const text = msg.text()
      if (text.startsWith('__AUTOQA_MANUAL_EVENT__:')) {
        try {
          const eventData = JSON.parse(text.replace('__AUTOQA_MANUAL_EVENT__:', ''))
          this.handleCapturedEvent(eventData as CapturedEvent)
        } catch (err) {
          this.logger?.log({
            event: 'autoqa.repair.manual_recorder.event_parse_failed',
            runId: this.options.runId,
            specPath: this.options.specPath,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }

    page.on('console', consoleHandler)

    // Store cleanup for console handler
    this.cleanupFunctions.push(() => {
      page.off('console', consoleHandler)
    })
  }

  /**
   * Handle a captured event from the page.
   *
   * Validates and stores the event, checking for sensitive fields.
   */
  private handleCapturedEvent(event: CapturedEvent): void {
    if (!this.isRecording) {
      return
    }

    // Deduplicate fill events for the same selector
    if (event.type === 'fill') {
      const lastFill = this.recordedEvents
        .slice()
        .reverse()
        .find((e) => e.type === 'fill' && e.selector === event.selector)

      if (lastFill && Date.now() - lastFill.timestamp < 1000) {
        // Skip duplicate fill events within 1 second
        return
      }
    }

    // Detect sensitive fields for fill events
    let detection: SensitiveFieldDetection | undefined
    if (event.type === 'fill' && event.elementInfo) {
      detection = detectSensitiveField(event.elementInfo)
      if (detection.isSensitive) {
        this.sensitiveFieldsRedacted++
      }
    }

    this.recordedEvents.push(event)

    // Create and emit ActionRecord if callback provided
    if (this.options.onStepRecorded) {
      const actionRecord = eventToActionRecord(event, this.options, detection)
      this.options.onStepRecorded(actionRecord)
    }

    this.logger?.log({
      event: 'autoqa.repair.manual_recorder.event_captured',
      runId: this.options.runId,
      specPath: this.options.specPath,
      eventType: event.type,
      selector: event.selector,
      isSensitive: detection?.isSensitive ?? false,
      templateVar: detection?.templateVar,
    })
  }

  /**
   * Stop recording and return captured events as ActionRecords.
   *
   * @returns ManualRecordingResult with converted ActionRecords
   */
  async stop(): Promise<ManualRecordingResult> {
    if (!this.isRecording) {
      return {
        ok: false,
        steps: [],
        stepsCount: 0,
        sensitiveFieldsRedacted: 0,
        error: 'Recording was not active',
      }
    }

    const { page, runId, specPath } = this.options

    this.logger?.log({
      event: 'autoqa.repair.manual_recorder.stopping',
      runId,
      specPath,
      eventsCaptured: this.recordedEvents.length,
    })

    this.isRecording = false

    // Remove injected script and event listeners
    try {
      await page.evaluate(() => {
        const cleanup = (window as any).__autoqa_manual_cleanup__
        if (typeof cleanup === 'function') {
          cleanup()
        }
      })
    } catch {
      // Page may have been closed, ignore error
    }

    // Clean up console listeners
    for (const cleanup of this.cleanupFunctions) {
      cleanup()
    }
    this.cleanupFunctions = []

    // Convert events to ActionRecords
    const steps: ActionRecord[] = []
    for (const event of this.recordedEvents) {
      // For fill events, re-detect sensitive fields
      let detection: SensitiveFieldDetection | undefined
      if (event.type === 'fill' && event.elementInfo) {
        detection = detectSensitiveField(event.elementInfo)
      }

      const actionRecord = eventToActionRecord(event, this.options, detection)
      steps.push(actionRecord)
    }

    this.logger?.log({
      event: 'autoqa.repair.manual_recorder.stopped',
      runId,
      specPath,
      stepsCount: steps.length,
      sensitiveFieldsRedacted: this.sensitiveFieldsRedacted,
    })

    return {
      ok: true,
      steps,
      stepsCount: steps.length,
      sensitiveFieldsRedacted: this.sensitiveFieldsRedacted,
    }
  }
}

/**
 * Create a new ManualRecorder instance.
 *
 * @param options - Manual recording options
 * @returns ManualRecorder instance
 */
export function createManualRecorder(options: ManualRecordingOptions): ManualRecorder {
  return new ManualRecorder(options)
}
