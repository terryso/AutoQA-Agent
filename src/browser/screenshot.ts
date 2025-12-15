import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { Page } from 'playwright'

export type ScreenshotCapture = {
  buffer: Buffer
  mimeType: 'image/jpeg'
  width?: number
  height?: number
}

export type ScreenshotCaptureResult =
  | { ok: true; value: ScreenshotCapture }
  | { ok: false; message: string; cause?: unknown }

export type CaptureScreenshotOptions = {
  quality?: number
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error && typeof err.message === 'string') return err.message
  if (typeof err === 'string') return err
  return String(err)
}

export async function captureJpegScreenshot(
  page: Page,
  options: CaptureScreenshotOptions = {},
): Promise<ScreenshotCaptureResult> {
  const quality = typeof options.quality === 'number' && Number.isFinite(options.quality)
    ? Math.max(1, Math.min(100, Math.round(options.quality)))
    : 60

  try {
    const buffer = (await page.screenshot({ type: 'jpeg', quality })) as Buffer
    const viewport = typeof page.viewportSize === 'function' ? page.viewportSize() : null

    return {
      ok: true,
      value: {
        buffer,
        mimeType: 'image/jpeg',
        width: viewport?.width,
        height: viewport?.height,
      },
    }
  } catch (err: unknown) {
    return { ok: false, message: `Failed to capture screenshot: ${toErrorMessage(err)}`, cause: err }
  }
}

export type WriteScreenshotOptions = {
  cwd?: string
  runId: string
  fileBaseName: string
  buffer: Buffer
}

function sanitizePathSegment(value: string): string {
  const cleaned = (value ?? '').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
  if (cleaned === '.' || cleaned === '..') return 'unknown'
  return cleaned.length > 0 ? cleaned : 'unknown'
}

export async function writeRunScreenshot(options: WriteScreenshotOptions): Promise<string> {
  const cwd = options.cwd ?? process.cwd()
  const runId = sanitizePathSegment(options.runId)
  const fileBaseName = sanitizePathSegment(options.fileBaseName)

  const dir = resolve(cwd, '.autoqa', 'runs', runId, 'screenshots')
  await mkdir(dir, { recursive: true })

  const fileName = `${fileBaseName}.jpg`
  const absPath = resolve(dir, fileName)

  await writeFile(absPath, options.buffer, { mode: 0o600 })

  return `.autoqa/runs/${runId}/screenshots/${fileName}`
}
