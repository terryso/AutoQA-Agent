/**
 * Export Playwright Test from IR
 *
 * Generates @playwright/test .spec.ts files directly from IR records.
 * Uses IR.toolName as the single source of truth for code generation.
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
import { getSpecActionRecords, hasValidChosenLocator } from './ir-reader.js'

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
 * Result of code generation for a step.
 */
type CodeResult = {
  code: string
  error?: string
  needs?: StepNeeds
}

type StepNeeds = {
  /** Set of variable names (e.g. 'USERNAME', 'PASSWORD') needed by this step */
  envVars?: Set<string>
  loginBaseUrl?: boolean
}

type StepVarInfo = {
  vars: string[]
  rawText: string
}

/**
 * Pattern to match {{VAR}} placeholders in spec text.
 */
const TEMPLATE_VAR_PATTERN = /\{\{\s*([A-Z0-9_]+)\s*\}\}/g

/**
 * Extract all {{VAR}} placeholders from a string.
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

/**
 * Parse raw spec content and build a map of stepIndex -> variables used in that step.
 */
function parseRawSpecVars(rawContent: string): {
  stepVars: Map<number, StepVarInfo>
  allVars: Set<string>
} {
  const stepVars = new Map<number, StepVarInfo>()
  const allVars = new Set<string>()

  // Parse steps section
  const stepsMatch = rawContent.match(/##\s*Steps[\s\S]*?(?=##|$)/i)
  if (!stepsMatch) return { stepVars, allVars }

  const stepsSection = stepsMatch[0]
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

function escapeString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

/**
 * Parse a navigate step to extract the path from raw text.
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

/**
 * Wrap navigate code - no additional wait since Agent controls wait via IR.
 */
function withWaitForLoadState(navigateCode: string): string {
  return navigateCode
}

/**
 * Convert a string to camelCase.
 * Handles kebab-case, snake_case, space-separated strings, and mixed Chinese/English.
 *
 * Examples:
 * - "account-input" → "accountInput"
 * - "user_name_field" → "userNameField"
 * - "Account Input" → "accountInput"
 * - "账号-input" → "账号Input"
 */
function toCamelCase(str: string): string {
  if (!str) return ''

  // Remove special characters (keep letters, numbers, and Chinese characters)
  let cleaned = str.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, ' ')

  // Trim and normalize spaces
  cleaned = cleaned.trim().replace(/\s+/g, ' ')

  if (!cleaned) return ''

  // First character lowercase
  const firstChar = cleaned[0] ?? ''
  const rest = cleaned.slice(1)

  // Convert space/hyphen/underscore followed by character to uppercase
  let result = firstChar.toLowerCase()

  for (let i = 0; i < rest.length; i++) {
    const char = rest[i]
    const prevChar = rest[i - 1] ?? ''

    // If previous char was a space (now removed), capitalize current char
    if (prevChar === ' ' && char !== ' ') {
      result += char.toUpperCase()
    } else if (char !== ' ') {
      result += char
    }
  }

  return result
}

/**
 * Sanitize a string to be a valid JavaScript/TypeScript identifier.
 *
 * Rules:
 * 1. Must start with a letter or underscore (not a digit)
 * 2. Can only contain letters, digits, and underscores
 * 3. Chinese characters are removed
 *
 * @param input - Raw string to sanitize
 * @param fallback - Fallback name if sanitization results in empty string
 * @returns A valid JavaScript identifier
 */
function sanitizeVariableName(input: string, fallback: string = 'text'): string {
  if (!input) return fallback

  // Remove Chinese characters and special chars, keep only letters and digits
  let sanitized = input.replace(/[\u4e00-\u9fa5]/g, '').replace(/[^a-zA-Z0-9]+/g, '')

  // Handle empty result (all Chinese/special chars)
  if (!sanitized) {
    return fallback
  }

  // Ensure it doesn't start with a digit - prefix with 'text'
  if (/^[0-9]/.test(sanitized)) {
    sanitized = 'text' + sanitized
  }

  return sanitized
}

/**
 * Generate a meaningful variable name from element fingerprint.
 *
 * Priority order:
 * 1. testId - with common suffixes stripped (-input, -btn, -button, -field)
 * 2. placeholder - with common prefixes stripped (请输入, input, enter)
 * 3. textSnippet
 * 4. id attribute
 * 5. tagName + role (fallback)
 * 6. "element" (ultimate fallback)
 *
 * @param fingerprint - Element fingerprint from IR
 * @param suffix - Optional suffix to append (e.g., "2" for duplicate names)
 * @returns A meaningful variable name
 */
function generateMeaningfulVarName(
  fingerprint: import('../ir/types.js').ElementFingerprint,
  suffix?: string,
): string {
  const parts: string[] = []

  // Priority 1: testId (strip common suffixes)
  if (fingerprint.testId) {
    let name = fingerprint.testId.toLowerCase()
    // Remove common suffixes
    name = name.replace(/-input$/, '').replace(/-button$/, '').replace(/-btn$/, '').replace(/-field$/, '')
    // kebab-case to camelCase
    name = toCamelCase(name)
    parts.push(name)
  }
  // Priority 2: placeholder (strip common prefixes BEFORE camelCase)
  else if (fingerprint.placeholder) {
    let placeholder = fingerprint.placeholder
    // Remove common prefixes from raw placeholder text
    placeholder = placeholder.replace(/^请输入/, '').replace(/^输入/, '')
    placeholder = placeholder.replace(/^请/, '')
    // English prefixes (case-insensitive)
    placeholder = placeholder.replace(/^input\s+/i, '').replace(/^enter\s+/i, '')
    placeholder = placeholder.replace(/^your\s+/i, '')

    // Convert to camelCase after stripping
    let name = toCamelCase(placeholder)

    // If empty after stripping, use original
    if (!name) {
      name = toCamelCase(fingerprint.placeholder)
    }
    parts.push(name)
  }
  // Priority 3: textSnippet
  else if (fingerprint.textSnippet) {
    parts.push(toCamelCase(fingerprint.textSnippet))
  }
  // Priority 4: id attribute
  else if (fingerprint.id) {
    parts.push(toCamelCase(fingerprint.id))
  }
  // Priority 5: tagName + role
  else {
    if (fingerprint.role) parts.push(fingerprint.role)
    if (fingerprint.tagName) parts.push(fingerprint.tagName)
  }

  let varName = parts.join('') || 'element'

  // Add suffix if provided
  if (suffix) {
    varName += suffix
  }

  return varName
}

/**
 * Build navigate code from raw URL (may contain {{VAR}}).
 */
function buildNavigateCodeFromRaw(
  rawUrl: string,
  baseUrl: string,
  loginBaseUrl: string | undefined,
): CodeResult {
  // Check for exact variable match (e.g., {{BASE_URL}})
  const exactVarMatch = rawUrl.match(/^\{\{\s*([A-Z0-9_]+)\s*\}\}\s*$/)
  if (exactVarMatch) {
    const varName = (exactVarMatch[1] ?? '').trim()
    if (!varName) {
      return { code: '', error: 'Invalid variable reference' }
    }

    if (varName === 'BASE_URL') {
      return { code: withWaitForLoadState('  await page.goto(baseUrl);') }
    }
    if (varName === 'LOGIN_BASE_URL') {
      return {
        code: withWaitForLoadState('  await page.goto(loginBaseUrl);'),
        needs: { loginBaseUrl: true },
      }
    }
    const jsVarName = varName.toLowerCase()
    return {
      code: withWaitForLoadState(`  await page.goto(${jsVarName});`),
      needs: { envVars: new Set([varName]) },
    }
  }

  // Check for BASE_URL or LOGIN_BASE_URL with suffix (e.g., {{BASE_URL}}/login)
  const baseUrlSuffixMatch = rawUrl.match(/^\{\{\s*(BASE_URL|LOGIN_BASE_URL)\s*\}\}\s*(.*)$/)
  if (baseUrlSuffixMatch) {
    const varName = baseUrlSuffixMatch[1] ?? ''
    const suffix = (baseUrlSuffixMatch[2] ?? '').trim()
    const baseVarName = varName === 'BASE_URL' ? 'baseUrl' : 'loginBaseUrl'

    if (!suffix) {
      // No suffix, should have been caught by exactVarMatch
      return {
        code: withWaitForLoadState(`  await page.goto(${baseVarName});`),
        needs: varName === 'LOGIN_BASE_URL' ? { loginBaseUrl: true } : undefined,
      }
    }

    // Has suffix: use new URL(suffix, baseUrl)
    const needs: StepNeeds = varName === 'LOGIN_BASE_URL' ? { loginBaseUrl: true } : {}
    return {
      code: withWaitForLoadState(`  await page.goto(new URL('${escapeString(suffix)}', ${baseVarName}).toString());`),
      needs,
    }
  }

  // Check for other variables in path
  const envVars = new Set<string>()
  const parts: string[] = []
  let needsLoginBaseUrl = false
  let hasBaseUrlVar = false

  const pattern = new RegExp(TEMPLATE_VAR_PATTERN.source, 'g')
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(rawUrl)) !== null) {
    const fullMatch = match[0] ?? ''
    const varName = (match[1] ?? '').trim()
    const start = match.index
    const end = start + fullMatch.length

    if (start > lastIndex) {
      parts.push(rawUrl.slice(lastIndex, start))
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
    }

    lastIndex = end
  }

  if (lastIndex < rawUrl.length) {
    parts.push(rawUrl.slice(lastIndex))
  }

  if (envVars.size === 0 && !needsLoginBaseUrl && !hasBaseUrlVar) {
    // No variables, use direct URL
    return buildNavigateCodeFromUrl(rawUrl, baseUrl, loginBaseUrl)
  }

  const templateBody = parts.join('').replace(/`/g, '\\`')
  const needs: StepNeeds = {}
  if (envVars.size > 0) needs.envVars = envVars
  if (needsLoginBaseUrl) needs.loginBaseUrl = true

  return { code: withWaitForLoadState(`  await page.goto(\`${templateBody}\`);`), needs }
}

