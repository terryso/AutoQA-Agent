/**
 * Export Playwright Test
 *
 * Generates @playwright/test .spec.ts files from IR and spec files.
 */

import { writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import type { ActionRecord, FillValue } from '../ir/types.js'
import type { MarkdownSpec, MarkdownSpecStep } from '../markdown/spec-types.js'
import {
  ensureExportDir,
  getExportPath,
  getRelativeExportPath,
} from './export-paths.js'
import { getSpecActionRecords, getMissingLocatorActions, hasValidChosenLocator } from './ir-reader.js'

/**
 * Export result types.
 */
export type ExportSuccess = {
  ok: true
  exportPath: string
  relativePath: string
}

export type ExportFailure = {
  ok: false
  reason: string
  missingLocators?: string[]
}

export type ExportResult = ExportSuccess | ExportFailure

/**
 * Options for exporting a Playwright test.
 */
export type ExportOptions = {
  cwd: string
  runId: string
  specPath: string
  spec: MarkdownSpec
  baseUrl: string
  loginBaseUrl?: string
  /** Raw (unrendered) spec content for extracting {{VAR}} placeholders */
  rawSpecContent?: string
  /** Custom export directory (relative to cwd), defaults to 'tests/autoqa' */
  exportDir?: string
}

/**
 * Pattern to match {{VAR}} placeholders in spec text.
 */
const TEMPLATE_VAR_PATTERN = /\{\{\s*([A-Z0-9_]+)\s*\}\}/g

/**
 * Extract all {{VAR}} placeholders from a string.
 * Returns array of variable names (without braces).
 */
function extractTemplateVars(text: string): string[] {
  const vars: string[] = []
  let match: RegExpExecArray | null
  const pattern = new RegExp(TEMPLATE_VAR_PATTERN.source, 'g')
  while ((match = pattern.exec(text)) !== null) {
    const varName = (match[1] ?? '').trim()
    if (varName && !vars.includes(varName)) {
      vars.push(varName)
    }
  }
  return vars
}

function buildTextExpressionFromRawValue(rawValue: string): { expr: string; envVars: Set<string>; needsLoginBaseUrl: boolean } | null {
  const exactVarMatch = rawValue.match(/^\{\{\s*([A-Z0-9_]+)\s*\}\}\s*$/)
  if (exactVarMatch) {
    const varName = (exactVarMatch[1] ?? '').trim()
    if (!varName) return null

    if (varName === 'BASE_URL') {
      return { expr: 'baseUrl', envVars: new Set<string>(), needsLoginBaseUrl: false }
    }
    if (varName === 'LOGIN_BASE_URL') {
      return { expr: 'loginBaseUrl', envVars: new Set<string>(), needsLoginBaseUrl: true }
    }
    return { expr: varName.toLowerCase(), envVars: new Set<string>([varName]), needsLoginBaseUrl: false }
  }

  const envVars = new Set<string>()
  const parts: string[] = []
  let needsLoginBaseUrl = false
  let hasBaseUrlVar = false

  const pattern = new RegExp(TEMPLATE_VAR_PATTERN.source, 'g')
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(rawValue)) !== null) {
    const fullMatch = match[0] ?? ''
    const varName = (match[1] ?? '').trim()
    const start = match.index
    const end = start + fullMatch.length

    if (start > lastIndex) {
      parts.push(rawValue.slice(lastIndex, start))
    }

    if (varName) {
      if (varName === 'BASE_URL') {
        hasBaseUrlVar = true
        parts.push('${baseUrl}')
      } else if (varName === 'LOGIN_BASE_URL') {
        needsLoginBaseUrl = true
        parts.push('${loginBaseUrl}')
      } else {
        envVars.add(varName)
        parts.push('${' + varName.toLowerCase() + '}')
      }
    } else {
      parts.push(fullMatch)
    }

    lastIndex = end
  }

  if (lastIndex < rawValue.length) {
    parts.push(rawValue.slice(lastIndex))
  }

  if (envVars.size === 0 && !needsLoginBaseUrl && !hasBaseUrlVar) return null

  const templateBody = parts
    .join('')
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')

  return { expr: `\`${templateBody}\``, envVars, needsLoginBaseUrl }
}

/**
 * Parse raw spec content and build a map of stepIndex -> variables used in that step.
 * Also returns all unique variables found across all steps.
 */
