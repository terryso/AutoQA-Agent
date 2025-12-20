import { describe, it, expect } from 'vitest'
import type {
  PlanConfig,
  LocatorCandidate,
  ElementSummary,
  FormInfo,
  PageNode,
  NavigationEdge,
  ExplorationResult,
  GuardrailConfig,
  GuardrailTrigger,
  TranscriptEntry,
} from '../../src/plan/types.js'

describe('plan/types', () => {
  describe('PlanConfig', () => {
    it('should accept valid configuration with baseUrl and maxDepth', () => {
      const config: PlanConfig = {
        baseUrl: 'https://example.com',
        maxDepth: 3,
      }
      expect(config.baseUrl).toBe('https://example.com')
      expect(config.maxDepth).toBe(3)
    })

    it('should accept optional auth configuration', () => {
      const config: PlanConfig = {
        baseUrl: 'https://example.com',
        maxDepth: 2,
        auth: {
          loginUrl: 'https://example.com/login',
          username: 'testuser',
          password: 'testpass',
        },
      }
      expect(config.auth?.loginUrl).toBe('https://example.com/login')
      expect(config.auth?.username).toBe('testuser')
      expect(config.auth?.password).toBe('testpass')
    })

    it('should accept guardrail configuration', () => {
      const config: PlanConfig = {
        baseUrl: 'https://example.com',
        maxDepth: 3,
        guardrails: {
          maxAgentTurnsPerRun: 100,
          maxSnapshotsPerRun: 50,
          maxPagesPerRun: 20,
        },
      }
      expect(config.guardrails?.maxAgentTurnsPerRun).toBe(100)
      expect(config.guardrails?.maxSnapshotsPerRun).toBe(50)
      expect(config.guardrails?.maxPagesPerRun).toBe(20)
    })
  })

  describe('LocatorCandidate', () => {
    it('should define locator strategies', () => {
      const locator: LocatorCandidate = {
        strategy: 'testId',
        value: 'submit-button',
        priority: 1,
      }
      expect(locator.strategy).toBe('testId')
      expect(locator.value).toBe('submit-button')
      expect(locator.priority).toBe(1)
    })
  })

  describe('ElementSummary', () => {
    it('should represent a button element', () => {
      const element: ElementSummary = {
        id: 'e12345678',
        kind: 'button',
        locatorCandidates: [
          { strategy: 'testId', value: 'btn-submit', priority: 1 },
          { strategy: 'text', value: 'Submit', priority: 2 },
        ],
        text: 'Submit',
        ariaLabel: 'Submit form',
      }
      expect(element.kind).toBe('button')
      expect(element.locatorCandidates).toHaveLength(2)
      expect(element.text).toBe('Submit')
    })

    it('should represent an input element', () => {
      const element: ElementSummary = {
        id: 'e87654321',
        kind: 'input',
        locatorCandidates: [{ strategy: 'css', value: '#email', priority: 1 }],
        inputType: 'email',
        name: 'email',
        required: true,
      }
      expect(element.kind).toBe('input')
      expect(element.inputType).toBe('email')
      expect(element.required).toBe(true)
    })
  })

  describe('FormInfo', () => {
    it('should represent a form with fields', () => {
      const form: FormInfo = {
        id: 'f12345678',
        locatorCandidates: [{ strategy: 'css', value: '#login-form', priority: 1 }],
        fields: [
          {
            id: 'e1',
            kind: 'input',
            locatorCandidates: [],
            inputType: 'text',
            name: 'username',
          },
          {
            id: 'e2',
            kind: 'input',
            locatorCandidates: [],
            inputType: 'password',
            name: 'password',
          },
        ],
        submitButton: {
          id: 'e3',
          kind: 'button',
          locatorCandidates: [],
          text: 'Login',
        },
      }
      expect(form.fields).toHaveLength(2)
      expect(form.submitButton?.text).toBe('Login')
    })
  })

  describe('PageNode', () => {
    it('should represent a visited page with Tech Spec structure', () => {
      const page: PageNode = {
        id: 'p12345678',
        url: 'https://example.com',
        title: 'Example Page',
        visitedAt: '2025-01-01T00:00:00.000Z',
        depth: 0,
        elementSummary: [],
        forms: [],
        links: [],
      }
      expect(page.id).toBeDefined()
      expect(page.url).toBe('https://example.com')
      expect(page.title).toBe('Example Page')
      expect(page.depth).toBe(0)
    })

    it('should include snapshotRef when available', () => {
      const page: PageNode = {
        id: 'p12345678',
        url: 'https://example.com',
        depth: 0,
        visitedAt: '2025-01-01T00:00:00.000Z',
        snapshotRef: '.autoqa/runs/abc/snapshots/snapshot-1.aria.yaml',
        elementSummary: [],
        forms: [],
        links: [],
      }
      expect(page.snapshotRef).toBeDefined()
    })
  })

  describe('NavigationEdge', () => {
    it('should represent navigation between pages', () => {
      const edge: NavigationEdge = {
        from: 'https://example.com',
        to: 'https://example.com/about',
        action: 'navigate',
        trigger: 'About link',
      }
      expect(edge.from).toBe('https://example.com')
      expect(edge.to).toBe('https://example.com/about')
      expect(edge.action).toBe('navigate')
    })
  })

  describe('GuardrailTrigger', () => {
    it('should represent guardrail trigger information', () => {
      const trigger: GuardrailTrigger = {
        code: 'MAX_AGENT_TURNS',
        limit: 100,
        actual: 101,
        triggeredAt: '2025-01-01T00:00:00.000Z',
      }
      expect(trigger.code).toBe('MAX_AGENT_TURNS')
      expect(trigger.actual).toBeGreaterThan(trigger.limit)
    })
  })

  describe('TranscriptEntry', () => {
    it('should represent tool call entry', () => {
      const entry: TranscriptEntry = {
        timestamp: '2025-01-01T00:00:00.000Z',
        runId: 'test-run-id',
        type: 'tool_call',
        toolName: 'open_url',
        toolInput: { url: 'https://example.com' },
      }
      expect(entry.type).toBe('tool_call')
      expect(entry.toolName).toBe('open_url')
    })

    it('should represent guardrail triggered entry', () => {
      const entry: TranscriptEntry = {
        timestamp: '2025-01-01T00:00:00.000Z',
        runId: 'test-run-id',
        type: 'guardrail_triggered',
        guardrail: {
          code: 'MAX_PAGES',
          limit: 10,
          actual: 11,
          triggeredAt: '2025-01-01T00:00:00.000Z',
        },
      }
      expect(entry.type).toBe('guardrail_triggered')
      expect(entry.guardrail?.code).toBe('MAX_PAGES')
    })
  })

  describe('ExplorationResult', () => {
    it('should represent complete exploration result with new structure', () => {
      const result: ExplorationResult = {
        runId: 'test-run-id',
        startUrl: 'https://example.com',
        startedAt: '2025-01-01T00:00:00.000Z',
        finishedAt: '2025-01-01T00:01:00.000Z',
        stats: {
          pagesVisited: 5,
          elementsFound: 50,
          formsFound: 2,
          linksFound: 20,
          maxDepthReached: 2,
          configuredDepth: 3,
        },
        graph: {
          pages: [],
          edges: [],
        },
        transcript: [],
      }
      expect(result.stats.pagesVisited).toBe(5)
      expect(result.stats.maxDepthReached).toBe(2)
      expect(result.stats.configuredDepth).toBe(3)
    })

    it('should include error information when exploration fails', () => {
      const result: ExplorationResult = {
        runId: 'test-run-id',
        startUrl: 'https://example.com',
        startedAt: '2025-01-01T00:00:00.000Z',
        finishedAt: '2025-01-01T00:01:00.000Z',
        stats: {
          pagesVisited: 0,
          elementsFound: 0,
          formsFound: 0,
          linksFound: 0,
          maxDepthReached: 0,
          configuredDepth: 3,
        },
        error: {
          message: 'Navigation failed',
          stage: 'navigation',
          pageUrl: 'https://example.com',
        },
        graph: {
          pages: [],
          edges: [],
        },
        transcript: [],
      }
      expect(result.error?.message).toBe('Navigation failed')
      expect(result.error?.stage).toBe('navigation')
    })

    it('should include guardrail trigger information', () => {
      const result: ExplorationResult = {
        runId: 'test-run-id',
        startUrl: 'https://example.com',
        startedAt: '2025-01-01T00:00:00.000Z',
        finishedAt: '2025-01-01T00:01:00.000Z',
        stats: {
          pagesVisited: 10,
          elementsFound: 100,
          formsFound: 5,
          linksFound: 50,
          maxDepthReached: 3,
          configuredDepth: 5,
        },
        guardrailTriggered: {
          code: 'MAX_PAGES',
          limit: 10,
          actual: 10,
          triggeredAt: '2025-01-01T00:00:30.000Z',
        },
        graph: {
          pages: [],
          edges: [],
        },
        transcript: [],
      }
      expect(result.guardrailTriggered?.code).toBe('MAX_PAGES')
    })
  })
})
