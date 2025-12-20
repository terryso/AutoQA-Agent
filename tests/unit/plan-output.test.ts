import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rm, readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { writeExplorationResult } from '../../src/plan/output.js'
import type { ExplorationResult } from '../../src/plan/types.js'

describe('plan/output', () => {
  const testCwd = resolve(process.cwd(), 'tests', 'fixtures', 'plan-output-test')
  const testRunId = 'test-run-123'

  beforeEach(async () => {
    await rm(testCwd, { recursive: true, force: true })
  })

  afterEach(async () => {
    await rm(testCwd, { recursive: true, force: true })
  })

  function createTestResult(): ExplorationResult {
    return {
      runId: testRunId,
      startUrl: 'https://example.com',
      startedAt: '2025-01-01T00:00:00.000Z',
      finishedAt: '2025-01-01T00:01:00.000Z',
      stats: {
        pagesVisited: 1,
        elementsFound: 10,
        formsFound: 1,
        linksFound: 5,
        maxDepthReached: 0,
        configuredDepth: 2,
      },
      graph: {
        pages: [
          {
            id: 'p1',
            url: 'https://example.com',
            title: 'Example',
            visitedAt: '2025-01-01T00:00:00.000Z',
            depth: 0,
            elementSummary: [
              { id: 'e1', kind: 'button', text: 'Click me' },
            ],
            forms: [],
            links: [{ text: 'About', href: 'https://example.com/about', external: false }],
          },
        ],
        edges: [],
      },
      transcript: [
        {
          timestamp: '2025-01-01T00:00:00.000Z',
          runId: testRunId,
          type: 'tool_call',
          toolName: 'open_url',
          toolInput: { url: 'https://example.com' },
        },
      ],
    }
  }

  describe('writeExplorationResult', () => {
    it('should write three artifact files', async () => {
      const result = createTestResult()

      const output = await writeExplorationResult(result, {
        cwd: testCwd,
        runId: testRunId,
      })

      expect(output.errors).toHaveLength(0)
      expect(output.graphPath).toBe('.autoqa/runs/test-run-123/plan-explore/explore-graph.json')
      expect(output.elementsPath).toBe('.autoqa/runs/test-run-123/plan-explore/explore-elements.json')
      expect(output.transcriptPath).toBe('.autoqa/runs/test-run-123/plan-explore/explore-transcript.jsonl')
    })

    it('should write explore-graph.json with pages and edges', async () => {
      const result = createTestResult()

      await writeExplorationResult(result, {
        cwd: testCwd,
        runId: testRunId,
      })

      const absPath = resolve(testCwd, '.autoqa', 'runs', testRunId, 'plan-explore', 'explore-graph.json')
      const content = await readFile(absPath, 'utf-8')
      const parsed = JSON.parse(content)

      expect(parsed.pages).toHaveLength(1)
      expect(parsed.pages[0].url).toBe('https://example.com')
      expect(parsed.edges).toEqual([])
    })

    it('should write explore-elements.json with elements per page', async () => {
      const result = createTestResult()

      await writeExplorationResult(result, {
        cwd: testCwd,
        runId: testRunId,
      })

      const absPath = resolve(testCwd, '.autoqa', 'runs', testRunId, 'plan-explore', 'explore-elements.json')
      const content = await readFile(absPath, 'utf-8')
      const parsed = JSON.parse(content)

      expect(parsed.runId).toBe(testRunId)
      expect(parsed.pages).toHaveLength(1)
      expect(parsed.pages[0].pageUrl).toBe('https://example.com')
      expect(parsed.pages[0].elements).toHaveLength(1)
      expect(parsed.pages[0].elements[0].kind).toBe('button')
    })

    it('should write explore-transcript.jsonl with one JSON per line', async () => {
      const result = createTestResult()

      await writeExplorationResult(result, {
        cwd: testCwd,
        runId: testRunId,
      })

      const absPath = resolve(testCwd, '.autoqa', 'runs', testRunId, 'plan-explore', 'explore-transcript.jsonl')
      const content = await readFile(absPath, 'utf-8')
      const lines = content.trim().split('\n')

      expect(lines).toHaveLength(1)
      const entry = JSON.parse(lines[0])
      expect(entry.type).toBe('tool_call')
      expect(entry.toolName).toBe('open_url')
    })

    it('should sanitize runId in paths', async () => {
      const result = createTestResult()
      result.runId = 'test/../../../etc/passwd'

      const output = await writeExplorationResult(result, {
        cwd: testCwd,
        runId: 'test/../../../etc/passwd',
      })

      expect(output.errors).toHaveLength(0)
      expect(output.graphPath).toContain('test_______etc_passwd')
      expect(output.graphPath).not.toContain('..')
    })

    it('should handle write errors gracefully', async () => {
      const result = createTestResult()

      const output = await writeExplorationResult(result, {
        cwd: '/invalid/path/that/does/not/exist',
        runId: testRunId,
      })

      expect(output.errors.length).toBeGreaterThan(0)
      expect(output.graphPath).toBeUndefined()
    })

    it('should include error information in result when exploration failed', async () => {
      const result = createTestResult()
      result.error = {
        message: 'Navigation failed',
        stage: 'navigation',
        pageUrl: 'https://example.com',
      }

      const output = await writeExplorationResult(result, {
        cwd: testCwd,
        runId: testRunId,
      })

      expect(output.errors).toHaveLength(0)
      expect(output.graphPath).toBeDefined()
    })

    it('should include guardrail trigger in transcript', async () => {
      const result = createTestResult()
      result.guardrailTriggered = {
        code: 'MAX_PAGES',
        limit: 10,
        actual: 10,
        triggeredAt: '2025-01-01T00:00:30.000Z',
      }
      result.transcript.push({
        timestamp: '2025-01-01T00:00:30.000Z',
        runId: testRunId,
        type: 'guardrail_triggered',
        guardrail: result.guardrailTriggered,
      })

      const output = await writeExplorationResult(result, {
        cwd: testCwd,
        runId: testRunId,
      })

      const absPath = resolve(testCwd, '.autoqa', 'runs', testRunId, 'plan-explore', 'explore-transcript.jsonl')
      const content = await readFile(absPath, 'utf-8')
      const lines = content.trim().split('\n')

      expect(lines).toHaveLength(2)
      const lastEntry = JSON.parse(lines[1])
      expect(lastEntry.type).toBe('guardrail_triggered')
      expect(lastEntry.guardrail.code).toBe('MAX_PAGES')
    })
  })
})