function parseRawSpecVars(rawContent: string): {
  stepVars: Map<number, { vars: string[]; rawText: string }>
  allVars: Set<string>
} {
  const stepVars = new Map<number, { vars: string[]; rawText: string }>()
  const allVars = new Set<string>()

  // Parse steps section
  const stepsMatch = rawContent.match(/##\s*Steps[\s\S]*?(?=##|$)/i)
  if (!stepsMatch) return { stepVars, allVars }

  const stepsSection = stepsMatch[0]
  // Match numbered steps: "1. Step text" or "1) Step text"
  const stepPattern = /^\s*(\d+)[.)\s]+(.+)$/gm
  let match: RegExpExecArray | null
  while ((match = stepPattern.exec(stepsSection)) !== null) {
    const stepIndex = parseInt(match[1], 10)
    const rawText = match[2].trim()
    const vars = extractTemplateVars(rawText)
    if (vars.length > 0) {
      stepVars.set(stepIndex, { vars, rawText })
      vars.forEach((v) => allVars.add(v))
    }
  }

  return { stepVars, allVars }
}

function safeParseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function extractRelativeFromAbsolute(urlStr: string, baseUrlStr: string | undefined): string | null {
  if (!baseUrlStr) return null
  const base = safeParseUrl(baseUrlStr)
  const url = safeParseUrl(urlStr)
  if (!base || !url) return null
  if (url.origin !== base.origin) return null
  return `${url.pathname}${url.search}${url.hash}`
}

type StepNeeds = {
  /** Set of variable names (e.g. 'USERNAME', 'PASSWORD') needed by this step */
  envVars?: Set<string>
  loginBaseUrl?: boolean
}

/**
 * Redact step text for export comments.
 * If stepVars contains variables for this step, replace the rendered value with variable reference.
 */
function redactStepTextForExport(
  stepText: string,
  baseUrl: string,
  loginBaseUrl?: string,
  stepVarInfo?: { vars: string[]; rawText: string },
): string {
  // If we have raw text with variables, use it (replacing {{VAR}} with AUTOQA_VAR)
  if (stepVarInfo && stepVarInfo.vars.length > 0) {
    let redacted = stepVarInfo.rawText
    for (const varName of stepVarInfo.vars) {
      redacted = redacted.replace(
        new RegExp(`\\{\\{\\s*${varName}\\s*\\}\\}`, 'g'),
        `AUTOQA_${varName}`,
      )
    }
    return redacted
  }

  // Fallback: redact absolute URLs
  const navigatePath = parseNavigateStep(stepText)
  if (navigatePath !== null && navigatePath.startsWith('http')) {
    const relFromBase = extractRelativeFromAbsolute(navigatePath, baseUrl)
    if (relFromBase !== null) return `Navigate to ${relFromBase}`
    const relFromLogin = extractRelativeFromAbsolute(navigatePath, loginBaseUrl)
    if (relFromLogin !== null) return `Navigate to ${relFromLogin}`
  }

  return stepText
}

/**
 * Parse a navigate step to extract the path.
 * Supports formats like:
 * - "Navigate to /"
 * - "Navigate to /path"
 * - "导航到 /"
 */
function parseNavigateStep(stepText: string): string | null {
  const patterns = [
    /^navigate\s+to\s+(\S+)/i,
    /^导航到\s+(\S+)/i,
    /^go\s+to\s+(\S+)/i,
  ]

  for (const pattern of patterns) {
    const match = stepText.match(pattern)
    if (match) {
      return match[1]
    }
  }

  return null
}

function parseLoginFormFieldsAssertion(stepText: string): string[] | null {
  const lower = stepText.toLowerCase()
  const isVerify = lower.startsWith('verify') || lower.startsWith('assert') || stepText.startsWith('验证') || stepText.startsWith('断言')
  if (!isVerify) return null
  if (!lower.includes('login form') || !lower.includes('field')) return null

  const quoted = Array.from(stepText.matchAll(/["']([^"']+)["']/g))
    .map((m) => (m[1] ?? '').trim())
    .filter((v) => v.length > 0)

  if (quoted.length === 0) return null
  return quoted
}

/**
 * Generate fill code from IR fillValue.
 * Returns null if fillValue is redacted (cannot generate code).
 */
function generateFillCodeFromIR(
  locatorCode: string,
  fillValue: FillValue,
): { code: string; needs?: StepNeeds } | null {
  if (fillValue.kind === 'template_var') {
    const varName = fillValue.name
    const jsVarName = varName.toLowerCase()
    return {
      code: `  await ${locatorCode}.fill(${jsVarName});`,
      needs: { envVars: new Set([varName]) },
    }
  }

  if (fillValue.kind === 'literal') {
    return {
      code: `  await ${locatorCode}.fill('${escapeString(fillValue.value)}');`,
    }
  }

  // fillValue.kind === 'redacted' - cannot generate code
  return null
}

