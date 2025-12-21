import { describe, it, expect } from 'vitest'
import { buildPlanPrompt, type PlanAgentOptions } from '../../src/plan/plan-agent.js'
import type { PlanConfig, ExplorationGraph } from '../../src/plan/types.js'
import type { Logger } from '../../src/logging/index.js'

/**
 * Unit tests for Planner Prompt Quality Standards (Story 8.3)
 * 
 * These tests verify that the planner prompt includes:
 * - Happy path and boundary/negative case requirements
 * - Quality constraints for preconditions and success criteria
 * - Executable step semantics
 * 
 * These tests act as a contract between the implementation and Tech Spec.
 * If any of these key phrases are removed from the prompt, tests should fail.
 */

function createMockLogger(): Logger {
  return {
    log: () => {},
    error: () => {},
    warn: () => {},
    info: () => {},
    debug: () => {},
    flush: async () => {},
  } as Logger
}

function createMockConfig(): PlanConfig {
  return {
    baseUrl: 'https://example.com',
    maxDepth: 2,
    testTypes: ['functional', 'boundary'],
  }
}

function createMockGraph(): ExplorationGraph {
  return {
    pages: [
      {
        id: 'page-1',
        url: 'https://example.com/',
        depth: 0,
        visitedAt: new Date().toISOString(),
        elementSummary: [],
        forms: [],
        links: [],
      },
      {
        id: 'page-2',
        url: 'https://example.com/search',
        depth: 1,
        visitedAt: new Date().toISOString(),
        elementSummary: [],
        forms: [],
        links: [],
      },
    ],
    edges: [],
  }
}

function createPlanAgentOptions(config?: Partial<PlanConfig>, graph?: ExplorationGraph): PlanAgentOptions {
  return {
    runId: 'test-run',
    config: { ...createMockConfig(), ...config },
    graph: graph ?? createMockGraph(),
    cwd: '/test',
    logger: createMockLogger(),
  }
}

