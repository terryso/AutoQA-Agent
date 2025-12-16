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
  'button',
  'link',
  'element',
  'item',
])

function normalizeForNameMatch(value: string): string {
  const tokens = value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !STOP_WORDS.has(t))
  return tokens.join(' ')
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

export type ClickInput = {
  page: Page
  targetDescription: string
}

export type ClickData = {
  targetDescription: string
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

async function resolveClickTarget(page: Page, targetDescription: string): Promise<Locator | undefined> {
  const candidates: Locator[] = []

  try {
    candidates.push(page.getByRole('button', { name: targetDescription }))
  } catch {}

  try {
    candidates.push(page.getByRole('link', { name: targetDescription }))
  } catch {}

  try {
    candidates.push(page.getByText(targetDescription))
  } catch {}

  const fuzzy = buildFuzzyRegex(targetDescription)
  if (fuzzy) {
    try {
      candidates.push(page.getByRole('button', { name: fuzzy }))
    } catch {}

    try {
      candidates.push(page.getByRole('link', { name: fuzzy }))
    } catch {}

    try {
      candidates.push(page.getByText(fuzzy))
    } catch {}
  }

  for (const candidate of candidates) {
    const picked = await pickFirstMatch(candidate)
    if (picked) return picked
  }

  return undefined
}

export async function click(input: ClickInput): Promise<ToolResult<ClickData>> {
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

  const locator = await resolveClickTarget(page, targetDescription)
  if (!locator) {
    return fail({
      code: 'ELEMENT_NOT_FOUND',
      message: `Element not found: ${targetDescription}`,
      retriable: true,
      cause: undefined,
    })
  }

  try {
    await locator.click()
    return ok({ targetDescription })
  } catch (err: unknown) {
    const toolError = toToolError(err)
    return fail(toolError)
  }
}
