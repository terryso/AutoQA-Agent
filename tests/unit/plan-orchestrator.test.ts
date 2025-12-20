import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { generateTestPlan } from '../../src/plan/orchestrator.js'
import type { PlanConfig, ExplorationGraph } from '../../src/plan/types.js'

vi.mock('node:fs/promises')
vi.mock('../../src/plan/plan-agent.js', () => ({
  runPlanAgent: vi.fn().mockResolvedValue({
    runId: 'test-run-id',
    generatedAt: '2025-01-01T00:00:00.000Z',
    configSnapshot: {
      baseUrl: 'https://example.com',
      maxDepth: 3,
    },
    flows: [],
    cases: [
      {
        id: 'test-case-1',
        name: 'Test Login',
        type: 'functional',
        priority: 'p0',
        relatedPageIds: ['page-1'],
        markdownPath: 'login.md',
        preconditions: ['User is logged out'],
        steps: [
          { description: 'Navigate to login page', expectedResult: 'Login form is visible' },
        ],
      },
    ],
  }),
}))

describe('plan orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('generateTestPlan', () => {
    it('should read exploration graph and generate test plan', async () => {
      const mockGraph: ExplorationGraph = {
        pages: [
          {
            id: 'page-1',
            url: 'https://example.com',
            title: 'Home',
            depth: 0,
            visitedAt: '2025-01-01T00:00:00.000Z',
            elementSummary: [],
            forms: [],
            links: [],
          },
        ],
        edges: [],
      }

      vi.mocked(readFile).mockResolvedValue(JSON.stringify(mockGraph))
      vi.mocked(mkdir).mockResolvedValue(undefined)

      const config: PlanConfig = {
        baseUrl: 'https://example.com',
        maxDepth: 3,
      }

      const logger = {
        log: vi.fn(),
      }

      const result = await generateTestPlan({
        runId: 'test-run-id',
        config,
        logger: logger as any,
        cwd: '/test/cwd',
      })

      expect(result.plan.cases).toHaveLength(1)
      expect(result.plan.cases[0].name).toBe('Test Login')
      expect(logger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'autoqa.plan.generate.orchestrator.started',
        })
      )
    })

    it('should throw error when exploration graph is missing', async () => {
      vi.mocked(readFile).mockRejectedValue(new Error('File not found'))

      const config: PlanConfig = {
        baseUrl: 'https://example.com',
        maxDepth: 3,
      }

      const logger = {
        log: vi.fn(),
      }

      await expect(
        generateTestPlan({
          runId: 'test-run-id',
          config,
          logger: logger as any,
          cwd: '/test/cwd',
        })
      ).rejects.toThrow('Failed to read exploration graph')
    })

    it('should throw error when exploration graph is invalid', async () => {
      vi.mocked(readFile).mockResolvedValue('invalid json')

      const config: PlanConfig = {
        baseUrl: 'https://example.com',
        maxDepth: 3,
      }

      const logger = {
        log: vi.fn(),
      }

      await expect(
        generateTestPlan({
          runId: 'test-run-id',
          config,
          logger: logger as any,
          cwd: '/test/cwd',
        })
      ).rejects.toThrow('Failed to parse exploration graph JSON')
    })
  })

  describe('runId sanitization', () => {
    it('should sanitize runId with special characters', async () => {
      const mockGraph: ExplorationGraph = {
        pages: [],
        edges: [],
      }

      vi.mocked(readFile).mockResolvedValue(JSON.stringify(mockGraph))
      vi.mocked(mkdir).mockResolvedValue(undefined)

      const config: PlanConfig = {
        baseUrl: 'https://example.com',
        maxDepth: 3,
      }

      const logger = {
        log: vi.fn(),
      }

      await generateTestPlan({
        runId: '../../../etc/passwd',
        config,
        logger: logger as any,
        cwd: '/test/cwd',
      })

      const mkdirCall = vi.mocked(mkdir).mock.calls[0]
      const dirPath = mkdirCall[0] as string
      expect(dirPath).not.toContain('..')
      expect(dirPath).toContain('etc_passwd')
    })
  })
})
