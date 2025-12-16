import type { Locator, Page } from 'playwright'

import type { ToolResult } from './tool-result.js'
import { fail, ok } from './tool-result.js'
import { toToolError } from './playwright-error.js'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'with',
  'for',
  'to',
  'in',
  'on',
  'of',
  'and',
  'or',
  'input',
  'field',
  'textbox',
  'text',
  'box',
  'element',
  'form',
  'id',
  'name',
  'placeholder',
  'data',
  'test',
])

function extractQuotedPhrases(value: string): string[] {
  const out: string[] = []
  const re = /"([^"]+)"|'([^']+)'/g
  for (const match of value.matchAll(re)) {
    const v = (match[1] ?? match[2] ?? '').trim()
    if (v) out.push(v)
  }
  return out
}

function normalizeForNameMatch(value: string): string {
  const tokens = value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !STOP_WORDS.has(t))
  return tokens.join(' ')
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    const k = v.trim()
    if (!k) continue
    if (seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  return out
}

function extractAttributeSelectors(targetDescription: string): string[] {
  const selectors: string[] = []

  const idMatch = targetDescription.match(/\bid\b\s*(?:[:=]|is)?\s*["']?([a-zA-Z0-9_-]+)["']?/i)
  if (idMatch?.[1]) selectors.push(`#${idMatch[1]}`)

  const dataTestMatch = targetDescription.match(/\bdata-test\b\s*=\s*["']?([^"'\s]+)["']?/i)
  if (dataTestMatch?.[1]) selectors.push(`[data-test="${dataTestMatch[1]}"]`)

  const nameMatch = targetDescription.match(/\bname\b\s*=\s*["']?([^"'\s]+)["']?/i)
  if (nameMatch?.[1]) selectors.push(`[name="${nameMatch[1]}"]`)

  return selectors
}

function buildNameCandidates(targetDescription: string): string[] {
  const raw = targetDescription.trim()
  const quoted = extractQuotedPhrases(raw)
  const normalized = normalizeForNameMatch(raw)
  const variants = uniqueStrings([raw, ...quoted, normalized])
  return variants
}

export type FillInput = {
  page: Page
  targetDescription: string
  text: string
}

export type FillData = {
  targetDescription: string
  textLength: number
}

async function pickFirstMatch(locator: Locator): Promise<Locator | undefined> {
  try {
    const count = await locator.count()
    if (count <= 0) return undefined

    const limit = Math.min(count, 5)
    for (let i = 0; i < limit; i++) {
      const candidate = locator.nth(i)
      try {
        if (await candidate.isVisible()) return candidate
      } catch {}
    }

    return locator.first()
  } catch {
    return undefined
  }
}

function buildFuzzyRegex(value: string): RegExp | undefined {
  const normalized = normalizeForNameMatch(value)
  if (!normalized) return undefined
  const tokens = normalized.split(/\s+/g).filter((t) => t.length > 0)
  if (tokens.length <= 0) return undefined
  if (tokens.length === 1) return new RegExp(escapeRegExp(tokens[0]!), 'i')
  const lookaheads = tokens.map((t) => `(?=.*${escapeRegExp(t)})`).join('')
  return new RegExp(`${lookaheads}.*`, 'i')
}

async function resolveFillTarget(page: Page, targetDescription: string): Promise<Locator | undefined> {
  const candidates: Locator[] = []

  for (const selector of extractAttributeSelectors(targetDescription)) {
    try {
      candidates.push(page.locator(selector))
    } catch {}
  }

  const nameCandidates = buildNameCandidates(targetDescription)

  for (const name of nameCandidates) {
    try {
      candidates.push(page.getByLabel(name))
    } catch {}

    try {
      candidates.push(page.getByPlaceholder(name))
    } catch {}

    try {
      candidates.push(page.getByRole('textbox', { name }))
    } catch {}
  }

  const fuzzy = buildFuzzyRegex(targetDescription)
  if (fuzzy) {
    try {
      candidates.push(page.getByLabel(fuzzy))
    } catch {}

    try {
      candidates.push(page.getByPlaceholder(fuzzy))
    } catch {}

    try {
      candidates.push(page.getByRole('textbox', { name: fuzzy }))
    } catch {}
  }

  try {
    candidates.push(page.getByLabel(targetDescription))
  } catch {}

  try {
    candidates.push(page.getByPlaceholder(targetDescription))
  } catch {}

  try {
    candidates.push(page.getByRole('textbox', { name: targetDescription }))
  } catch {}

  try {
    candidates.push(page.getByText(targetDescription))
  } catch {}

  for (const candidate of candidates) {
    const picked = await pickFirstMatch(candidate)
    if (picked) return picked
  }

  return undefined
}

export async function fill(input: FillInput): Promise<ToolResult<FillData>> {
  const anyInput = input as any
  if (!anyInput || typeof anyInput !== 'object') {
    return fail({
      code: 'INVALID_INPUT',
      message: 'input must be an object',
      retriable: false,
      cause: undefined,
    })
  }

  const page = anyInput.page as Page | undefined
  if (!page) {
    return fail({
      code: 'INVALID_INPUT',
      message: 'page is required',
      retriable: false,
      cause: undefined,
    })
  }

  const targetDescription = typeof anyInput.targetDescription === 'string' ? anyInput.targetDescription.trim() : ''
  if (!targetDescription) {
    return fail({
      code: 'INVALID_INPUT',
      message: 'targetDescription is required',
      retriable: false,
      cause: undefined,
    })
  }

  if (typeof anyInput.text !== 'string') {
    return fail({
      code: 'INVALID_INPUT',
      message: 'text must be a string',
      retriable: false,
      cause: undefined,
    })
  }

  const locator = await resolveFillTarget(page, targetDescription)
  if (!locator) {
    return fail({
      code: 'ELEMENT_NOT_FOUND',
      message: `Element not found: ${targetDescription}`,
      retriable: true,
      cause: undefined,
    })
  }

  try {
    await locator.fill(anyInput.text)
    return ok({ targetDescription, textLength: anyInput.text.length })
  } catch (err: unknown) {
    try {
      const descendant = locator.locator('input, textarea, [contenteditable="true"]').first()
      const count = await descendant.count()
      if (count > 0) {
        await descendant.fill(anyInput.text)
        return ok({ targetDescription, textLength: anyInput.text.length })
      }
    } catch {}

    const toolError = toToolError(err)
    return fail(toolError)
  }
}
