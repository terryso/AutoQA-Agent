import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout } from 'node:timers'

import type { Page } from 'playwright'

export type AriaSnapshotResult = {
  ok: true
  yaml: string
} | {
  ok: false
  error: string
}

export type AxSnapshotResult = {
  ok: true
  json: Record<string, unknown> | null
} | {
  ok: false
  error: string
}

export type SnapshotCaptureResult = {
  aria: AriaSnapshotResult
  ax: AxSnapshotResult
}

export type CaptureSnapshotOptions = {
  timeout?: number
}

const DEFAULT_SNAPSHOT_TIMEOUT = 5000

function toErrorMessage(err: unknown): string {
  if (err instanceof Error && typeof err.message === 'string') return err.message
  if (typeof err === 'string') return err
  return String(err)
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!(typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0)) return promise
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout after ${timeoutMs}ms`))
    }, timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

export async function captureAriaSnapshot(
  page: Page,
  options: CaptureSnapshotOptions = {},
): Promise<AriaSnapshotResult> {
  const timeout = options.timeout ?? DEFAULT_SNAPSHOT_TIMEOUT

  try {
    const yaml = await page.locator('body').ariaSnapshot({ timeout })
    return { ok: true, yaml }
  } catch (err: unknown) {
    return { ok: false, error: `Failed to capture ARIA snapshot: ${toErrorMessage(err)}` }
  }
}

export async function captureAxSnapshot(
  page: Page,
  options: CaptureSnapshotOptions = {},
): Promise<AxSnapshotResult> {
  const timeout = options.timeout ?? DEFAULT_SNAPSHOT_TIMEOUT

  try {
    const snapshot = await withTimeout((page as any)._snapshotForAI({ timeout }), timeout)
    return { ok: true, json: snapshot as Record<string, unknown> | null }
  } catch (err: unknown) {
  }

  try {
    const accessibility = (page as any)?.accessibility
    if (accessibility && typeof accessibility.snapshot === 'function') {
      const snapshot = await withTimeout(accessibility.snapshot(), timeout)
      return { ok: true, json: snapshot as Record<string, unknown> | null }
    }
  } catch (err: unknown) {
  }

  return { ok: false, error: `Failed to capture AX snapshot: ${toErrorMessage(new Error('No supported AX snapshot method available'))}` }
}

export async function captureSnapshots(
  page: Page,
  options: CaptureSnapshotOptions = {},
): Promise<SnapshotCaptureResult> {
  const [aria, ax] = await Promise.all([
    captureAriaSnapshot(page, options),
    captureAxSnapshot(page, options),
  ])
  return { aria, ax }
}

export type WriteSnapshotOptions = {
  cwd?: string
  runId: string
  fileBaseName: string
}

export type WriteSnapshotResult = {
  ariaPath?: string
  axPath?: string
  ariaError?: string
  axError?: string
}

function sanitizePathSegment(value: string): string {
  const cleaned = (value ?? '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
  if (cleaned === '.' || cleaned === '..') return 'unknown'
  return cleaned.length > 0 ? cleaned : 'unknown'
}

export async function writeSnapshots(
  capture: SnapshotCaptureResult,
  options: WriteSnapshotOptions,
): Promise<WriteSnapshotResult> {
  const cwd = options.cwd ?? process.cwd()
  const runId = sanitizePathSegment(options.runId)
  const fileBaseName = sanitizePathSegment(options.fileBaseName)

  const dir = resolve(cwd, '.autoqa', 'runs', runId, 'snapshots')
  const result: WriteSnapshotResult = {}

  try {
    await mkdir(dir, { recursive: true })
  } catch (err: unknown) {
    const msg = toErrorMessage(err)
    result.ariaError = `Failed to create snapshot directory: ${msg}`
    result.axError = `Failed to create snapshot directory: ${msg}`
    return result
  }

  const relativeDir = `.autoqa/runs/${runId}/snapshots`

  if (capture.aria.ok) {
    const ariaFileName = `${fileBaseName}.aria.yaml`
    const ariaAbsPath = resolve(dir, ariaFileName)
    try {
      await writeFile(ariaAbsPath, capture.aria.yaml, { encoding: 'utf-8', mode: 0o600 })
      result.ariaPath = `${relativeDir}/${ariaFileName}`
    } catch (err: unknown) {
      result.ariaError = `Failed to write ARIA snapshot: ${toErrorMessage(err)}`
    }
  } else {
    result.ariaError = capture.aria.error
  }

  if (capture.ax.ok) {
    const axFileName = `${fileBaseName}.ax.json`
    const axAbsPath = resolve(dir, axFileName)
    try {
      const jsonContent = JSON.stringify(capture.ax.json, null, 2)
      await writeFile(axAbsPath, jsonContent, { encoding: 'utf-8', mode: 0o600 })
      result.axPath = `${relativeDir}/${axFileName}`
    } catch (err: unknown) {
      result.axError = `Failed to write AX snapshot: ${toErrorMessage(err)}`
    }
  } else {
    result.axError = capture.ax.error
  }

  return result
}

export type SnapshotMeta = {
  captured: boolean
  ariaPath?: string
  axPath?: string
  error?: string
}

export type RunWithSnapshotOptions = {
  page: Page
  runId: string
  debug: boolean
  cwd?: string
  fileBaseName: string
  timeout?: number
}

export async function writeSnapshotsIfNeeded(
  capture: SnapshotCaptureResult,
  options: WriteSnapshotOptions,
  shouldWrite: boolean,
): Promise<SnapshotMeta> {
  const writeResult = shouldWrite ? await writeSnapshots(capture, options) : undefined

  const errors: string[] = []
  if (shouldWrite) {
    if (writeResult?.ariaError) errors.push(writeResult.ariaError)
    if (writeResult?.axError) errors.push(writeResult.axError)
  } else {
    if (!capture.aria.ok) errors.push(capture.aria.error)
    if (!capture.ax.ok) errors.push(capture.ax.error)
  }

  return {
    captured: capture.aria.ok || capture.ax.ok,
    ariaPath: writeResult?.ariaPath,
    axPath: writeResult?.axPath,
    error: errors.length > 0 ? errors.join('; ') : undefined,
  }
}

export async function captureAndWriteSnapshots(
  options: RunWithSnapshotOptions,
): Promise<SnapshotMeta> {
  const capture = await captureSnapshots(options.page, { timeout: options.timeout })

  return writeSnapshotsIfNeeded(
    capture,
    {
      cwd: options.cwd,
      runId: options.runId,
      fileBaseName: options.fileBaseName,
    },
    options.debug,
  )
}
