/**
 * Element Picker for Interactive Repair Mode
 *
 * Provides in-browser element selection with hover highlighting,
 * locator generation, and uniqueness validation.
 */

import type { Page } from 'playwright'
import type { LocatorCandidate, LocatorKind } from '../ir/types.js'
import type { Logger } from '../logging/index.js'

/**
 * Global type augmentation for window properties used by element picker.
 * These are set in the browser context via page.evaluate().
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace autoqa {
    interface Window {
      __autoqa_cleanup__?: () => void
      __autoqa_handlers__?: {
        mouseoverHandler: (e: Event) => void
        mouseoutHandler: (e: Event) => void
        clickHandler: (e: MouseEvent) => void
      }
    }
  }
}

// Ensure the augmentation is treated as a module
declare global {
  interface Window extends autoqa.Window {}
}

/**
 * Element information extracted from a clicked element.
 */
export type ElementInfo = {
  tagName: string
  id?: string
  className?: string
  text?: string
  role?: string
  name?: string
  type?: string
  placeholder?: string
  ariaLabel?: string
  testId?: string
  testName?: string
  dataCy?: string
}

/**
 * Priority levels for locator generation.
 */
export type LocatorPriority = {
  priority: number
  kind: LocatorKind
  value: string
  code: string
  reason: string
}

/**
 * Result of locator generation with validation.
 */
export type ValidatedLocator = LocatorCandidate & {
  priority: number
  reason: string
}

/**
 * Options for enabling element picker.
 */
export type ElementPickerOptions = {
  /** Logger instance for observability */
  logger?: Logger
  /** Run ID for logging context */
  runId?: string
  /** Spec path for logging context */
  specPath?: string
}

/**
 * Injects element picker functionality into the page.
 *
 * Creates a highlight box that follows mouse hover and a tooltip
 * showing element information. Click events are captured and sent
 * via console.log for Node.js to intercept.
 *
 * @param page - Playwright page object
 * @returns Promise that resolves when injection is complete
 */
