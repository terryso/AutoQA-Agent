import { describe, expect, it, vi } from 'vitest'

import type { MarkdownSpec } from '../../src/markdown/spec-types.js'
import type { Logger } from '../../src/logging/index.js'

const logMock = vi.fn()
const mockLogger: Logger = {
  log: logMock as any,
  flush: vi.fn(async () => {}),
}

const dummySpec: MarkdownSpec = {
  preconditions: ['ready'],
  steps: [{ index: 1, text: 'Navigate to /', kind: 'action' }],
}

describe('runner/runSpecs (browser/context/page lifecycle)', () => {
  it('creates a single Browser per run and a new Context/Page per spec (and closes them)', async () => {
    vi.resetModules()
    logMock.mockClear()

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
      logger: mockLogger,
      cwd: '/tmp/test-cwd',
      onSpec,
    })

    expect(result.ok).toBe(true)

    expect(createBrowserMock).toHaveBeenCalledTimes(1)

    expect(browser.newContext).toHaveBeenCalledTimes(2)
    const newContextCalls = (browser.newContext as any).mock.calls as any[]
    for (const call of newContextCalls) {
      expect(call[0]).toMatchObject({
        viewport: {
          width: 1440,
          height: 900,
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
    logMock.mockClear()

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
      logger: mockLogger,
      cwd: '/tmp/test-cwd',
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
    logMock.mockClear()

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
      logger: mockLogger,
      cwd: '/tmp/test-cwd',
      onSpec: vi.fn(async () => {}),
    })

    expect(result.ok).toBe(true)
    expect(createBrowserMock).toHaveBeenCalledTimes(1)
    expect(createBrowserMock.mock.calls[0]?.[0]).toMatchObject({
      slowMo: 75,
    })
  })
})