function parseFillStep(stepText: string): { target: string; value: string } | null {
  const patterns = [
    /^fill\s+(?:the\s+)?["']?([^"']+)["']?\s+(?:field\s+)?with\s+(.+)$/i,
    /^在\s*["']?([^"']+)["']?\s*(?:字段)?(?:中)?输入\s+(.+)$/i,
    /^(?:type|enter|input)\s+(.+)\s+(?:in|into)\s+(?:the\s+)?["']?([^"']+)["']?/i,
  ]

  for (const pattern of patterns) {
    const match = stepText.match(pattern)
    if (match) {
      // Handle different capture group orders
      if (pattern.source.includes('in|into')) {
        return { target: match[2].trim(), value: match[1].trim() }
      }
      return { target: match[1].trim(), value: match[2].trim() }
    }
  }

  return null
}

/**
 * Parse a click step to extract the target.
 * Supports formats like:
 * - "Click the 'Login' button"
 * - "Click 'Login'"
 * - "点击 'Login' 按钮"
 */
function parseClickStep(stepText: string): string | null {
  const patterns = [
    /^click\s+(?:the\s+)?["']?([^"']+)["']?\s*(?:button|link|element)?$/i,
    /^点击\s*["']?([^"']+)["']?\s*(?:按钮|链接|元素)?$/i,
  ]

  for (const pattern of patterns) {
    const match = stepText.match(pattern)
    if (match) {
      return match[1].trim()
    }
  }

  return null
}

/**
 * Parse a select step to extract the target and option.
 * Supports formats like:
 * - "Select 'Option A' from the dropdown"
 * - "Select 'Option A' in 'Dropdown'"
 */
function parseSelectStep(stepText: string): { target: string; label: string } | null {
  const patterns = [
    /^select\s+["']?([^"']+)["']?\s+(?:from|in)\s+(?:the\s+)?["']?([^"']+)["']?/i,
    /^选择\s*["']?([^"']+)["']?\s*(?:从|在)\s*["']?([^"']+)["']?/i,
  ]

  for (const pattern of patterns) {
    const match = stepText.match(pattern)
    if (match) {
      return { label: match[1].trim(), target: match[2].trim() }
    }
  }

  return null
}

/**
 * Parse an assertion step to extract the assertion type and value.
 * Supports formats like:
 * - "Verify the page shows 'Products'"
 * - "Verify the user is logged in and sees the inventory/products page"
 * - "Assert that 'Login' button is visible"
 * - "验证页面显示 'Products'"
 */
function parseAssertionStep(stepText: string): { type: 'text' | 'element'; value: string } | null {
  // Element visibility patterns
  const elementPatterns = [
    /^(?:verify|assert)\s+(?:that\s+)?(?:the\s+)?["']?([^"']+)["']?\s+(?:button|link|element|icon)\s+is\s+visible/i,
    /^验证\s*["']?([^"']+)["']?\s*(?:按钮|链接|元素|图标)\s*(?:可见|显示)/i,
  ]

  for (const pattern of elementPatterns) {
    const match = stepText.match(pattern)
    if (match) {
      return { type: 'element', value: match[1].trim() }
    }
  }

  // Text presence patterns
  const textPatterns = [
    /^(?:verify|assert)\s+(?:that\s+)?(?:the\s+)?page\s+(?:shows|contains|displays)\s+(?:text\s+)?["']?([^"']+)["']?/i,
    /^(?:verify|assert)\s+(?:that\s+)?(?:the\s+)?page\s+(?:shows|contains|displays)\s+["']?([^"']+)["']?/i,
    /^验证\s*(?:页面)?(?:显示|包含)\s*["']?([^"']+)["']?/i,
    /^断言\s*(?:页面)?(?:显示|包含)\s*["']?([^"']+)["']?/i,
  ]

  for (const pattern of textPatterns) {
    const match = stepText.match(pattern)
    if (match) {
      return { type: 'text', value: match[1].trim() }
    }
  }

  // Fallback: extract quoted text as text assertion
  const quotedMatch = stepText.match(/["']([^"']+)["']/)
  if (quotedMatch) {
    return { type: 'text', value: quotedMatch[1].trim() }
  }

  return null
}

/**
 * Escape a string for use in generated code.
 */
