import { describe, it, expect } from 'vitest'
import { buildMarkdownForTestCase, writeTestPlan } from '../../src/plan/output.js'
import type { TestPlan, TestCasePlan, PlanConfig } from '../../src/plan/types.js'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Integration tests for Planner output quality (Story 8.3)
 * 
 * Verifies end-to-end behavior:
 * - Complete test plan generation with quality constraints
 * - Markdown specs are executable by autoqa run
 * - loginStepsSpec configuration flows through correctly
 */

describe('Planner Output Quality Integration', () => {
  describe('Complete test plan with quality standards', () => {
    it('should generate test plan with happy path and boundary cases', async () => {
      const config: PlanConfig = {
        baseUrl: 'https://example.com',
        maxDepth: 2,
        testTypes: ['functional', 'boundary'],
        loginStepsSpec: 'login',
      }

      const testPlan: TestPlan = {
        runId: 'test-run-123',
        generatedAt: new Date().toISOString(),
        configSnapshot: config,
        flows: [],
        cases: [
          {
            id: 'search-happy',
            name: 'Search with Valid Query',
            type: 'functional',
            priority: 'p0',
            relatedPageIds: ['page-search'],
            markdownPath: 'search-happy.md',
            preconditions: [
              'Base URL accessible: {{BASE_URL}}',
              'Search page is available',
            ],
            steps: [
              {
                description: 'Navigate to {{BASE_URL}}/search',
                expectedResult: 'Search page loads with search input field',
              },
              {
                description: 'Fill the search field with "laptop"',
                expectedResult: 'Search field contains "laptop"',
              },
              {
                description: 'Click the "Search" button',
                expectedResult: 'Search results page displays at least 1 product matching "laptop"',
              },
            ],
          },
          {
            id: 'search-empty',
            name: 'Search with Empty Input',
            type: 'boundary',
            priority: 'p1',
            relatedPageIds: ['page-search'],
            markdownPath: 'search-empty.md',
            preconditions: [
              'Base URL accessible: {{BASE_URL}}',
              'Search page is available',
            ],
            steps: [
              {
                description: 'Navigate to {{BASE_URL}}/search',
                expectedResult: 'Search page loads',
              },
              {
                description: 'Click the "Search" button without entering text',
                expectedResult: 'Error message "Search term is required" appears',
              },
            ],
          },
        ],
      }

      const tmpDir = await mkdtemp(join(tmpdir(), 'autoqa-test-'))
      
      try {
        const output = await writeTestPlan(testPlan, {
          cwd: tmpDir,
          runId: 'test-run-123',
        })

        expect(output.errors).toHaveLength(0)
        expect(output.planPath).toBeDefined()
        expect(output.specPaths).toHaveLength(2)

        // Verify happy path spec
        const happyPath = join(tmpDir, '.autoqa/runs/test-run-123/plan/specs/search-happy.md')
        const happyContent = await readFile(happyPath, 'utf-8')
        
        expect(happyContent).toContain('# Search with Valid Query (Auto-generated)')
        expect(happyContent).toContain('Type: functional')
        expect(happyContent).toContain('Priority: P0')
        expect(happyContent).toContain('## Preconditions')
        expect(happyContent).toContain('Base URL accessible: {{BASE_URL}}')
        expect(happyContent).toContain('## Steps')
        expect(happyContent).toContain('Navigate to {{BASE_URL}}/search')
        expect(happyContent).toContain('Expected: Search page loads with search input field')
        expect(happyContent).toContain('Expected: Search results page displays at least 1 product matching "laptop"')

        // Verify boundary case spec
        const boundaryPath = join(tmpDir, '.autoqa/runs/test-run-123/plan/specs/search-empty.md')
        const boundaryContent = await readFile(boundaryPath, 'utf-8')
        
        expect(boundaryContent).toContain('# Search with Empty Input (Auto-generated)')
        expect(boundaryContent).toContain('Type: boundary')
        expect(boundaryContent).toContain('Expected: Error message "Search term is required" appears')
      } finally {
        await rm(tmpDir, { recursive: true, force: true })
      }
    })

    it('should generate test plan with login include for authenticated cases', async () => {
      const config: PlanConfig = {
        baseUrl: 'https://example.com',
        maxDepth: 2,
        loginStepsSpec: 'custom/login',
      }

      const testPlan: TestPlan = {
        runId: 'test-run-456',
        generatedAt: new Date().toISOString(),
        configSnapshot: config,
        flows: [],
        cases: [
          {
            id: 'profile-view',
            name: 'View User Profile',
            type: 'functional',
            priority: 'p0',
            relatedPageIds: ['page-profile'],
            markdownPath: 'profile-view.md',
            requiresLogin: true,
            preconditions: [
              'Base URL accessible: {{BASE_URL}}',
              'User needs to log in',
            ],
            steps: [
              {
                description: 'Navigate to {{BASE_URL}}/profile',
                expectedResult: 'Profile page displays user information',
              },
            ],
          },
        ],
      }

      const tmpDir = await mkdtemp(join(tmpdir(), 'autoqa-test-'))
      
      try {
        const output = await writeTestPlan(testPlan, {
          cwd: tmpDir,
          runId: 'test-run-456',
        })

        expect(output.errors).toHaveLength(0)
        expect(output.specPaths).toHaveLength(1)

        const specPath = join(tmpDir, '.autoqa/runs/test-run-456/plan/specs/profile-view.md')
        const content = await readFile(specPath, 'utf-8')
        
        expect(content).toContain('1. include: custom/login')
        expect(content).toContain('2. Navigate to {{BASE_URL}}/profile')
      } finally {
        await rm(tmpDir, { recursive: true, force: true })
      }
    })
  })

  describe('Markdown structure validation', () => {
    it('should generate markdown that meets parseMarkdownSpec requirements', () => {
      const testCase: TestCasePlan = {
        id: 'minimal-case',
        name: 'Minimal Test Case',
        type: 'functional',
        priority: 'p2',
        relatedPageIds: ['page-1'],
        markdownPath: 'minimal.md',
        preconditions: [
          'Base URL accessible: {{BASE_URL}}',
        ],
        steps: [
          {
            description: 'Navigate to {{BASE_URL}}/',
            expectedResult: 'Home page loads',
          },
        ],
      }

      const markdown = buildMarkdownForTestCase(testCase)

      // Verify required sections exist
      expect(markdown).toContain('## Preconditions')
      expect(markdown).toContain('## Steps')
      
      // Verify steps are numbered
      expect(markdown).toMatch(/1\.\s+Navigate/)
      
      // Verify expected results are formatted correctly
      expect(markdown).toContain('- Expected:')
    })

    it('should handle cases with no explicit steps gracefully', () => {
      const testCase: TestCasePlan = {
        id: 'no-steps',
        name: 'Test Case Without Steps',
        type: 'functional',
        priority: 'p2',
        relatedPageIds: ['page-1'],
        markdownPath: 'no-steps.md',
        preconditions: [
          'Base URL accessible: {{BASE_URL}}',
        ],
      }

      const markdown = buildMarkdownForTestCase(testCase)

      // Should generate a default navigation step
      expect(markdown).toContain('1. Navigate to {{BASE_URL}}/')
      expect(markdown).toContain('Expected: The application home page loads successfully')
    })
  })
})