describe('runner/runSpecs (trace recording)', () => {
  it('calls tracing.start once per spec and tracing.stop before context close', async () => {
    vi.resetModules()
    logMock.mockClear()

    const tracingStart = vi.fn(async () => {})
    const tracingStop = vi.fn(async () => {})
    const pageClose = vi.fn(async () => {})
    const ctxClose = vi.fn(async () => {})

    const context = {
      tracing: {
        start: tracingStart,
        stop: tracingStop,
      },
      newPage: vi.fn(async () => ({ close: pageClose })),
      close: ctxClose,
    }

    const browser = {
      version: vi.fn(() => 'chromium-mock'),
      newContext: vi.fn(async () => context),
      close: vi.fn(async () => {}),
    }

    vi.doMock('../../src/browser/create-browser.js', () => ({
      createBrowser: vi.fn(async () => browser),
    }))

    vi.doMock('../../src/runner/trace-paths.js', () => ({
      generateTraceName: vi.fn((idx: number, specPath: string) => `${idx}-spec`),
      getTracePath: vi.fn((cwd: string, runId: string, name: string) => `/tmp/${runId}/traces/${name}.zip`),
      getRelativeTracePath: vi.fn((cwd: string, runId: string, name: string) => `.autoqa/runs/${runId}/traces/${name}.zip`),
      ensureTraceDir: vi.fn(async () => {}),
    }))

    const { runSpecs } = await import('../../src/runner/run-specs.js')

    const result = await runSpecs({
      runId: 'run-trace-1',
      baseUrl: 'http://example.test',
      headless: true,
      debug: false,
      specs: [
        { specPath: '/specs/a.md', spec: dummySpec },
        { specPath: '/specs/b.md', spec: dummySpec },
      ],
      logger: mockLogger,
      cwd: '/tmp/test-cwd',
      onSpec: vi.fn(async () => {}),
    })

    expect(result.ok).toBe(true)
    expect(tracingStart).toHaveBeenCalledTimes(2)
    expect(tracingStop).toHaveBeenCalledTimes(2)

    expect(tracingStart).toHaveBeenCalledWith({ screenshots: true, snapshots: true, sources: true })

    if (result.ok) {
      expect(result.traces).toHaveLength(2)
      expect(result.traces[0]?.tracePath).toMatch(/\.autoqa\/runs\/run-trace-1\/traces\/.*\.zip$/)
    }
  })

  it('does not fail spec when tracing.start throws', async () => {
    vi.resetModules()
    logMock.mockClear()

    const tracingStart = vi.fn(async () => {
      throw new Error('tracing start failed')
    })
    const tracingStop = vi.fn(async () => {})
    const pageClose = vi.fn(async () => {})
    const ctxClose = vi.fn(async () => {})

    const context = {
      tracing: {
        start: tracingStart,
        stop: tracingStop,
      },
      newPage: vi.fn(async () => ({ close: pageClose })),
      close: ctxClose,
    }

    const browser = {
      version: vi.fn(() => 'chromium-mock'),
      newContext: vi.fn(async () => context),
      close: vi.fn(async () => {}),
    }

    vi.doMock('../../src/browser/create-browser.js', () => ({
      createBrowser: vi.fn(async () => browser),
    }))

    vi.doMock('../../src/runner/trace-paths.js', () => ({
      generateTraceName: vi.fn((idx: number) => `${idx}-spec`),
      getTracePath: vi.fn((cwd: string, runId: string, name: string) => `/tmp/${runId}/traces/${name}.zip`),
      getRelativeTracePath: vi.fn((cwd: string, runId: string, name: string) => `.autoqa/runs/${runId}/traces/${name}.zip`),
      ensureTraceDir: vi.fn(async () => {}),
    }))

    const { runSpecs } = await import('../../src/runner/run-specs.js')

    const result = await runSpecs({
      runId: 'run-trace-2',
      baseUrl: 'http://example.test',
      headless: true,
      debug: false,
      specs: [{ specPath: '/specs/a.md', spec: dummySpec }],
      logger: mockLogger,
      cwd: '/tmp/test-cwd',
      onSpec: vi.fn(async () => {}),
    })

    expect(result.ok).toBe(true)
    expect(tracingStart).toHaveBeenCalledTimes(1)
    expect(tracingStop).not.toHaveBeenCalled()
    expect(pageClose).toHaveBeenCalledTimes(1)
    expect(ctxClose).toHaveBeenCalledTimes(1)

    const finishedEvents = (logMock as any).mock.calls
      .map((c: any[]) => c[0])
      .filter((e: any) => e?.event === 'autoqa.spec.finished')
    expect(finishedEvents).toHaveLength(1)
    expect(finishedEvents[0]).not.toHaveProperty('tracePath')
  })

  it('does not fail spec when tracing.stop throws', async () => {
    vi.resetModules()
    logMock.mockClear()

    const tracingStart = vi.fn(async () => {})
    const tracingStop = vi.fn(async () => {
      const err = new Error('open /Users/alice/project/.autoqa/runs/run-trace-3/traces/000-spec.zip')
      ;(err as any).code = 'EACCES'
      throw err
    })
    const pageClose = vi.fn(async () => {})
    const ctxClose = vi.fn(async () => {})

    const context = {
      tracing: {
        start: tracingStart,
        stop: tracingStop,
      },
      newPage: vi.fn(async () => ({ close: pageClose })),
      close: ctxClose,
    }

    const browser = {
      version: vi.fn(() => 'chromium-mock'),
      newContext: vi.fn(async () => context),
      close: vi.fn(async () => {}),
    }

    vi.doMock('../../src/browser/create-browser.js', () => ({
      createBrowser: vi.fn(async () => browser),
    }))

    vi.doMock('../../src/runner/trace-paths.js', () => ({
      generateTraceName: vi.fn((idx: number) => `${idx}-spec`),
      getTracePath: vi.fn((cwd: string, runId: string, name: string) => `/tmp/${runId}/traces/${name}.zip`),
      getRelativeTracePath: vi.fn((cwd: string, runId: string, name: string) => `.autoqa/runs/${runId}/traces/${name}.zip`),
      ensureTraceDir: vi.fn(async () => {}),
    }))

    const { runSpecs } = await import('../../src/runner/run-specs.js')

    const result = await runSpecs({
      runId: 'run-trace-3',
      baseUrl: 'http://example.test',
      headless: true,
      debug: false,
      specs: [{ specPath: '/specs/a.md', spec: dummySpec }],
      logger: mockLogger,
      cwd: '/tmp/test-cwd',
      onSpec: vi.fn(async () => {}),
    })

    expect(result.ok).toBe(true)
    expect(tracingStart).toHaveBeenCalledTimes(1)
    expect(tracingStop).toHaveBeenCalledTimes(1)
    expect(pageClose).toHaveBeenCalledTimes(1)
    expect(ctxClose).toHaveBeenCalledTimes(1)

    if (result.ok) {
      expect(result.traces).toHaveLength(0)
    }

    const finishedEvents = (logMock as any).mock.calls
      .map((c: any[]) => c[0])
      .filter((e: any) => e?.event === 'autoqa.spec.finished')
    expect(finishedEvents).toHaveLength(1)
    expect(finishedEvents[0]?.tracingError).toBe('TRACING_STOP_FAILED (EACCES)')
    expect(String(finishedEvents[0]?.tracingError ?? '')).not.toContain('/Users/')
    expect(finishedEvents[0]).not.toHaveProperty('tracePath')
  })

  it('still calls tracing.stop in finally when spec fails', async () => {
    vi.resetModules()
    logMock.mockClear()

    const tracingStart = vi.fn(async () => {})
    const tracingStop = vi.fn(async () => {})
    const pageClose = vi.fn(async () => {})
    const ctxClose = vi.fn(async () => {})

    const context = {
      tracing: {
        start: tracingStart,
        stop: tracingStop,
      },
      newPage: vi.fn(async () => ({ close: pageClose })),
      close: ctxClose,
    }

    const browser = {
      version: vi.fn(() => 'chromium-mock'),
      newContext: vi.fn(async () => context),
      close: vi.fn(async () => {}),
    }

    vi.doMock('../../src/browser/create-browser.js', () => ({
      createBrowser: vi.fn(async () => browser),
    }))

    vi.doMock('../../src/runner/trace-paths.js', () => ({
      generateTraceName: vi.fn((idx: number) => `${idx}-spec`),
      getTracePath: vi.fn((cwd: string, runId: string, name: string) => `/tmp/${runId}/traces/${name}.zip`),
      getRelativeTracePath: vi.fn((cwd: string, runId: string, name: string) => `.autoqa/runs/${runId}/traces/${name}.zip`),
      ensureTraceDir: vi.fn(async () => {}),
    }))

    const { runSpecs } = await import('../../src/runner/run-specs.js')

    const result = await runSpecs({
      runId: 'run-trace-4',
      baseUrl: 'http://example.test',
      headless: true,
      debug: false,
      specs: [{ specPath: '/specs/fail.md', spec: dummySpec }],
      logger: mockLogger,
      cwd: '/tmp/test-cwd',
      onSpec: vi.fn(async () => {
        throw new Error('spec failed')
      }),
    })

    expect(result.ok).toBe(false)
    expect(tracingStart).toHaveBeenCalledTimes(1)
    expect(tracingStop).toHaveBeenCalledTimes(1)
    expect(pageClose).toHaveBeenCalledTimes(1)
    expect(ctxClose).toHaveBeenCalledTimes(1)

    const finishedEvents = (logMock as any).mock.calls
      .map((c: any[]) => c[0])
      .filter((e: any) => e?.event === 'autoqa.spec.finished')
    expect(finishedEvents).toHaveLength(1)
  })
})