function escapeString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Generate a fallback locator from targetDescription when chosenLocator is missing.
 * Returns a locator code string or null if unable to generate.
 */
function generateFallbackLocator(record: ActionRecord): { code: string; isFallback: true } | null {
  const targetDesc = record.toolInput?.targetDescription as string | undefined
  if (!targetDesc) return null

  const descLower = targetDesc.toLowerCase()

  // Try to extract a meaningful name from the description
  // Common patterns: "search button", "login button", "submit button", etc.
  if (descLower.includes('button')) {
    // Extract the button name (text before "button")
    const match = targetDesc.match(/^(.+?)\s*button/i)
    if (match) {
      const buttonName = match[1].trim()
      if (buttonName) {
        return {
          code: `page.getByRole('button', { name: /${escapeRegExp(buttonName)}/i })`,
          isFallback: true,
        }
      }
    }
    // Fallback to role button without name
    return {
      code: `page.getByRole('button')`,
      isFallback: true,
    }
  }

  // Try to extract link name
  if (descLower.includes('link')) {
    const match = targetDesc.match(/^(.+?)\s*link/i)
    if (match) {
      const linkName = match[1].trim()
      if (linkName) {
        return {
          code: `page.getByRole('link', { name: /${escapeRegExp(linkName)}/i })`,
          isFallback: true,
        }
      }
    }
  }

  // Try to use fingerprint textSnippet if available
  const textSnippet = record.element?.fingerprint?.textSnippet
  if (textSnippet) {
    return {
      code: `page.getByText('${escapeString(textSnippet)}')`,
      isFallback: true,
    }
  }

  // Last resort: use getByText with the target description (cleaned up)
  // Remove common suffixes like "button", "link", "element", etc.
  const cleanedDesc = targetDesc
    .replace(/\s*(button|link|element|textbox|input|field|to trigger.*|to submit.*|to search.*)$/i, '')
    .trim()

  if (cleanedDesc) {
    return {
      code: `page.getByText(/${escapeRegExp(cleanedDesc)}/i)`,
      isFallback: true,
    }
  }

  return null
}

/**
 * Find the IR record matching a step.
 */
function findMatchingRecord(
  step: MarkdownSpecStep,
  records: ActionRecord[],
): ActionRecord | undefined {
  // First try to match by stepIndex
  const byIndex = records.find((r) => r.stepIndex === step.index && r.outcome.ok)
  if (byIndex) return byIndex

  // Fallback: match by tool name and approximate step text
  const stepLower = step.text.toLowerCase()

  if (stepLower.includes('navigate') || stepLower.includes('导航')) {
    return records.find((r) => r.toolName === 'navigate' && r.outcome.ok)
  }

  if (stepLower.includes('fill') || stepLower.includes('输入')) {
    return records.find((r) => r.toolName === 'fill' && r.outcome.ok && r.stepIndex === step.index)
  }

  if (stepLower.includes('click') || stepLower.includes('点击')) {
    return records.find((r) => r.toolName === 'click' && r.outcome.ok && r.stepIndex === step.index)
  }

  if (stepLower.includes('select') || stepLower.includes('选择')) {
    return records.find((r) => r.toolName === 'select_option' && r.outcome.ok && r.stepIndex === step.index)
  }

  return undefined
}

/**
 * Generate code for a single step.
 * @param stepVarInfo - If provided, contains the variables used in this step from raw spec
 */