/**
 * Build navigate code from a concrete URL.
 */
function buildNavigateCodeFromUrl(
  url: string,
  baseUrl: string,
  loginBaseUrl: string | undefined,
): CodeResult {
  if (url.startsWith('http')) {
    const relFromBase = extractRelativeFromAbsolute(url, baseUrl)
    if (relFromBase !== null) {
      return {
        code: withWaitForLoadState(`  await page.goto(new URL('${escapeString(relFromBase)}', baseUrl).toString());`),
      }
    }

    const relFromLogin = extractRelativeFromAbsolute(url, loginBaseUrl)
    if (relFromLogin !== null) {
      return {
        code: withWaitForLoadState(`  await page.goto(new URL('${escapeString(relFromLogin)}', loginBaseUrl).toString());`),
        needs: { loginBaseUrl: true },
      }
    }

    return { code: withWaitForLoadState(`  await page.goto('${escapeString(url)}');`) }
  }

  return {
    code: withWaitForLoadState(`  await page.goto(new URL('${escapeString(url)}', baseUrl).toString());`),
  }
}

// ============================================================================
// Tool-specific code generators
// ============================================================================

/**
 * Generate code for 'navigate' action.
 */
function generateNavigateCode(
  record: ActionRecord,
  baseUrl: string,
  loginBaseUrl: string | undefined,
  stepVarInfo?: StepVarInfo,
): CodeResult {
  // Prefer raw spec text for template variables
  if (stepVarInfo?.rawText) {
    const rawUrl = parseNavigateStep(stepVarInfo.rawText)
    if (rawUrl) {
      return buildNavigateCodeFromRaw(rawUrl, baseUrl, loginBaseUrl)
    }
  }

  // Fallback to IR url
  const url = record.toolInput?.url as string | undefined
  if (!url) {
    return { code: '', error: 'Navigate missing url in IR' }
  }

  return buildNavigateCodeFromUrl(url, baseUrl, loginBaseUrl)
}