export async function injectElementPicker(page: Page): Promise<void> {
  await page.evaluate(() => {
    // Avoid duplicate injection
    if (document.getElementById('__autoqa_highlight_box__')) {
      return
    }

    // Create highlight box
    const highlightBox = document.createElement('div')
    highlightBox.id = '__autoqa_highlight_box__'
    highlightBox.style.cssText = `
      position: fixed;
      border: 2px solid #ff6b6b;
      background: rgba(255, 107, 107, 0.15);
      pointer-events: none;
      z-index: 999999;
      display: none;
      transition: all 0.1s ease;
    `
    document.body.appendChild(highlightBox)

    // Create tooltip
    const tooltip = document.createElement('div')
    tooltip.id = '__autoqa_tooltip__'
    tooltip.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #1a1a1a;
      color: #50fa7b;
      padding: 12px 24px;
      border-radius: 8px;
      font-family: Monaco, Menlo, monospace;
      font-size: 14px;
      z-index: 999999;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    `
    tooltip.textContent = '🔧 元素选择模式已启用 - 点击页面上的任意元素'
    document.body.appendChild(tooltip)

    // Store cleanup function
    ;(window as any).__autoqa_cleanup__ = () => {
      highlightBox.remove()
      tooltip.remove()
    }

    // Mouseover effect - highlight element
    const mouseoverHandler = (e: Event) => {
      const target = e.target as HTMLElement
      const rect = target.getBoundingClientRect()

      highlightBox.style.display = 'block'
      highlightBox.style.left = rect.left + 'px'
      highlightBox.style.top = rect.top + 'px'
      highlightBox.style.width = rect.width + 'px'
      highlightBox.style.height = rect.height + 'px'

      // Update tooltip with element info
      const tagName = target.tagName.toLowerCase()
      const text = target.textContent?.trim().substring(0, 20) || ''
      tooltip.textContent = `${tagName}${text ? `: "${text}"` : ''}`
    }

    // Mouseout effect - hide highlight
    const mouseoutHandler = (e: Event) => {
      if ((e.target as Element) === highlightBox) return
      highlightBox.style.display = 'none'
    }

    // Click handler - capture element info
    const clickHandler = (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()

      const target = e.target as Element
      const info = analyzeElementInPage(target)

      // Send via console.log for Node.js interception
      console.log('__AUTOQA_SELECTED__:' + JSON.stringify(info))
    }

    // Use capture phase to intercept events before they reach other handlers
    document.body.addEventListener('mouseover', mouseoverHandler, true)
    document.body.addEventListener('mouseout', mouseoutHandler, true)
    document.body.addEventListener('click', clickHandler, true)

    // Store handlers for cleanup
    ;(window as any).__autoqa_handlers__ = { mouseoverHandler, mouseoutHandler, clickHandler }
  })
}

/**
 * Removes the element picker from the page.
 *
 * Cleans up injected DOM elements and event listeners.
 *
 * @param page - Playwright page object
 */
export async function removeElementPicker(page: Page): Promise<void> {
  await page.evaluate(() => {
    const cleanup = (window as any).__autoqa_cleanup__
    if (typeof cleanup === 'function') {
      cleanup()
    }

    // Remove event listeners
    const handlers = (window as any).__autoqa_handlers__
    if (handlers) {
      document.body.removeEventListener('mouseover', handlers.mouseoverHandler, true)
      document.body.removeEventListener('mouseout', handlers.mouseoutHandler, true)
      document.body.removeEventListener('click', handlers.clickHandler, true)
      delete (window as any).__autoqa_handlers__
    }

    delete (window as any).__autoqa_cleanup__
  })
}

/**
 * Analyzes an element within the page context.
 *
 * Extracts attributes and properties needed for locator generation.
 * This function is executed inside page.evaluate().
 *
 * @param el - Element to analyze
 * @returns Element information object
 */
function analyzeElementInPage(el: Element): ElementInfo {
  const htmlElement = el as HTMLElement

  const tagName = el.tagName.toLowerCase()
  const id = el.id || undefined
  const className = typeof el.className === 'string' ? el.className : undefined
  const text = htmlElement.textContent?.trim().substring(0, 50) || undefined
  const role = el.getAttribute('role') || undefined
  const name = el.getAttribute('name') || undefined
  const type = el.getAttribute('type') || undefined
  const placeholder = el.getAttribute('placeholder') || undefined
  const ariaLabel = el.getAttribute('aria-label') || undefined
  const testId = el.getAttribute('data-testid') || undefined
  const testName = el.getAttribute('data-test') || undefined
  const dataCy = el.getAttribute('data-cy') || undefined

  return {
    tagName,
    id,
    className,
    text,
    role,
    name,
    type,
    placeholder,
    ariaLabel,
    testId,
    testName,
    dataCy,
  }
}

/**
 * Generates locator candidates based on element information.
 *
 * Prioritizes locators according to stability:
 * 100-90: test attributes (data-testid, data-test, data-cy)
 * 80-60: Semantic attributes (id, role, placeholder)
 * 50-30: Content-based (text, label)
 * 20-5: CSS-based (class, tag)
 *
 * @param elementInfo - Extracted element information
 * @returns Array of locator candidates with priorities
 */
export function generateLocatorCandidates(elementInfo: ElementInfo): LocatorPriority[] {
  const locators: LocatorPriority[] = []

  const { tagName, id, className, text, role, name, placeholder, ariaLabel, testId, testName, dataCy } =
    elementInfo

  // Priority 100: data-testid (most stable)
  if (testId) {
    locators.push({
      priority: 100,
      kind: 'getByTestId',
      value: testId,
      code: `page.getByTestId('${testId}')`,
      reason: 'data-testid attribute (recommended)',
    })
  }

  // Priority 95: data-test
  if (testName) {
    locators.push({
      priority: 95,
      kind: 'getByTestId',
      value: testName,
      code: `page.getByTestId('${testName}')`,
      reason: 'data-test attribute',
    })
  }

  // Priority 90: data-cy (Cypress compatibility)
  if (dataCy) {
    locators.push({
      priority: 90,
      kind: 'getByTestId',
      value: dataCy,
      code: `page.getByTestId('${dataCy}')`,
      reason: 'data-cy attribute',
    })
  }

  // Priority 80: ID (if concise and meaningful)
  if (id && id.length < 20 && !id.match(/^\d/)) {
    locators.push({
      priority: 80,
      kind: 'cssId',
      value: id,
      code: `page.locator('#${id}')`,
      reason: 'ID attribute',
    })
  }

  // Priority 70: Role + accessible name
  if (role) {
    const accessibleName = ariaLabel || placeholder || (text && text.length > 0 && text.length < 30 ? text : undefined)
    if (accessibleName) {
      locators.push({
        priority: 70,
        kind: 'getByRole',
        value: `${role}:${accessibleName}`,
        code: `page.getByRole('${role}', { name: '${accessibleName}' })`,
        reason: 'Semantic role with name',
      })
    }
  }

  // Priority 60: Placeholder (for form inputs)
  if (placeholder) {
    locators.push({
      priority: 60,
      kind: 'getByPlaceholder',
      value: placeholder,
      code: `page.getByPlaceholder('${placeholder}')`,
      reason: 'Placeholder attribute',
    })
  }

  // Priority 50: Exact text (short, single-line text)
  if (text && text.length > 0 && text.length < 30 && !text.match(/\n/)) {
    locators.push({
      priority: 50,
      kind: 'textExact',
      value: text,
      code: `page.getByText('${text}', { exact: true })`,
      reason: 'Exact text match',
    })
  }

  // Priority 40: Partial text
  if (text && text.length > 0 && text.length < 50) {
    locators.push({
      priority: 40,
      kind: 'text',
      value: text.substring(0, 20),
      code: `page.getByText('${text.substring(0, 20)}')`,
      reason: 'Partial text match',
    })
  }

  // Priority 30: ARIA label
  if (ariaLabel) {
    locators.push({
      priority: 30,
      kind: 'getByLabel',
      value: ariaLabel,
      code: `page.getByLabel('${ariaLabel}')`,
      reason: 'ARIA label',
    })
  }

  // Priority 20: Name attribute (for forms)
  if (name) {
    locators.push({
      priority: 20,
      kind: 'cssAttr',
      value: `name="${name}"`,
      code: `page.locator('[name="${name}"]')`,
      reason: 'Name attribute',
    })
  }

  // Priority 10: CSS class (first meaningful class)
  if (className && className.length > 0) {
    const classes = className.split(' ').filter((c) => c && !c.match(/^(active|selected|hover|focus)$/i))
    if (classes.length > 0) {
      locators.push({
        priority: 10,
        kind: 'cssSelector',
        value: classes[0],
        code: `page.locator('.${classes[0]}')`,
        reason: 'CSS class',
      })
    }
  }

  // Priority 5: Tag name (fallback)
  locators.push({
    priority: 5,
    kind: 'cssSelector',
    value: tagName,
    code: `page.locator('${tagName}')`,
    reason: 'Tag name (fallback)',
  })

  // Sort by priority descending
  return locators.sort((a, b) => b.priority - a.priority)
}

/**
 * Converts locator code to CSS selector for validation.
 *
 * Extracts the underlying selector from Playwright locator code
 * to use with page.locator().count() for uniqueness validation.
 *
 * @param locatorCode - Playwright locator code (e.g., "page.getByTestId('foo')")
 * @returns CSS selector string, or null if extraction fails
 */
export function locatorCodeToSelector(locatorCode: string): string | null {
  let selector: string | null = null

  if (locatorCode.includes("getByTestId('")) {
    const match = locatorCode.match(/getByTestId\('(.+?)'\)/)
    if (match) selector = `[data-testid="${match[1]}"]`
  } else if (locatorCode.includes("getByRole('")) {
    const roleMatch = locatorCode.match(/getByRole\('(.+?)'/)
    if (roleMatch) {
      selector = `[role="${roleMatch[1]}"]`
      // Try to extract name for more specific selector
      const nameMatch = locatorCode.match(/name:\s*['"](.+?)['"]/)
      if (nameMatch) {
        selector += `[aria-label~="${nameMatch[1]}"]`
      }
    }
  } else if (locatorCode.includes("getByPlaceholder('")) {
    const match = locatorCode.match(/getByPlaceholder\('(.+?)'\)/)
    if (match) selector = `[placeholder="${match[1]}"]`
  } else if (locatorCode.includes("getByText('")) {
    const match = locatorCode.match(/getByText\('(.+?)'/)
    if (match) {
      const exact = locatorCode.includes('{ exact: true }')
      // For text-based locators, we can't easily convert to CSS selector
      // Return null to indicate validation should use different method
      return null
    }
  } else if (locatorCode.includes("getByLabel('")) {
    const match = locatorCode.match(/getByLabel\('(.+?)'\)/)
    if (match) selector = `[aria-label="${match[1]}"]`
  } else if (locatorCode.includes("locator('#")) {
    const match = locatorCode.match(/locator\('#(.+?)'\)/)
    if (match) selector = `#${match[1]}`
  } else if (locatorCode.includes("locator('[name=\"")) {
    const match = locatorCode.match(/locator\('\[name="(.+?)"\]'\)/)
    if (match) selector = `[name="${match[1]}"]`
  } else if (locatorCode.includes("locator('.")) {
    const match = locatorCode.match(/locator\('\.(.+?)'\)/)
    if (match) selector = `.${match[1]}`
  } else if (locatorCode.includes("locator('")) {
    const match = locatorCode.match(/locator\('(.+?)'\)/)
    if (match) selector = match[1]
  }

  return selector
}

/**
 * Validates whether a locator uniquely identifies a single element.
 *
 * @param page - Playwright page object
 * @param locatorCode - Playwright locator code to validate
 * @returns Validation result with uniqueness flag and match count
 */
export async function validateLocatorUniqueness(
  page: Page,
  locatorCode: string,
): Promise<{ isUnique: boolean; count: number }> {
  try {
    const selector = locatorCodeToSelector(locatorCode)

    if (!selector) {
      // For text-based locators without CSS selector equivalent,
      // use the locator code directly with page.locator
      const cleanCode = locatorCode.replace(/^page\./, '')
      // Convert getByText to text-is pseudo-selector
      if (cleanCode.startsWith('getByText(')) {
        const match = cleanCode.match(/getByText\('(.+?)'/)
        if (match) {
          const exact = locatorCode.includes('{ exact: true }')
          const textSelector = exact ? `:text-is("${match[1]}")` : `:text("${match[1]}")`
          const count = await page.locator(textSelector).count()
          return { isUnique: count === 1, count }
        }
      }
      // Default: count as 0 (cannot validate)
      return { isUnique: false, count: 0 }
    }

    const count = await page.locator(selector).count()
    return {
      isUnique: count === 1,
      count,
    }
  } catch {
    return { isUnique: false, count: 0 }
  }
}

/**
 * Generates and validates locator candidates for an element.
 *
 * Combines generation and validation in a single operation.
 *
 * @param page - Playwright page object
 * @param elementInfo - Extracted element information
 * @param options - Optional logger configuration
 * @returns Array of validated locator candidates
 */
export async function generateAndValidateLocators(
  page: Page,
  elementInfo: ElementInfo,
  options?: ElementPickerOptions,
): Promise<ValidatedLocator[]> {
  const { logger, runId = '', specPath = '' } = options || {}

  const candidates = generateLocatorCandidates(elementInfo)

  const validated: ValidatedLocator[] = []

  for (const candidate of candidates) {
    const { isUnique, count } = await validateLocatorUniqueness(page, candidate.code)

    validated.push({
      kind: candidate.kind,
      value: candidate.value,
      code: candidate.code,
      priority: candidate.priority,
      reason: candidate.reason,
      validation: {
        unique: isUnique,
      },
    })

    logger?.log({
      event: 'autoqa.repair.locator_validated',
      runId,
      specPath,
      locatorKind: candidate.kind,
      locatorCode: candidate.code,
      isUnique,
      matchCount: count,
    })
  }

  return validated
}

/**
 * Recommends the best locator from validated candidates.
 *
 * Selection criteria:
 * 1. Must be unique (validation.unique === true)
 * 2. Highest priority among unique candidates
 * 3. Falls back to highest priority candidate if none are unique
 *
 * @param validated - Array of validated locator candidates
 * @returns The recommended locator candidate, or null if array is empty
 */
export function recommendBestLocator(validated: ValidatedLocator[]): ValidatedLocator | null {
  if (validated.length === 0) return null

  // Find highest priority unique locator
  const uniqueCandidates = validated.filter((c) => c.validation.unique)
  if (uniqueCandidates.length > 0) {
    return uniqueCandidates[0] // Already sorted by priority
  }

  // Fallback: return highest priority even if not unique
  return validated[0]
}

/**
 * Waits for the user to select an element on the page.
 *
 * Listens for console messages containing element selection data.
 *
 * @param page - Playwright page object
 * @param options - Optional configuration including timeout
 * @returns Promise resolving to element info when user clicks
 */
export function waitForElementSelection(
  page: Page,
  options?: ElementPickerOptions & { timeout?: number },
): Promise<ElementInfo> {
  const { timeout = 300000 } = options || {} // Default 5 minutes

  return new Promise((resolve, reject) => {
    let alreadyResolved = false

    const cleanup = () => {
      if (!alreadyResolved) {
        alreadyResolved = true
        clearTimeout(timeoutHandle)
        page.off('console', consoleHandler)
      }
    }

    const timeoutHandle = setTimeout(() => {
      cleanup()
      reject(new Error(`Element selection timeout after ${timeout}ms`))
    }, timeout)

    const consoleHandler = (msg: any) => {
      const text = msg.text()
      if (text.startsWith('__AUTOQA_SELECTED__:')) {
        cleanup()

        try {
          const data = JSON.parse(text.replace('__AUTOQA_SELECTED__:', '')) as ElementInfo
          resolve(data)
        } catch (err) {
          reject(new Error(`Failed to parse element selection data: ${err}`))
        }
      }
    }

    page.on('console', consoleHandler)
  })
}

/**
 * Formats validated locators for CLI display.
 *
 * @param validated - Array of validated locator candidates
 * @returns Formatted string for terminal output
 */
export function formatLocatorCandidates(validated: ValidatedLocator[]): string {
  const lines: string[] = []

  lines.push('═════════════════════════════════════════════════════')
  lines.push('🎯 生成的 Locator (按优先级排序):')
  lines.push('═════════════════════════════════════════════════════')

  for (let i = 0; i < validated.length; i++) {
    const { code, validation, reason } = validated[i]
    const status = validation.unique ? '✅' : '⚠️ '
    const countText = validation.unique ? '唯一' : '可能不唯一'

    lines.push(`  ${i + 1}. ${status} ${code}`)
    lines.push(`       (${countText}) - ${reason}`)
  }

  lines.push('')
  lines.push('═════════════════════════════════════════════════════')

  const best = recommendBestLocator(validated)
  if (best) {
    const status = best.validation.unique ? '✅ 唯一' : '⚠️  可能不唯一'
    lines.push('💡 推荐:')
    lines.push('═════════════════════════════════════════════════════')
    lines.push(`  ${status} ${best.code}`)
  }

  return lines.join('\n')
}