function generateStepCode(
  step: MarkdownSpecStep,
  records: ActionRecord[],
  baseUrl: string,
  loginBaseUrl?: string,
  stepVarInfo?: { vars: string[]; rawText: string },
): { code: string; error?: string; needs?: StepNeeds } {
  const stepText = step.text
  const stepVars = stepVarInfo?.vars ? [...stepVarInfo.vars] : []

  // Handle assertions
  if (step.kind === 'assertion') {
    const assertionRecords = records.filter(
      (r) =>
        r.stepIndex === step.index &&
        r.outcome.ok &&
        (r.toolName === 'assertTextPresent' || r.toolName === 'assertElementVisible'),
    )

    if (assertionRecords.length === 0) {
      // No assertion IR record - generate a TODO comment instead of failing
      // This happens when agent verified via snapshot but didn't call assertion tools
      return {
        code: `  // TODO: Add assertion for: ${escapeString(stepText)}`,
      }
    }

    const parts: string[] = []
    const needsEnvVars = new Set<string>()
    let needsLoginBaseUrl = false

    for (const v of stepVars) {
      if (v !== 'BASE_URL' && v !== 'LOGIN_BASE_URL') needsEnvVars.add(v)
      if (v === 'LOGIN_BASE_URL') needsLoginBaseUrl = true
    }

    let i = 0
    for (const record of assertionRecords) {
      i += 1
      if (record.toolName === 'assertTextPresent') {
        const rawAssertion = stepVarInfo?.rawText ? parseAssertionStep(stepVarInfo.rawText) : null
        const rawValue = rawAssertion?.type === 'text' ? rawAssertion.value : null
        const rawExpr = rawValue ? buildTextExpressionFromRawValue(rawValue) : null

        const text = typeof record.toolInput?.text === 'string' ? String(record.toolInput.text) : ''
        if (!text && !rawExpr) {
          return {
            code: '',
            error: `Assertion step ${step.index} missing text in IR`,
          }
        }

        const visibleNthRaw = (record.toolInput as any)?.visibleNth
        const visibleNth = typeof visibleNthRaw === 'number' && Number.isInteger(visibleNthRaw) && visibleNthRaw >= 0
          ? visibleNthRaw
          : undefined

        if (rawExpr) {
          rawExpr.envVars.forEach((v) => needsEnvVars.add(v))
          if (rawExpr.needsLoginBaseUrl) needsLoginBaseUrl = true
          if (typeof visibleNth === 'number') {
            const locatorVar = `locator${step.index}_${i}`
            parts.push(`  const ${locatorVar} = page.getByText(${rawExpr.expr});`)
            parts.push(`  await expect(${locatorVar}.nth(${visibleNth})).toBeVisible();`)
          } else {
            parts.push(`  await expect(page.getByText(${rawExpr.expr}).first()).toBeVisible();`)
          }
        } else {
          if (typeof visibleNth === 'number') {
            const locatorVar = `locator${step.index}_${i}`
            parts.push(`  const ${locatorVar} = page.getByText('${escapeString(text)}');`)
            parts.push(`  await expect(${locatorVar}.nth(${visibleNth})).toBeVisible();`)
          } else {
            parts.push(`  await expect(page.getByText('${escapeString(text)}').first()).toBeVisible();`)
          }
        }
        continue
      }

      if (record.toolName === 'assertElementVisible') {
        if (!hasValidChosenLocator(record)) {
          return {
            code: '',
            error: `Assertion step ${step.index} missing valid chosenLocator`,
          }
        }
        const locatorCode = record.element!.chosenLocator!.code
        const locatorVar = `locator${step.index}_${i}`
        parts.push(`  const ${locatorVar} = ${locatorCode};`)
        parts.push(`  await expect(${locatorVar}).toHaveCount(1);`)
        parts.push(`  await expect(${locatorVar}).toBeVisible();`)
        continue
      }
    }

    const needs: StepNeeds = {}
    if (needsEnvVars.size > 0) needs.envVars = needsEnvVars
    if (needsLoginBaseUrl) needs.loginBaseUrl = true
    return { code: parts.join('\n'), needs }
  }

  // Handle navigate
  const navigatePath = parseNavigateStep(stepText)
  if (navigatePath !== null) {
    const rawNavigatePath = stepVarInfo?.rawText ? parseNavigateStep(stepVarInfo.rawText) : null
    if (rawNavigatePath) {
      const rawVarMatch = rawNavigatePath.match(/^\{\{\s*([A-Z0-9_]+)\s*\}\}(.*)$/)
      if (rawVarMatch) {
        const varName = (rawVarMatch[1] ?? '').trim()
        const suffix = (rawVarMatch[2] ?? '').trim()

        if (varName === 'BASE_URL') {
          if (!suffix) {
            return { code: '  await page.goto(baseUrl);' }
          }
          return { code: `  await page.goto(new URL('${escapeString(suffix)}', baseUrl).toString());` }
        }

        if (varName === 'LOGIN_BASE_URL') {
          if (!suffix) {
            return { code: '  await page.goto(loginBaseUrl);', needs: { loginBaseUrl: true } }
          }
          return {
            code: `  await page.goto(new URL('${escapeString(suffix)}', loginBaseUrl).toString());`,
            needs: { loginBaseUrl: true },
          }
        }

        const jsVarName = varName.toLowerCase()
        const needsVars = new Set<string>([varName])
        if (!suffix) {
          return { code: `  await page.goto(${jsVarName});`, needs: { envVars: needsVars } }
        }
        return {
          code: `  await page.goto(new URL('${escapeString(suffix)}', ${jsVarName}).toString());`,
          needs: { envVars: needsVars },
        }
      }
    }

    if (navigatePath.startsWith('http')) {
      const relFromBase = extractRelativeFromAbsolute(navigatePath, baseUrl)
      if (relFromBase !== null) {
        return {
          code: `  await page.goto(new URL('${escapeString(relFromBase)}', baseUrl).toString());`,
        }
      }

      const relFromLogin = extractRelativeFromAbsolute(navigatePath, loginBaseUrl)
      if (relFromLogin !== null) {
        return {
          code: `  await page.goto(new URL('${escapeString(relFromLogin)}', loginBaseUrl).toString());`,
          needs: { loginBaseUrl: true },
        }
      }

      return { code: `  await page.goto('${escapeString(navigatePath)}');` }
    }

    return { code: `  await page.goto(new URL('${escapeString(navigatePath)}', baseUrl).toString());` }
  }

  // Handle fill - prefer IR fillValue, fallback to parseFillStep
  const fillRecord = records.find((r) => r.stepIndex === step.index && r.toolName === 'fill' && r.outcome.ok)
  if (fillRecord && hasValidChosenLocator(fillRecord)) {
    const locatorCode = fillRecord.element!.chosenLocator!.code
    const irFillValue = fillRecord.toolInput?.fillValue as FillValue | undefined

    // Use IR fillValue if available (new format)
    if (irFillValue) {
      const fillCodeResult = generateFillCodeFromIR(locatorCode, irFillValue)
      if (fillCodeResult) {
        return fillCodeResult
      }
    }

    // Fallback to stepVars from raw spec (legacy support)
    if (stepVars.length > 0) {
      const varName = stepVars[0]
      const jsVarName = varName.toLowerCase()
      return {
        code: `  await ${locatorCode}.fill(${jsVarName});`,
        needs: { envVars: new Set(stepVars) },
      }
    }

    // Fallback to parseFillStep (legacy support)
    const fillParsed = parseFillStep(stepText)
    if (fillParsed) {
      return {
        code: `  await ${locatorCode}.fill('${escapeString(fillParsed.value)}');`,
      }
    }

    // If we have a fill record but can't determine value, generate TODO
    return {
      code: `  await ${locatorCode}.fill(''); // TODO: fill value not captured`,
    }
  }

  // Legacy: Handle fill via parseFillStep when no IR record
  const fillParsed = parseFillStep(stepText)
  if (fillParsed) {
    const record = findMatchingRecord(step, records)
    if (!record || !hasValidChosenLocator(record)) {
      return {
        code: '',
        error: `Fill action at step ${step.index} missing valid chosenLocator`,
      }
    }

    const locatorCode = record.element!.chosenLocator!.code
    if (stepVars.length > 0) {
      const varName = stepVars[0]
      const jsVarName = varName.toLowerCase()
      return {
        code: `  await ${locatorCode}.fill(${jsVarName});`,
        needs: { envVars: new Set(stepVars) },
      }
    }

    return {
      code: `  await ${locatorCode}.fill('${escapeString(fillParsed.value)}');`,
    }
  }

  // Handle click - prefer IR chosenLocator, fallback to targetDescription
  const clickTarget = parseClickStep(stepText)
  if (clickTarget) {
    const record = findMatchingRecord(step, records)
    if (!record) {
      return {
        code: '',
        error: `Click action at step ${step.index} missing IR record`,
      }
    }

    if (hasValidChosenLocator(record)) {
      const locatorCode = record.element!.chosenLocator!.code
      return {
        code: `  await ${locatorCode}.click();`,
      }
    }

    // Try fallback locator from targetDescription
    const fallback = generateFallbackLocator(record)
    if (fallback) {
      return {
        code: `  await ${fallback.code}.click(); // TODO: verify this fallback locator`,
      }
    }

    return {
      code: '',
      error: `Click action at step ${step.index} missing valid chosenLocator`,
    }
  }

  // Handle select - must use IR chosenLocator
  const selectParsed = parseSelectStep(stepText)
  if (selectParsed) {
    const record = findMatchingRecord(step, records)
    if (!record || !hasValidChosenLocator(record)) {
      return {
        code: '',
        error: `Select action at step ${step.index} missing valid chosenLocator`,
      }
    }

    const locatorCode = record.element!.chosenLocator!.code
    return {
      code: `  await ${locatorCode}.selectOption({ label: '${escapeString(selectParsed.label)}' });`,
    }
  }

  // Unknown step type - try to match with IR record
  const record = findMatchingRecord(step, records)
  if (record) {
    if (record.toolName === 'navigate') {
      const url = record.toolInput?.url as string | undefined
      if (url) {
        if (url.startsWith('http')) {
          const relFromBase = extractRelativeFromAbsolute(url, baseUrl)
          if (relFromBase !== null) {
            return {
              code: `  await page.goto(new URL('${escapeString(relFromBase)}', baseUrl).toString());`,
            }
          }

          const relFromLogin = extractRelativeFromAbsolute(url, loginBaseUrl)
          if (relFromLogin !== null) {
            return {
              code: `  await page.goto(new URL('${escapeString(relFromLogin)}', loginBaseUrl).toString());`,
              needs: { loginBaseUrl: true },
            }
          }

          return { code: `  await page.goto('${escapeString(url)}');` }
        }
        return { code: `  await page.goto(new URL('${escapeString(url)}', baseUrl).toString());` }
      }
    }

    if (record.toolName === 'click') {
      if (hasValidChosenLocator(record)) {
        return { code: `  await ${record.element!.chosenLocator!.code}.click();` }
      }
      // Try fallback locator
      const fallback = generateFallbackLocator(record)
      if (fallback) {
        return { code: `  await ${fallback.code}.click(); // TODO: verify this fallback locator` }
      }
    }

    if (record.toolName === 'fill' && hasValidChosenLocator(record)) {
      const locatorCode = record.element!.chosenLocator!.code
      const irFillValue = record.toolInput?.fillValue as FillValue | undefined

      // Use IR fillValue if available (new format)
      if (irFillValue) {
        const fillCodeResult = generateFillCodeFromIR(locatorCode, irFillValue)
        if (fillCodeResult) {
          return fillCodeResult
        }
      }

      // Fallback to stepVars from raw spec
      if (stepVars.length > 0) {
        const varName = stepVars[0]
        const jsVarName = varName.toLowerCase()
        return {
          code: `  await ${locatorCode}.fill(${jsVarName});`,
          needs: { envVars: new Set(stepVars) },
        }
      }

      // Fallback to parseFillStep
      const parsed = parseFillStep(stepText)
      if (parsed?.value) {
        return { code: `  await ${locatorCode}.fill('${escapeString(parsed.value)}');` }
      }

      // Generate TODO if value unknown
      return { code: `  await ${locatorCode}.fill(''); // TODO: fill value not captured` }
    }

    if (record.toolName === 'select_option' && hasValidChosenLocator(record)) {
      const label = record.toolInput?.label as string | undefined
      if (label) {
        return { code: `  await ${record.element!.chosenLocator!.code}.selectOption({ label: '${escapeString(label)}' });` }
      }
    }
  }

  // Fallback: unknown or non-action step – generate a TODO line in the exported test instead of failing
  return {
    code: `  // TODO: Step ${step.index} not automatically exported: ${escapeString(stepText)}`,
  }
}