/**
 * Generate code for 'click' action.
 */
function generateClickCode(record: ActionRecord): CodeResult {
  if (!hasValidChosenLocator(record)) {
    return { code: '', error: 'Click missing valid chosenLocator' }
  }

  const locatorCode = record.element!.chosenLocator!.code
  return { code: `  await ${locatorCode}.click();` }
}

/**
 * Generate code for 'select_option' action.
 */
function generateSelectCode(record: ActionRecord): CodeResult {
  if (!hasValidChosenLocator(record)) {
    return { code: '', error: 'Select missing valid chosenLocator' }
  }

  const label = record.toolInput?.label as string | undefined
  if (!label) {
    return { code: '', error: 'Select missing label in IR' }
  }

  const locatorCode = record.element!.chosenLocator!.code
  return {
    code: `  await ${locatorCode}.selectOption({ label: '${escapeString(label)}' });`,
  }
}

/**
 * Generate code for 'fill' action.
 */
function generateFillCode(
  record: ActionRecord,
  stepVarInfo?: StepVarInfo,
): CodeResult {
  if (!hasValidChosenLocator(record)) {
    return { code: '', error: 'Fill missing valid chosenLocator' }
  }

  const locatorCode = record.element!.chosenLocator!.code
  const fillValue = record.toolInput?.fillValue as FillValue | undefined

  if (fillValue) {
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

    // redacted - try to get value from stepVarInfo
    if (stepVarInfo?.vars.length) {
      const varName = stepVarInfo.vars[0]
      const jsVarName = varName.toLowerCase()
      return {
        code: `  await ${locatorCode}.fill(${jsVarName});`,
        needs: { envVars: new Set(stepVarInfo.vars) },
      }
    }

    return {
      code: `  await ${locatorCode}.fill(''); // TODO: fill value was redacted`,
    }
  }

  return { code: `  await ${locatorCode}.fill(''); // TODO: fill value not captured` }
}

