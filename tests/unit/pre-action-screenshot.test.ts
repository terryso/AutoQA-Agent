import { describe, expect, it, vi } from 'vitest'

import { runWithPreActionScreenshot } from '../../src/agent/pre-action-screenshot.js'
import type { ToolResult } from '../../src/tools/tool-result.js'

describe('pre-action screenshot', () => {
  it('captures jpeg screenshot before tool action and injects image block + ToolResult.screenshot', async () => {
    const buffer = Buffer.from('jpeg-bytes')

    const page: any = {
      screenshot: vi.fn(async (_opts: any) => buffer),
      viewportSize: vi.fn(() => ({ width: 1024, height: 768 })),
    }

    const action = vi.fn(async () => ({ ok: true as const, data: { ok: 1 } }))

    const out = await runWithPreActionScreenshot({
      page,
      runId: 'run-1',
      debug: false,
      fileBaseName: 'navigate-1',
      quality: 55,
      action,
    })

    expect(page.screenshot).toHaveBeenCalledTimes(1)
    expect(page.screenshot.mock.calls[0]?.[0]).toMatchObject({ type: 'jpeg', quality: 55 })

    expect(action).toHaveBeenCalledTimes(1)
    expect(page.screenshot.mock.invocationCallOrder[0]).toBeLessThan(action.mock.invocationCallOrder[0])

    expect(out.meta.captured).toBe(true)
    expect(out.meta.imageBlock).toBeDefined()
    expect(out.meta.imageBlock?.type).toBe('image')
    expect(out.meta.imageBlock?.source.type).toBe('base64')
    expect(out.meta.imageBlock?.source.media_type).toBe('image/jpeg')

    expect(out.result.ok).toBe(true)
    if (out.result.ok) {
      expect(out.result.screenshot).toMatchObject({
        mimeType: 'image/jpeg',
        width: 1024,
        height: 768,
      })
    }
  })

  it('does not throw when screenshot capture fails; tool action still runs', async () => {
    const page: any = {
      screenshot: vi.fn(async () => {
        throw new Error('boom')
      }),
      viewportSize: vi.fn(() => ({ width: 1024, height: 768 })),
    }

    const action = vi.fn(async () => ({ ok: true as const, data: { ok: 1 } }))

    const out = await runWithPreActionScreenshot({
      page,
      runId: 'run-1',
      debug: false,
      fileBaseName: 'click-1',
      action,
    })

    expect(action).toHaveBeenCalledTimes(1)

    expect(out.meta.captured).toBe(false)
    expect(out.meta.imageBlock).toBeUndefined()
    expect(out.meta.error).toContain('Failed to capture screenshot')
    expect(out.result.ok).toBe(true)
  })

  it('writes screenshot when debug=true', async () => {
    const prevMode = process.env.AUTOQA_ARTIFACTS
    process.env.AUTOQA_ARTIFACTS = 'all'
    const buffer = Buffer.from('jpeg-bytes')

    const page: any = {
      screenshot: vi.fn(async () => buffer),
      viewportSize: vi.fn(() => ({ width: 1024, height: 768 })),
    }

    const action = vi.fn(async () => ({ ok: true as const, data: { ok: 1 } }))
    const writeScreenshot = vi.fn(async () => '/tmp/screenshot.jpg')

    try {
      const out = await runWithPreActionScreenshot({
        page,
        runId: 'run-1',
        debug: true,
        fileBaseName: 'fill-1',
        action,
        writeScreenshot,
      })

      expect(writeScreenshot).toHaveBeenCalledTimes(1)
      expect(out.result.ok).toBe(true)
      if (out.result.ok) {
        expect(out.result.screenshot?.path).toBe('/tmp/screenshot.jpg')
      }
    } finally {
      if (prevMode === undefined) {
        delete process.env.AUTOQA_ARTIFACTS
      } else {
        process.env.AUTOQA_ARTIFACTS = prevMode
      }
    }
  })

  it('does not throw when screenshot write fails; tool action still returns', async () => {
    const prevMode = process.env.AUTOQA_ARTIFACTS
    process.env.AUTOQA_ARTIFACTS = 'all'
    const buffer = Buffer.from('jpeg-bytes')

    const page: any = {
      screenshot: vi.fn(async () => buffer),
      viewportSize: vi.fn(() => ({ width: 1024, height: 768 })),
    }

    const action = vi.fn(async () => ({ ok: true as const, data: { ok: 1 } }))
    const writeScreenshot = vi.fn(async () => {
      throw new Error('disk full')
    })

    try {
      const out = await runWithPreActionScreenshot({
        page,
        runId: 'run-1',
        debug: true,
        fileBaseName: 'navigate-2',
        action,
        writeScreenshot,
      })

      expect(action).toHaveBeenCalledTimes(1)
      expect(writeScreenshot).toHaveBeenCalledTimes(1)

      expect(out.meta.captured).toBe(true)
      expect(out.meta.error).toContain('Failed to write screenshot')
      expect(out.result.ok).toBe(true)
      if (out.result.ok) {
        expect(out.result.screenshot?.path).toBeUndefined()
        expect(out.result.screenshot).toMatchObject({
          mimeType: 'image/jpeg',
          width: 1024,
          height: 768,
        })
      }
    } finally {
      if (prevMode === undefined) {
        delete process.env.AUTOQA_ARTIFACTS
      } else {
        process.env.AUTOQA_ARTIFACTS = prevMode
      }
    }
  })

  it('writes screenshot when tool action fails', async () => {
    const buffer = Buffer.from('jpeg-bytes')

    const page: any = {
      screenshot: vi.fn(async () => buffer),
      viewportSize: vi.fn(() => ({ width: 1024, height: 768 })),
    }

    const action = vi.fn(async (): Promise<ToolResult<unknown>> => ({
      ok: false,
      error: { code: 'TIMEOUT', message: 'timeout', retriable: true },
    }))

    const writeScreenshot = vi.fn(async () => '/tmp/screenshot.jpg')

    const out = await runWithPreActionScreenshot({
      page,
      runId: 'run-1',
      debug: false,
      fileBaseName: 'click-2',
      action,
      writeScreenshot,
    })

    expect(writeScreenshot).toHaveBeenCalledTimes(1)
    expect(out.result.ok).toBe(false)
    if (!out.result.ok) {
      expect(out.result.screenshot?.path).toBe('/tmp/screenshot.jpg')
    }
  })
})
