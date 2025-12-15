import type { Page } from 'playwright'

import type { ToolResult, ToolScreenshot } from '../tools/tool-result.js'
import { captureJpegScreenshot, writeRunScreenshot, type WriteScreenshotOptions } from '../browser/screenshot.js'

export type ImageContentBlock = {
  type: 'image'
  source: {
    type: 'base64'
    media_type: 'image/jpeg'
    data: string
  }
}

export type TextContentBlock = {
  type: 'text'
  text: string
}

export type ContentBlock = ImageContentBlock | TextContentBlock

export type PreActionScreenshotMeta = {
  captured: boolean
  error?: string
  screenshot?: ToolScreenshot
  imageBlock?: ImageContentBlock
}

export type RunWithPreActionScreenshotOptions<TData> = {
  page: Page
  runId: string
  debug: boolean
  cwd?: string
  fileBaseName: string
  action: () => Promise<ToolResult<TData>>
  quality?: number
  writeScreenshot?: (options: WriteScreenshotOptions) => Promise<string>
}

function attachScreenshot<TData>(result: ToolResult<TData>, screenshot: ToolScreenshot | undefined): ToolResult<TData> {
  if (!screenshot) return result
  return result.ok
    ? { ok: true, data: result.data, screenshot }
    : { ok: false, error: result.error, screenshot }
}

export async function runWithPreActionScreenshot<TData>(
  options: RunWithPreActionScreenshotOptions<TData>,
): Promise<{ result: ToolResult<TData>; meta: PreActionScreenshotMeta }> {
  const capture = await captureJpegScreenshot(options.page, { quality: options.quality })

  let screenshot: ToolScreenshot | undefined
  let imageBlock: ImageContentBlock | undefined
  let error: string | undefined

  if (capture.ok) {
    const base64 = capture.value.buffer.toString('base64')
    imageBlock = {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: base64,
      },
    }

    screenshot = {
      mimeType: capture.value.mimeType,
      width: capture.value.width,
      height: capture.value.height,
    }
  } else {
    error = capture.message
  }

  const toolResult = await options.action()

  const shouldWrite = Boolean(capture.ok && (options.debug || !toolResult.ok))

  if (shouldWrite && capture.ok) {
    const writeFn = options.writeScreenshot ?? writeRunScreenshot
    try {
      const path = await writeFn({
        cwd: options.cwd,
        runId: options.runId,
        fileBaseName: options.fileBaseName,
        buffer: capture.value.buffer,
      })
      screenshot = screenshot ? { ...screenshot, path } : { mimeType: 'image/jpeg', path }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      error = error ? `${error}; Failed to write screenshot: ${msg}` : `Failed to write screenshot: ${msg}`
    }
  }

  return {
    result: attachScreenshot(toolResult, screenshot),
    meta: {
      captured: capture.ok,
      error,
      screenshot,
      imageBlock,
    },
  }
}