/**
 * Generate code for 'assertTextPresent' action.
 */
function generateAssertTextCode(
  record: ActionRecord,
  stepVarInfo?: StepVarInfo,
): CodeResult {
  const text = record.toolInput?.text as string | undefined
  if (!text) {
    return { code: '', error: 'AssertText missing text in IR' }
  }

  // Check for template variables in stepVarInfo
  if (stepVarInfo?.rawText) {
    const rawText = stepVarInfo.rawText
    const exactVarMatch = rawText.match(/^\{\{\s*([A-Z0-9_]+)\s*\}\}\s*$/)
    if (exactVarMatch) {
      const varName = (exactVarMatch[1] ?? '').trim()
      if (varName !== 'BASE_URL' && varName !== 'LOGIN_BASE_URL') {
        const jsVarName = varName.toLowerCase()
        return {
          code: `  await expect(page.getByText(${jsVarName})).toBeVisible();`,
          needs: { envVars: new Set([varName]) },
        }
      }
    }
  }

  const visibleNth = record.toolInput?.visibleNth as number | undefined
  if (typeof visibleNth === 'number' && Number.isInteger(visibleNth) && visibleNth >= 0) {
    // First convert to camelCase, then sanitize to remove Chinese and handle leading digits
    const textVarName = sanitizeVariableName(toCamelCase(text))
    return {
      code: `  const ${textVarName} = page.getByText('${escapeString(text)}');\n  await expect(${textVarName}.nth(${visibleNth})).toBeVisible();`,
    }
  }

  return {
    code: `  await expect(page.getByText('${escapeString(text)}').first()).toBeVisible();`,
  }
}