describe('Planner Prompt Quality Standards', () => {
  describe('Prompt structure and key sections', () => {
    it('should include Test Planning Principles section', () => {
      const options = createPlanAgentOptions()
      const prompt = buildPlanPrompt(options)
      
      expect(prompt).toContain('# Test Planning Principles')
    })

    it('should include Comprehensive Scenario Coverage section', () => {
      const options = createPlanAgentOptions()
      const prompt = buildPlanPrompt(options)
      
      expect(prompt).toContain('## 1. Comprehensive Scenario Coverage')
    })

    it('should include Test Case Quality Standards section', () => {
      const options = createPlanAgentOptions()
      const prompt = buildPlanPrompt(options)
      
      expect(prompt).toContain('## 2. Test Case Quality Standards')
    })

    it('should include Markdown Structure Requirements section', () => {
      const options = createPlanAgentOptions()
      const prompt = buildPlanPrompt(options)
      
      expect(prompt).toContain('## 3. Markdown Structure Requirements')
    })

    it('should include Output Format section', () => {
      const options = createPlanAgentOptions()
      const prompt = buildPlanPrompt(options)
      
      expect(prompt).toContain('## 4. Output Format')
    })
  })

  describe('Happy Path and Boundary/Negative case requirements', () => {
    it('should explicitly require Happy Path cases', () => {
      const options = createPlanAgentOptions()
      const prompt = buildPlanPrompt(options)
      
      expect(prompt).toContain('**Happy Path Cases:**')
      expect(prompt).toContain('At least ONE test case covering the normal, successful flow')
    })

    it('should explicitly require Boundary & Negative cases', () => {
      const options = createPlanAgentOptions()
      const prompt = buildPlanPrompt(options)
      
      expect(prompt).toContain('**Boundary & Negative Cases:**')
      expect(prompt).toContain('At least ONE test case covering edge cases and error conditions')
    })

    it('should provide examples of boundary/negative scenarios', () => {
      const options = createPlanAgentOptions()
      const prompt = buildPlanPrompt(options)
      
      expect(prompt).toContain('Empty or missing required fields')
      expect(prompt).toContain('Invalid input formats')
      expect(prompt).toContain('Invalid credentials for login')
    })

    it('should include critical reminder for both case types', () => {
      const options = createPlanAgentOptions()
      const prompt = buildPlanPrompt(options)
      
      expect(prompt).toContain('CRITICAL: For each key behavior (search, form, login, CRUD), generate BOTH happy path AND boundary/negative cases')
    })
  })

  describe('Quality constraints for preconditions', () => {
    it('should require clear initial state in preconditions', () => {
      const options = createPlanAgentOptions()
      const prompt = buildPlanPrompt(options)
      
      expect(prompt).toContain('**Clear Initial State (Preconditions):**')
      expect(prompt).toContain('Specify starting world state: logged in/out, cart empty/populated')
    })

    it('should require template variables in preconditions', () => {
      const options = createPlanAgentOptions()
      const prompt = buildPlanPrompt(options)
      
      expect(prompt).toContain('Use template variables for all URLs and credentials')
      expect(prompt).toContain('{{BASE_URL}}')
      expect(prompt).toContain('{{LOGIN_BASE_URL}}')
    })
  })

  describe('Executable step semantics', () => {
    it('should require specific action verbs', () => {
      const options = createPlanAgentOptions()
      const prompt = buildPlanPrompt(options)
      
      expect(prompt).toContain('**Executable Steps with Specific Actions:**')
      expect(prompt).toContain('Use action verbs: Navigate, Click, Fill, Select, Verify, Expect')
    })

    it('should provide correct and wrong examples for navigation', () => {
      const options = createPlanAgentOptions()
      const prompt = buildPlanPrompt(options)
      
      expect(prompt).toContain('CORRECT: "Navigate to {{BASE_URL}}/products/search"')
      expect(prompt).toContain('WRONG: "Go to search page" (too vague)')
    })

    it('should provide correct and wrong examples for interactions', () => {
      const options = createPlanAgentOptions()
      const prompt = buildPlanPrompt(options)
      
      expect(prompt).toContain('CORRECT: "Fill the \'Search\' input field with \'laptop\'"')
      expect(prompt).toContain('WRONG: "Enter search term" (missing specifics)')
    })
  })

  describe('Verifiable success criteria', () => {
    it('should require non-empty specific expectedResult', () => {
      const options = createPlanAgentOptions()
      const prompt = buildPlanPrompt(options)
      
      expect(prompt).toContain('**Verifiable Success Criteria (Expected Results):**')
      expect(prompt).toContain('Each step MUST have a non-empty, specific expectedResult')
    })

    it('should provide correct examples for expected results', () => {
      const options = createPlanAgentOptions()
      const prompt = buildPlanPrompt(options)
      
      expect(prompt).toContain('CORRECT: "The search results show at least 1 product matching \'laptop\'"')
      expect(prompt).toContain('CORRECT: "Error message \'Username is required\' appears below the username field"')
    })

    it('should provide wrong examples for expected results', () => {
      const options = createPlanAgentOptions()
      const prompt = buildPlanPrompt(options)
      
      expect(prompt).toContain('WRONG: "The page works correctly" (too vague)')
      expect(prompt).toContain('WRONG: "User sees results" (not specific enough)')
    })
  })

  describe('Template variables and credentials', () => {
    it('should require template variables for URLs', () => {
      const options = createPlanAgentOptions()
      const prompt = buildPlanPrompt(options)
      
      expect(prompt).toContain('{{BASE_URL}}')
      expect(prompt).toContain('{{LOGIN_BASE_URL}}')
    })

    it('should require template variables for credentials', () => {
      const options = createPlanAgentOptions()
      const prompt = buildPlanPrompt(options)
      
      expect(prompt).toContain('{{USERNAME}}')
      expect(prompt).toContain('{{PASSWORD}}')
    })

    it('should forbid actual credentials in test cases', () => {
      const options = createPlanAgentOptions()
      const prompt = buildPlanPrompt(options)
      
      expect(prompt).toContain('Never include actual credentials in test cases')
    })
  })

  describe('Output format requirements', () => {
    it('should require strict JSON output', () => {
      const options = createPlanAgentOptions()
      const prompt = buildPlanPrompt(options)
      
      expect(prompt).toContain('Respond with JSON in the following shape, and nothing else')
    })

    it('should specify JSON schema structure', () => {
      const options = createPlanAgentOptions()
      const prompt = buildPlanPrompt(options)
      
      expect(prompt).toContain('"flows":')
      expect(prompt).toContain('"cases":')
      expect(prompt).toContain('"preconditions":')
      expect(prompt).toContain('"steps":')
    })

    it('should forbid commentary outside JSON', () => {
      const options = createPlanAgentOptions()
      const prompt = buildPlanPrompt(options)
      
      expect(prompt).toContain('Do not include any commentary outside of the JSON structure')
    })
  })

  describe('URL mapping examples', () => {
    it('should include URL mapping section', () => {
      const options = createPlanAgentOptions()
      const prompt = buildPlanPrompt(options)
      
      expect(prompt).toContain('URL Mapping and Template Variables')
    })

    it('should provide examples from explored pages when available', () => {
      const options = createPlanAgentOptions()
      const prompt = buildPlanPrompt(options)
      
      expect(prompt).toContain('Examples from explored pages')
      expect(prompt).toContain('https://example.com/')
    })
  })
})
