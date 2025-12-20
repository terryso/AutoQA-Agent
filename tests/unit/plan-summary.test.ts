import { describe, it, expect } from 'vitest'
import type { PlanSummary } from '../../src/plan/output.js'

describe('plan summary structure', () => {
  it('should have required fields', () => {
    const summary: PlanSummary = {
      runId: 'test-run-id',
      generatedAt: '2025-12-21T00:00:00.000Z',
      baseUrl: 'https://example.com',
      exploration: {
        pagesVisited: 5,
        elementsFound: 50,
        formsFound: 3,
        linksFound: 20,
        maxDepthReached: 2,
        configuredDepth: 3,
      },
      testPlan: {
        casesGenerated: 10,
        testTypes: ['functional', 'form'],
        priorities: {
          p0: 3,
          p1: 5,
          p2: 2,
        },
      },
      exitCode: 0,
    }

    expect(summary.runId).toBe('test-run-id')
    expect(summary.exploration.pagesVisited).toBe(5)
    expect(summary.testPlan.casesGenerated).toBe(10)
    expect(summary.exitCode).toBe(0)
  })

  it('should include guardrail information when triggered', () => {
    const summary: PlanSummary = {
      runId: 'test-run-id',
      generatedAt: '2025-12-21T00:00:00.000Z',
      baseUrl: 'https://example.com',
      exploration: {
        pagesVisited: 10,
        elementsFound: 100,
        formsFound: 5,
        linksFound: 40,
        maxDepthReached: 3,
        configuredDepth: 3,
      },
      testPlan: {
        casesGenerated: 15,
        testTypes: ['functional'],
        priorities: {
          p0: 5,
          p1: 7,
          p2: 3,
        },
      },
      guardrailTriggered: {
        code: 'MAX_AGENT_TURNS',
        limit: 100,
        actual: 100,
        triggeredAt: '2025-12-21T00:10:00.000Z',
      },
      exitCode: 1,
    }

    expect(summary.guardrailTriggered).toBeDefined()
    expect(summary.guardrailTriggered?.code).toBe('MAX_AGENT_TURNS')
    expect(summary.guardrailTriggered?.limit).toBe(100)
    expect(summary.exitCode).toBe(1)
  })

  it('should calculate test type distribution', () => {
    const testTypes = ['functional', 'form', 'functional', 'navigation']
    const uniqueTypes = [...new Set(testTypes)]

    expect(uniqueTypes).toEqual(['functional', 'form', 'navigation'])
    expect(uniqueTypes.length).toBe(3)
  })

  it('should calculate priority distribution', () => {
    const cases = [
      { priority: 'p0' },
      { priority: 'p0' },
      { priority: 'p1' },
      { priority: 'p1' },
      { priority: 'p1' },
      { priority: 'p2' },
    ]

    const p0Count = cases.filter(c => c.priority === 'p0').length
    const p1Count = cases.filter(c => c.priority === 'p1').length
    const p2Count = cases.filter(c => c.priority === 'p2').length

    expect(p0Count).toBe(2)
    expect(p1Count).toBe(3)
    expect(p2Count).toBe(1)
  })
})