/**
 * Generate code for 'assertElementVisible' action.
 */
function generateAssertElementCode(record: ActionRecord): CodeResult {
  if (!hasValidChosenLocator(record)) {
    return { code: '', error: 'AssertElement missing valid chosenLocator' }
  }

  const locatorCode = record.element!.chosenLocator!.code
  const varName = generateMeaningfulVarName(record.element!.fingerprint)

  return {
    code: `  const ${varName} = ${locatorCode};\n  await expect(${varName}).toHaveCount(1);\n  await expect(${varName}).toBeVisible();`,
  }
}

/**
 * Generate code for 'wait' action.
 */
function generateWaitCode(record: ActionRecord): CodeResult {
  const seconds = record.toolInput?.seconds as number | undefined
  if (typeof seconds !== 'number' || seconds < 0) {
    return { code: '', error: 'Wait missing valid seconds in IR' }
  }
  // Convert to milliseconds for Playwright
  const ms = Math.round(seconds * 1000)
  return { code: `  await page.waitForTimeout(${ms});` }
}

/**
 * Generate code for a single IR record.
 */
function generateCodeForRecord(
  record: ActionRecord,
  baseUrl: string,
  loginBaseUrl: string | undefined,
  stepVarInfo?: StepVarInfo,
): CodeResult {
  // Dispatch based on toolName (single source of truth)
  switch (record.toolName) {
    case 'navigate':
      return generateNavigateCode(record, baseUrl, loginBaseUrl, stepVarInfo)

    case 'click':
      return generateClickCode(record)

    case 'fill':
      return generateFillCode(record, stepVarInfo)

    case 'select_option':
      return generateSelectCode(record)

    case 'assertTextPresent':
      return generateAssertTextCode(record, stepVarInfo)

    case 'assertElementVisible':
      return generateAssertElementCode(record)

    case 'scroll':
      // Scroll doesn't generate test code (runtime only)
      return { code: '' }

    case 'wait':
      return generateWaitCode(record)

    default:
      return {
        code: `  // TODO: Step ${record.stepIndex ?? '?'} - Unsupported tool: ${String(record.toolName)}`,
      }
  }
}

/**
 * Extract variable name from a const declaration.
 * Returns the variable name if found, null otherwise.
 * Pattern: `const varName = ...`
 */
function extractVarNameFromDeclaration(code: string): string | null {
  // Match patterns like: "  const varName = locator" or "const varName=locator"
  const match = code.match(/const\s+([a-zA-Z_$][0-9a-zA-Z_$]*)\s*=/)
  return match?.[1] ?? null
}

/**
 * Deduplicate variable names in generated code by adding numeric suffixes.
 * Suffixes start from 2 (first instance has no suffix, second gets '2', etc.)
 */
function deduplicateVarNames(
  codes: string[],
  usedNames: Set<string>,
): string[] {
  const dedupedCodes: string[] = []

  for (const code of codes) {
    if (!code) {
      dedupedCodes.push(code)
      continue
    }

    const varName = extractVarNameFromDeclaration(code)
    if (!varName) {
      // No variable declaration in this code block
      dedupedCodes.push(code)
      continue
    }

    let finalName = varName
    // Start suffix from 2 (first is 'varName', second is 'varName2', third is 'varName3', etc.)
    let suffix = 2
    while (usedNames.has(finalName)) {
      finalName = `${varName}${suffix++}`
    }

    usedNames.add(finalName)

    if (finalName !== varName) {
      // Replace all occurrences of the original variable name
      const escapedVarName = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const regex = new RegExp(`\\b${escapedVarName}\\b`, 'g')
      dedupedCodes.push(code.replace(regex, finalName))
    } else {
      dedupedCodes.push(code)
    }
  }

  return dedupedCodes
}