/**
 * Generate environment variable declarations for the given variable names.
 * Each variable is declared as `const varName = process.env.AUTOQA_VARNAME` with a null check.
 */
function generateEnvVarDeclarations(envVars: Set<string>): string {
  if (envVars.size === 0) return ''

  const declarations: string[] = []
  for (const varName of Array.from(envVars).sort()) {
    const jsVarName = varName.toLowerCase()
    const envKey = `AUTOQA_${varName}`
    declarations.push(`const ${jsVarName} = getEnvVar('${envKey}')`)
  }
  return declarations.join('\n') + '\n'
}

/**
 * Generate the full Playwright test file content.
 * @param rawSpecContent - Optional raw (unrendered) spec content for extracting {{VAR}} placeholders
 */
function generateTestFileContent(
  specPath: string,
  spec: MarkdownSpec,
  records: ActionRecord[],
  baseUrl: string,
  loginBaseUrl: string | undefined,
  rawSpecContent: string | undefined,
  exportDir: string | undefined,
  cwd: string,
): { content: string; errors: string[] } {
  const errors: string[] = []
  const stepCodes: string[] = []
  let needsLoginBaseUrl = false
  const allEnvVars = new Set<string>()

  // Parse raw spec to get variable mappings per step
  const { stepVars } = rawSpecContent ? parseRawSpecVars(rawSpecContent) : { stepVars: new Map() }

  for (const step of spec.steps) {
    const stepVarInfo = stepVars.get(step.index)
    const { code, error, needs } = generateStepCode(step, records, baseUrl, loginBaseUrl, stepVarInfo)
    if (error) {
      errors.push(error)
    }
    if (needs?.envVars) {
      needs.envVars.forEach((v) => allEnvVars.add(v))
    }
    if (needs?.loginBaseUrl) needsLoginBaseUrl = true
    if (code) {
      stepCodes.push(`  // Step ${step.index}: ${redactStepTextForExport(step.text, baseUrl, loginBaseUrl, stepVarInfo)}`)
      stepCodes.push(code)
    }
  }

  // Extract test name from spec path
  const testName = specPath
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.md$/i, '')
    ?.replace(/-/g, ' ') ?? 'Exported Test'

  // Calculate relative path to the helper file
  // Helper is always at {cwd}/tests/helpers/autoqa-env.ts
  // Test file is at {cwd}/{exportDir}/{spec-name}.spec.ts
  const helperPath = join(cwd, 'tests/helpers/autoqa-env.ts')
  const exportDirAbs = exportDir ? join(cwd, exportDir) : cwd
  const importPath = relative(exportDirAbs, helperPath).replace(/\.ts$/, '')
  const autoqaEnvImport = importPath.startsWith('../') ? importPath : `./${importPath}`

  const content = `import { test, expect } from '@playwright/test'
import { loadEnvFiles, getEnvVar } from '${autoqaEnvImport}'

loadEnvFiles()

const baseUrl = getEnvVar('AUTOQA_BASE_URL')
${needsLoginBaseUrl ? `const loginBaseUrl = getEnvVar('AUTOQA_LOGIN_BASE_URL')\n` : ''}${generateEnvVarDeclarations(allEnvVars)}
test('${escapeString(testName)}', async ({ page }) => {
${stepCodes.join('\n')}
})
`

  return { content, errors }
}

