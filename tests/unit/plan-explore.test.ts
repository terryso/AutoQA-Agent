import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Browser, BrowserContext, Page } from 'playwright'
import type { Logger } from '../../src/logging/index.js'
import { explore } from '../../src/plan/explore.js'
import type { PlanConfig, ExplorationResult } from '../../src/plan/types.js'

// Mock the explore-agent module
vi.mock('../../src/plan/explore-agent.js', () => ({
  runExploreAgent: vi.fn(),
}))

import { runExploreAgent } from '../../src/plan/explore-agent.js'

const mockRunExploreAgent = vi.mocked(runExploreAgent)

describe('plan/explore', () => {
  const createMockLogger = (): Logger => ({
    log: vi.fn(),
    flush: vi.fn(async () => {}),
  })

  const createMockPage = (): Page => ({
    goto: vi.fn(async () => null),
    title: vi.fn(async () => 'Test Page'),
    url: vi.fn(() => 'https://example.com'),
    close: vi.fn(async () => {}),
  } as any)

  const createMockContext = (page: Page): BrowserContext => ({
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => {}),
  } as any)

  const createMockBrowser = (context: BrowserContext): Browser => ({
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => {}),
  } as any)

  const createMockResult = (overrides: Partial<ExplorationResult> = {}): ExplorationResult => ({
    runId: 'test-run',
    startUrl: 'https://example.com',
    startedAt: '2025-01-01T00:00:00.000Z',
    finishedAt: '2025-01-01T00:01:00.000Z',
    stats: {
      pagesVisited: 1,
      elementsFound: 5,
      formsFound: 0,
      linksFound: 2,
      maxDepthReached: 0,
      configuredDepth: 3,
    },
    graph: {
      pages: [{
        id: 'p1',
        url: 'https://example.com',
        title: 'Test Page',
        depth: 0,
        visitedAt: '2025-01-01T00:00:00.000Z',
        elementSummary: [],
        forms: [],
        links: [],
      }],
      edges: [],
    },
    transcript: [{
      timestamp: '2025-01-01T00:00:00.000Z',
      runId: 'test-run',
      type: 'tool_call',
      toolName: 'mcp__browser__navigate',
      toolInput: { url: 'https://example.com' },
    }],
    ...overrides,
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('explore', () => {
    it('should call runExploreAgent and return its result', async () => {
      const logger = createMockLogger()
      const page = createMockPage()
      const context = createMockContext(page)
      const browser = createMockBrowser(context)

      const mockResult = createMockResult()
      mockRunExploreAgent.mockResolvedValue(mockResult)

      const config: PlanConfig = {
        baseUrl: 'https://example.com',
        maxDepth: 0,
      }

      const result = await explore({
        config,
        browser,
        logger,
        runId: 'test-run',
        cwd: '/tmp',
      })

      expect(mockRunExploreAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: 'test-run',
          config,
          cwd: '/tmp',
          logger,
        })
      )
      expect(result).toEqual(mockResult)
    })

    it('should create browser context and page', async () => {
      const logger = createMockLogger()
      const page = createMockPage()
      const context = createMockContext(page)
      const browser = createMockBrowser(context)

      mockRunExploreAgent.mockResolvedValue(createMockResult())

      const config: PlanConfig = {
        baseUrl: 'https://example.com',
        maxDepth: 0,
      }

      await explore({
        config,
        browser,
        logger,
        runId: 'test-run',
        cwd: '/tmp',
      })

      expect(browser.newContext).toHaveBeenCalled()
      expect(context.newPage).toHaveBeenCalled()
    })

    it('should close browser context on completion', async () => {
      const logger = createMockLogger()
      const page = createMockPage()
      const context = createMockContext(page)
      const browser = createMockBrowser(context)

      mockRunExploreAgent.mockResolvedValue(createMockResult())

      const config: PlanConfig = {
        baseUrl: 'https://example.com',
        maxDepth: 0,
      }

      await explore({
        config,
        browser,
        logger,
        runId: 'test-run',
        cwd: '/tmp',
      })

      expect(page.close).toHaveBeenCalled()
      expect(context.close).toHaveBeenCalled()
    })

    it('should close browser context even when agent throws', async () => {
      const logger = createMockLogger()
      const page = createMockPage()
      const context = createMockContext(page)
      const browser = createMockBrowser(context)

      mockRunExploreAgent.mockRejectedValue(new Error('Agent failed'))

      const config: PlanConfig = {
        baseUrl: 'https://example.com',
        maxDepth: 0,
      }

      await expect(
        explore({
          config,
          browser,
          logger,
          runId: 'test-run',
          cwd: '/tmp',
        })
      ).rejects.toThrow('Agent failed')

      expect(page.close).toHaveBeenCalled()
      expect(context.close).toHaveBeenCalled()
    })

    it('should pass config with auth to runExploreAgent', async () => {
      const logger = createMockLogger()
      const page = createMockPage()
      const context = createMockContext(page)
      const browser = createMockBrowser(context)

      mockRunExploreAgent.mockResolvedValue(createMockResult({
        login: { attempted: true, ok: true },
      }))

      const config: PlanConfig = {
        baseUrl: 'https://example.com',
        maxDepth: 0,
        auth: {
          loginUrl: 'https://example.com/login',
          username: 'testuser',
          password: 'testpass',
        },
      }

      await explore({
        config,
        browser,
        logger,
        runId: 'test-run',
        cwd: '/tmp',
      })

      expect(mockRunExploreAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            auth: expect.objectContaining({
              loginUrl: 'https://example.com/login',
              username: 'testuser',
              password: 'testpass',
            }),
          }),
        })
      )
    })

    it('should pass config with guardrails to runExploreAgent', async () => {
      const logger = createMockLogger()
      const page = createMockPage()
      const context = createMockContext(page)
      const browser = createMockBrowser(context)

      mockRunExploreAgent.mockResolvedValue(createMockResult())

      const config: PlanConfig = {
        baseUrl: 'https://example.com',
        maxDepth: 3,
        guardrails: {
          maxPagesPerRun: 10,
          maxAgentTurnsPerRun: 50,
          maxSnapshotsPerRun: 20,
        },
      }

      await explore({
        config,
        browser,
        logger,
        runId: 'test-run',
        cwd: '/tmp',
      })

      expect(mockRunExploreAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            guardrails: expect.objectContaining({
              maxPagesPerRun: 10,
              maxAgentTurnsPerRun: 50,
              maxSnapshotsPerRun: 20,
            }),
          }),
        })
      )
    })

    it('should return result with login failure info', async () => {
      const logger = createMockLogger()
      const page = createMockPage()
      const context = createMockContext(page)
      const browser = createMockBrowser(context)

      mockRunExploreAgent.mockResolvedValue(createMockResult({
        login: { attempted: true, ok: false, error: 'Invalid credentials' },
        error: { message: 'Login failed', stage: 'login' },
      }))

      const config: PlanConfig = {
        baseUrl: 'https://example.com',
        maxDepth: 0,
        auth: {
          loginUrl: 'https://example.com/login',
          username: 'testuser',
          password: 'wrongpass',
        },
      }

      const result = await explore({
        config,
        browser,
        logger,
        runId: 'test-run',
        cwd: '/tmp',
      })

      expect(result.login?.attempted).toBe(true)
      expect(result.login?.ok).toBe(false)
      expect(result.error?.stage).toBe('login')
    })

    it('should return result with guardrail trigger info', async () => {
      const logger = createMockLogger()
      const page = createMockPage()
      const context = createMockContext(page)
      const browser = createMockBrowser(context)

      mockRunExploreAgent.mockResolvedValue(createMockResult({
        guardrailTriggered: {
          code: 'MAX_PAGES',
          limit: 10,
          actual: 10,
          triggeredAt: '2025-01-01T00:00:30.000Z',
        },
      }))

      const config: PlanConfig = {
        baseUrl: 'https://example.com',
        maxDepth: 3,
        guardrails: {
          maxPagesPerRun: 10,
        },
      }

      const result = await explore({
        config,
        browser,
        logger,
        runId: 'test-run',
        cwd: '/tmp',
      })

      expect(result.guardrailTriggered).toBeDefined()
      expect(result.guardrailTriggered?.code).toBe('MAX_PAGES')
    })
  })
})