/**
 * Generate code for a single step based on IR toolName.
 * A single step may have multiple IR records (e.g., wait + assertions).
 */
function generateStepCode(
  step: MarkdownSpecStep,
  records: ActionRecord[],
  baseUrl: string,
  loginBaseUrl: string | undefined,
  stepVarInfo?: StepVarInfo,
  globalUsedNames?: Set<string>,
): CodeResult {
  // Find ALL IR records for this stepIndex (a step may have multiple actions)
  const stepRecords = records.filter((r) => r.stepIndex === step.index && r.outcome.ok)
  if (stepRecords.length === 0) {
    return {
      code: `  // TODO: Step ${step.index} - No IR record found for: ${escapeString(step.text)}`,
    }
  }

  // Generate code for each IR record and combine
  const codes: string[] = []
  const errors: string[] = []
  let needs: StepNeeds | undefined
  // Use global names if provided, otherwise create local set
  const usedNames = globalUsedNames ?? new Set<string>()

  for (const record of stepRecords) {
    const result = generateCodeForRecord(record, baseUrl, loginBaseUrl, stepVarInfo)
    codes.push(result.code)
    if (result.error) errors.push(result.error)
    if (result.needs) {
      needs = needs || { envVars: undefined, loginBaseUrl: false }
      if (result.needs.envVars) {
        needs.envVars = needs.envVars || new Set<string>()
        result.needs.envVars.forEach((v) => needs.envVars!.add(v))
      }
      if (result.needs.loginBaseUrl) needs.loginBaseUrl = true
    }
  }

  // Deduplicate variable names within the step
  const dedupedCodes = deduplicateVarNames(codes, usedNames)

  return {
    code: dedupedCodes.filter((c) => c).join('\n'),
    error: errors.length > 0 ? errors.join('; ') : undefined,
    needs,
  }
}

/**
 * Generate environment variable declarations.
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

  // Track variable names across all steps for global deduplication
  const globallyUsedNames = new Set<string>()

  // Parse raw spec to get variable mappings per step
  const { stepVars } = rawSpecContent ? parseRawSpecVars(rawSpecContent) : { stepVars: new Map() }

  for (const step of spec.steps) {
    const stepVarInfo = stepVars.get(step.index)
    const { code, error, needs } = generateStepCode(step, records, baseUrl, loginBaseUrl, stepVarInfo, globallyUsedNames)

    if (error) {
      errors.push(error)
    }
    if (needs?.envVars) {
      needs.envVars.forEach((v) => allEnvVars.add(v))
    }
    if (needs?.loginBaseUrl) {
      needsLoginBaseUrl = true
    }
    if (code) {
      stepCodes.push(`  // Step ${step.index}: ${escapeString(step.text)}`)
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
 * Export a Playwright test file from IR.
 */
export async function exportFromIR(options: ExportOptions): Promise<ExportResult> {
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
  const missingLocatorActions = records.filter((r) => {
    if (!r.outcome.ok) return false
    if (r.toolName === 'click' || r.toolName === 'fill' || r.toolName === 'select_option' || r.toolName === 'assertElementVisible') {
      return !hasValidChosenLocator(r)
    }
    return false
  })

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
  const { content, errors } = generateTestFileContent(
    specPath,
    spec,
    records,
    baseUrl,
    loginBaseUrl,
    rawSpecContent,
    exportDir,
    cwd,
  )

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

    const missingLocatorActions = records.filter((r) => {
      if (!r.outcome.ok) return false
      if (r.toolName === 'click' || r.toolName === 'fill' || r.toolName === 'select_option' || r.toolName === 'assertElementVisible') {
        return !hasValidChosenLocator(r)
      }
      return false
    })

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

// Export helper functions for testing
export { toCamelCase, generateMeaningfulVarName, sanitizeVariableName }
