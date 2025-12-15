import { describe, expect, it, vi } from 'vitest'

import type { MarkdownSpec } from '../../src/markdown/spec-types.js'

const dummySpec: MarkdownSpec = {
  preconditions: ['ready'],
  steps: [{ index: 1, text: 'Navigate to /', kind: 'action' }],
}

describe('runner/runSpecs (browser/context/page lifecycle)', () => {
  it('creates a single Browser per run and a new Context/Page per spec (and closes them)', async () => {
    vi.resetModules()

    const pages: Array<{ close: ReturnType<typeof vi.fn> }> = []
    const contexts: Array<{ close: ReturnType<typeof vi.fn> }> = []

    const browser = {
      version: vi.fn(() => 'chromium-mock'),
      newContext: vi.fn(async (_contextOptions?: any) => {
        const page = { close: vi.fn(async () => {}) }
        const context = {
          newPage: vi.fn(async () => page),
          close: vi.fn(async () => {}),
        }

        pages.push(page)
        contexts.push(context)
        return context
      }),
      close: vi.fn(async () => {}),
    }

    const createBrowserMock = vi.fn(async () => browser)

    vi.doMock('../../src/browser/create-browser.js', () => ({
      createBrowser: createBrowserMock,
    }))

    const { runSpecs } = await import('../../src/runner/run-specs.js')

    const onSpec = vi.fn(async () => {})

    const result = await runSpecs({
      runId: 'run-1',
      baseUrl: 'http://example.test',
      headless: true,
      debug: false,
      specs: [
        { specPath: '/specs/a.md', spec: dummySpec },
        { specPath: '/specs/b.md', spec: dummySpec },
      ],
      onSpec,
    })

    expect(result.ok).toBe(true)

    expect(createBrowserMock).toHaveBeenCalledTimes(1)

    expect(browser.newContext).toHaveBeenCalledTimes(2)
    const newContextCalls = (browser.newContext as any).mock.calls as any[]
    for (const call of newContextCalls) {
      expect(call[0]).toMatchObject({
        viewport: {
          width: 1024,
          height: 768,
        },
      })
    }
    expect(contexts).toHaveLength(2)
    expect(contexts[0]).not.toBe(contexts[1])

    expect(pages).toHaveLength(2)
    expect(pages[0]).not.toBe(pages[1])

    expect(onSpec).toHaveBeenCalledTimes(2)

    expect(pages[0]?.close).toHaveBeenCalledTimes(1)
    expect(pages[1]?.close).toHaveBeenCalledTimes(1)

    expect(contexts[0]?.close).toHaveBeenCalledTimes(1)
    expect(contexts[1]?.close).toHaveBeenCalledTimes(1)

    expect(browser.close).toHaveBeenCalledTimes(1)
  })

  it('still closes Context and Browser when a spec fails', async () => {
    vi.resetModules()

    const pageClose = vi.fn(async () => {})
    const ctxClose = vi.fn(async () => {})

    const context = {
      newPage: vi.fn(async () => ({ close: pageClose })),
      close: ctxClose,
    }

    const browser = {
      version: vi.fn(() => 'chromium-mock'),
      newContext: vi.fn(async (_contextOptions?: any) => context),
      close: vi.fn(async () => {}),
    }

    const createBrowserMock = vi.fn(async () => browser)

    vi.doMock('../../src/browser/create-browser.js', () => ({
      createBrowser: createBrowserMock,
    }))

    const { runSpecs } = await import('../../src/runner/run-specs.js')

    const onSpec = vi.fn(async () => {
      throw Object.assign(new Error('boom'), { code: 'EFAIL' })
    })

    const result = await runSpecs({
      runId: 'run-2',
      baseUrl: 'http://example.test',
      headless: true,
      debug: false,
      specs: [{ specPath: '/specs/fail.md', spec: dummySpec }],
      onSpec,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('/specs/fail.md')
    }

    expect(pageClose).toHaveBeenCalledTimes(1)
    expect(ctxClose).toHaveBeenCalledTimes(1)
    expect(browser.close).toHaveBeenCalledTimes(1)
  })

  it('passes slowMo when debug=true', async () => {
    vi.resetModules()

    const browser = {
      version: vi.fn(() => 'chromium-mock'),
      newContext: vi.fn(async (_contextOptions?: any) => ({
        newPage: vi.fn(async () => ({ close: vi.fn(async () => {}) })),
        close: vi.fn(async () => {}),
      })),
      close: vi.fn(async () => {}),
    }

    const createBrowserMock = vi.fn(async (_options: any) => browser)

    vi.doMock('../../src/browser/create-browser.js', () => ({
      createBrowser: createBrowserMock,
    }))

    const { runSpecs } = await import('../../src/runner/run-specs.js')

    const result = await runSpecs({
      runId: 'run-3',
      baseUrl: 'http://example.test',
      headless: false,
      debug: true,
      specs: [{ specPath: '/specs/a.md', spec: dummySpec }],
      onSpec: vi.fn(async () => {}),
    })

    expect(result.ok).toBe(true)
    expect(createBrowserMock).toHaveBeenCalledTimes(1)
    expect(createBrowserMock.mock.calls[0]?.[0]).toMatchObject({
      slowMo: 75,
    })
  })
})