/**
 * Export a Playwright test file from IR and spec.
 */
export async function exportPlaywrightTest(options: ExportOptions): Promise<ExportResult> {
  const { cwd, runId, specPath, spec, baseUrl, loginBaseUrl, rawSpecContent, exportDir } = options

  // Read IR records for this spec
  let records: ActionRecord[]
  try {
    records = await getSpecActionRecords(cwd, runId, specPath)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      reason: `Failed to read IR file: ${msg}`,
    }
  }

  if (records.length === 0) {
    return {
      ok: false,
      reason: 'Export failed: No IR records found for spec',
    }
  }

  // Check for missing locators on element-targeting actions
  const missingLocatorActions = getMissingLocatorActions(records)
  if (missingLocatorActions.length > 0) {
    const missingDetails = missingLocatorActions.map((r) => {
      const stepInfo = r.stepIndex !== null ? `step ${r.stepIndex}` : 'unknown step'
      return `${r.toolName} at ${stepInfo}`
    })

    return {
      ok: false,
      reason: `Export failed: ${missingLocatorActions.length} action(s) missing valid chosenLocator`,
      missingLocators: missingDetails,
    }
  }

  // Generate test file content
  const { content, errors } = generateTestFileContent(specPath, spec, records, baseUrl, loginBaseUrl, rawSpecContent, exportDir, cwd)

  if (errors.length > 0) {
    return {
      ok: false,
      reason: `Export failed: ${errors.join('; ')}`,
    }
  }

  // Ensure export directory exists
  try {
    await ensureExportDir(cwd, exportDir)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      reason: `Failed to create export directory: ${msg}`,
    }
  }

  // Write the test file
  const exportPath = getExportPath(cwd, specPath, exportDir)
  const relativePath = getRelativeExportPath(cwd, specPath, exportDir)

  try {
    await writeFile(exportPath, content, 'utf-8')
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      reason: `Failed to write export file: ${msg}`,
    }
  }

  return {
    ok: true,
    exportPath,
    relativePath,
  }
}

/**
 * Check if a spec is exportable (has IR records with valid locators).
 */
export async function isSpecExportable(
  cwd: string,
  runId: string,
  specPath: string,
): Promise<{ exportable: boolean; reason?: string }> {
  try {
    const records = await getSpecActionRecords(cwd, runId, specPath)

    if (records.length === 0) {
      return { exportable: false, reason: 'No IR records found for spec' }
    }

    const missingLocatorActions = getMissingLocatorActions(records)
    if (missingLocatorActions.length > 0) {
      return {
        exportable: false,
        reason: `${missingLocatorActions.length} action(s) missing valid chosenLocator`,
      }
    }

    return { exportable: true }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { exportable: false, reason: `Failed to check exportability: ${msg}` }
  }
}
