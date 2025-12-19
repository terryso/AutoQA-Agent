/**
 * IR Reader
 *
 * Reads ActionRecords from JSONL files for export.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { ActionRecord } from '../ir/types.js'
import { isElementTargetingTool } from '../ir/types.js'
import { sanitizePathSegment } from './export-paths.js'

const IR_FILENAME = 'ir.jsonl'

/**
 * Build the IR file path for a given run.
 */
export function buildIRPath(cwd: string, runId: string): string {
  const safeRunId = sanitizePathSegment(runId)
  return join(cwd, '.autoqa', 'runs', safeRunId, IR_FILENAME)
}

/**
 * Read all action records from an IR file.
 */
export async function readIRFile(cwd: string, runId: string): Promise<ActionRecord[]> {
  const irPath = buildIRPath(cwd, runId)

  let content: string
  try {
    content = await readFile(irPath, 'utf-8')
  } catch (err: unknown) {
    const code = (err as any)?.code
    if (code === 'ENOENT') {
      return []
    }
    throw err
  }

  const records: ActionRecord[] = []
  const lines = content.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    try {
      const record = JSON.parse(trimmed) as ActionRecord
      records.push(record)
    } catch {
      // Skip malformed lines
    }
  }

  return records
}

/**
 * Filter action records by spec path.
 * Note: IR stores absolute specPath, so we match by ending.
 */
export function filterBySpecPath(records: ActionRecord[], specPath: string): ActionRecord[] {
  const normalize = (p: string): string => p.replace(/[\\/]+/g, '/').trim()
  const specNorm = normalize(specPath)
  const specBasename = specNorm.split('/').pop() ?? ''
  const hasPathSegments = specNorm.includes('/')

  // Exact match
  const exactMatches = records.filter((record) => normalize(record.specPath) === specNorm)
  if (exactMatches.length > 0) return exactMatches

  // Match by path ending with separator boundary (handles absolute vs relative paths)
  if (hasPathSegments) {
    const endingMatches = records.filter((record) => {
      const recordNorm = normalize(record.specPath)
      if (recordNorm === specNorm) return true
      if (recordNorm.endsWith(`/${specNorm}`)) return true
      if (specNorm.endsWith(`/${recordNorm}`)) return true
      return false
    })
    if (endingMatches.length > 0) return endingMatches
  }

  // Basename fallback only when unambiguous across distinct spec paths
  if (!specBasename) return []
  const basenameMatches = records.filter((record) => (normalize(record.specPath).split('/').pop() ?? '') === specBasename)
  const distinctSpecPaths = new Set(basenameMatches.map((r) => normalize(r.specPath)))
  if (distinctSpecPaths.size === 1) return basenameMatches
  return []
}

/**
 * Get action records for a specific spec from a run.
 */
export async function getSpecActionRecords(
  cwd: string,
  runId: string,
  specPath: string,
): Promise<ActionRecord[]> {
  const allRecords = await readIRFile(cwd, runId)
  return filterBySpecPath(allRecords, specPath)
}

/**
 * Check if an action record has a valid chosen locator for export.
 */
export function hasValidChosenLocator(record: ActionRecord): boolean {
  if (!record.element?.chosenLocator) return false
  const { code, validation } = record.element.chosenLocator
  return Boolean(code) && validation?.unique === true
}

/**
 * Check if a record can use a fallback locator (has targetDescription).
 */
export function canUseFallbackLocator(record: ActionRecord): boolean {
  const targetDesc = record.toolInput?.targetDescription as string | undefined
  return Boolean(targetDesc && targetDesc.length > 0)
}

/**
 * Get the list of element-targeting actions that are missing chosenLocator
 * and cannot use a fallback locator.
 */
export function getMissingLocatorActions(records: ActionRecord[]): ActionRecord[] {
  return records.filter((record) => {
    if (!isElementTargetingTool(record.toolName)) return false
    if (!record.outcome.ok) return false
    if (hasValidChosenLocator(record)) return false
    // Allow fallback for click actions with targetDescription
    if (record.toolName === 'click' && canUseFallbackLocator(record)) return false
    return true
  })
}
