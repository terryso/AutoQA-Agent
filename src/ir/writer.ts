/**
 * IR Writer
 *
 * Handles writing ActionRecords to JSONL files with path safety.
 */

import { mkdir, appendFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'

import { redactToolInput, truncateString } from '../logging/index.js'

import type { ActionRecord } from './types.js'

const IR_FILENAME = 'ir.jsonl'

/**
 * Sanitize a path segment to prevent directory traversal.
 * Removes or replaces dangerous characters.
 */
export function sanitizePathSegment(segment: string): string {
  if (!segment || typeof segment !== 'string') {
    return 'unknown'
  }

  let safe = segment
    .replace(/\.\./g, '')
    .replace(/[<>:"|?*\x00-\x1f]/g, '')
    .replace(/^\.+/, '')
    .replace(/\/+/g, '_')
    .replace(/\\+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+/, '')
    .trim()

  if (!safe || safe === '.' || safe === '..') {
    safe = 'unknown'
  }

  if (safe.length > 200) {
    safe = safe.slice(0, 200)
  }

  return safe
}

/**
 * Build the IR file path for a given run.
 * Always returns a path under .autoqa/runs/<runId>/
 */
export function buildIRPath(cwd: string, runId: string): string {
  const safeRunId = sanitizePathSegment(runId)
  return join(cwd, '.autoqa', 'runs', safeRunId, IR_FILENAME)
}

/**
 * Convert an absolute path to a safe relative path for output.
 * Never exposes absolute paths in logs or errors.
 */
export function toSafeRelativePath(absolutePath: string, cwd: string): string {
  const cwdNormalized = cwd.endsWith('/') ? cwd : cwd + '/'

  if (absolutePath.startsWith(cwdNormalized)) {
    return absolutePath.slice(cwdNormalized.length)
  }

  if (absolutePath.startsWith(cwd)) {
    return absolutePath.slice(cwd.length + 1)
  }

  const match = absolutePath.match(/\.autoqa\/runs\/[^/]+\/.*$/)
  if (match) {
    return match[0]
  }

  return '.autoqa/runs/[redacted]/ir.jsonl'
}

/**
 * Redact sensitive data from tool input before writing to IR.
 * For fill actions, preserves fillValue (structured) and removes raw text.
 */
export function redactToolInputForIR(toolName: string, input: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  // For fill actions, handle fillValue specially
  if (toolName === 'fill') {
    for (const [key, value] of Object.entries(input)) {
      // Preserve fillValue as-is (it's already structured and safe)
      if (key === 'fillValue') {
        result[key] = value
        continue
      }
      // Skip raw text - we use fillValue instead
      if (key === 'text') {
        result.textLength = typeof value === 'string' ? value.length : 0
        continue
      }
      // Truncate other string values
      if (typeof value === 'string') {
        result[key] = truncateString(value, 200)
        continue
      }
      result[key] = value
    }
    return result
  }

  // For assertion tools, preserve input as-is
  if (toolName === 'assertTextPresent' || toolName === 'assertElementVisible') {
    for (const [key, value] of Object.entries(input)) {
      if (typeof value === 'string') {
        result[key] = truncateString(value, 200)
        continue
      }
      result[key] = value
    }
    return result
  }

  // For other tools, use standard redaction
  const base = redactToolInput(toolName, input)
  for (const [key, value] of Object.entries(base)) {
    if (typeof value === 'string') {
      result[key] = truncateString(value, 200)
      continue
    }
    result[key] = value
  }

  return result
}

/**
 * IR Writer class for appending action records to a JSONL file.
 */
export class IRWriter {
  private readonly irPath: string
  private readonly cwd: string
  private initialized = false

  constructor(cwd: string, runId: string) {
    this.cwd = cwd
    this.irPath = buildIRPath(cwd, runId)
  }

  /**
   * Get the relative path to the IR file (safe for logging).
   */
  getRelativePath(): string {
    return toSafeRelativePath(this.irPath, this.cwd)
  }

  /**
   * Ensure the directory exists.
   */
  private async ensureDir(): Promise<void> {
    if (this.initialized) return

    const dir = dirname(this.irPath)
    await mkdir(dir, { recursive: true })
    this.initialized = true
  }

  /**
   * Write an action record to the IR file.
   * Each record is written as a single JSON line.
   */
  async write(record: ActionRecord): Promise<void> {
    await this.ensureDir()

    const line = JSON.stringify(record) + '\n'
    await appendFile(this.irPath, line, 'utf-8')
  }

  /**
   * Write multiple action records.
   */
  async writeAll(records: ActionRecord[]): Promise<void> {
    for (const record of records) {
      await this.write(record)
    }
  }
}

/**
 * Create an IR writer for a run.
 */
export function createIRWriter(cwd: string, runId: string): IRWriter {
  return new IRWriter(cwd, runId)
}
