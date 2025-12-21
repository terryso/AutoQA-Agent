import { describe, it, expect } from 'vitest'
import { buildMarkdownForTestCase } from '../../src/plan/output.js'
import { parseMarkdownSpec } from '../../src/markdown/parse-markdown-spec.js'
import type { TestCasePlan } from '../../src/plan/types.js'

describe('Planner Markdown Output', () => {
  describe('buildMarkdownForTestCase', () => {
    it('should generate valid Markdown that parseMarkdownSpec can parse', () => {
      const testCase: TestCasePlan = {
        id: 'test-1',
        name: 'Login Flow Test',
        type: 'functional',
        priority: 'p0',
        relatedPageIds: ['page-1'],
        markdownPath: 'login-flow.md',
        preconditions: [
          'Base URL accessible: {{BASE_URL}}',
          'Valid test account available (via AUTOQA_USERNAME / AUTOQA_PASSWORD environment variables)',
        ],
        steps: [
          {
            description: 'Navigate to {{BASE_URL}}/login',
            expectedResult: 'Login page loads with username and password fields',
          },
          {
            description: 'Fill the "Username" field with {{USERNAME}}',
            expectedResult: 'Username field contains the test username',
          },
          {
            description: 'Fill the "Password" field with {{PASSWORD}}',
            expectedResult: 'Password field is filled (masked)',
          },
          {
            description: 'Click the "Login" button',
            expectedResult: 'User is redirected to dashboard page',
          },
          {
            description: 'Verify the page title is "Dashboard"',
            expectedResult: 'Page title matches expected value',
          },
        ],
      }

      const markdown = buildMarkdownForTestCase(testCase)
      const result = parseMarkdownSpec(markdown)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.preconditions).toHaveLength(2)
        expect(result.value.preconditions[0]).toContain('{{BASE_URL}}')
        // Now includes login include step + 5 original steps = 6 total
        expect(result.value.steps).toHaveLength(6)
        
        // First step should be the auto-inserted login include
        const firstStepText = result.value.steps[0].text
        expect(firstStepText).toContain('include: login')
        
        // Second step should be the first original step
        const secondStepText = result.value.steps[1].text
        expect(secondStepText).toContain('Navigate to {{BASE_URL}}/login')
        
        expect(markdown).toContain('Expected: Login page loads')
      }
    })

    it('should use template variables for URLs in generated specs', () => {
      const testCase: TestCasePlan = {
        id: 'test-2',
        name: 'Product Search',
        type: 'functional',
        priority: 'p1',
        relatedPageIds: ['page-2'],
        markdownPath: 'product-search.md',
        preconditions: [
          'Base URL accessible: {{BASE_URL}}',
          'Product catalog page accessible: {{BASE_URL}}/products',
        ],
        steps: [
          {
            description: 'Navigate to {{BASE_URL}}/products',
            expectedResult: 'Product catalog page loads',
          },
          {
            description: 'Fill the search field with "laptop"',
            expectedResult: 'Search field contains "laptop"',
          },
          {
            description: 'Click the "Search" button',
            expectedResult: 'Search results page displays matching products',
          },
          {
            description: 'Verify at least one product card is visible',
            expectedResult: 'Product cards are displayed in the results',
          },
        ],
      }

      const markdown = buildMarkdownForTestCase(testCase)

      expect(markdown).toContain('{{BASE_URL}}')
      expect(markdown).not.toMatch(/https?:\/\/[^\s]+/)
      expect(markdown).toContain('## Preconditions')
      expect(markdown).toContain('## Steps')
      expect(markdown).toContain('(Auto-generated)')
    })

    it('should handle minimal test case with defaults', () => {
      const testCase: TestCasePlan = {
        id: 'test-3',
        name: 'Minimal Test',
        type: 'navigation',
        priority: 'p2',
        relatedPageIds: [],
        markdownPath: 'minimal.md',
      }

      const markdown = buildMarkdownForTestCase(testCase)
      const result = parseMarkdownSpec(markdown)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.preconditions).toHaveLength(1)
        expect(result.value.preconditions[0]).toContain('{{BASE_URL}}')
        expect(result.value.steps).toHaveLength(1)
        expect(result.value.steps[0].text).toContain('Navigate to {{BASE_URL}}/')
      }
    })

    it('should generate executable action verbs in steps', () => {
      const testCase: TestCasePlan = {
        id: 'test-4',
        name: 'Form Submission',
        type: 'form',
        priority: 'p0',
        relatedPageIds: ['page-3'],
        markdownPath: 'form-submit.md',
        preconditions: ['Base URL accessible: {{BASE_URL}}'],
        steps: [
          {
            description: 'Navigate to {{BASE_URL}}/contact',
            expectedResult: 'Contact form page loads',
          },
          {
            description: 'Fill the "Name" field with "Test User"',
            expectedResult: 'Name field contains "Test User"',
          },
          {
            description: 'Fill the "Email" field with "test@example.com"',
            expectedResult: 'Email field contains valid email',
          },
          {
            description: 'Click the "Submit" button',
            expectedResult: 'Form is submitted successfully',
          },
          {
            description: 'Verify success message "Thank you" is displayed',
            expectedResult: 'Success message appears on the page',
          },
        ],
      }

      const markdown = buildMarkdownForTestCase(testCase)
      const actionVerbs = ['Navigate', 'Fill', 'Click', 'Verify']

      for (const verb of actionVerbs) {
        expect(markdown).toContain(verb)
      }
    })

    it('should include non-empty expectedResult for all steps', () => {
      const testCase: TestCasePlan = {
        id: 'test-5',
        name: 'Cart Operations',
        type: 'functional',
        priority: 'p1',
        relatedPageIds: ['page-4'],
        markdownPath: 'cart-ops.md',
        preconditions: [
          'Base URL accessible: {{BASE_URL}}',
          'User is already logged in',
        ],
        steps: [
          {
            description: 'Navigate to {{BASE_URL}}/products',
            expectedResult: 'Products page displays available items',
          },
          {
            description: 'Click "Add to cart" for the first product',
            expectedResult: 'Cart badge count increases to 1',
          },
          {
            description: 'Click the cart icon',
            expectedResult: 'Cart page shows the added product',
          },
        ],
      }

      const markdown = buildMarkdownForTestCase(testCase)
      const lines = markdown.split('\n')

      let stepCount = 0
      let expectedCount = 0

      for (const line of lines) {
        if (/^\d+\.\s/.test(line)) {
          stepCount++
        }
        if (line.trim().startsWith('- Expected:')) {
          expectedCount++
          expect(line.length).toBeGreaterThan('- Expected: '.length)
        }
      }

      // User is already logged in, so NO login include step + 3 original steps = 3 total
      expect(stepCount).toBe(3)
      // All 3 steps have Expected lines
      expect(expectedCount).toBe(3)
    })

    it('should not include hardcoded credentials', () => {
      const testCase: TestCasePlan = {
        id: 'test-6',
        name: 'Login with Credentials',
        type: 'functional',
        priority: 'p0',
        relatedPageIds: ['page-5'],
        markdownPath: 'login-creds.md',
        preconditions: [
          'Base URL accessible: {{BASE_URL}}',
          'Valid test account available (via AUTOQA_USERNAME / AUTOQA_PASSWORD environment variables)',
        ],
        steps: [
          {
            description: 'Navigate to {{BASE_URL}}/login',
            expectedResult: 'Login page loads',
          },
          {
            description: 'Fill the "Username" field with {{USERNAME}}',
            expectedResult: 'Username is entered',
          },
          {
            description: 'Fill the "Password" field with {{PASSWORD}}',
            expectedResult: 'Password is entered',
          },
        ],
      }

      const markdown = buildMarkdownForTestCase(testCase)

      expect(markdown).toContain('{{USERNAME}}')
      expect(markdown).toContain('{{PASSWORD}}')
      expect(markdown).not.toMatch(/password\s*[:=]\s*["'][^"']+["']/i)
      expect(markdown).not.toMatch(/username\s*[:=]\s*["'][^"']+["']/i)
    })
  })

  describe('Markdown structure compliance', () => {
    it('should always have ## Preconditions section', () => {
      const testCase: TestCasePlan = {
        id: 'test-7',
        name: 'Structure Test',
        type: 'functional',
        priority: 'p1',
        relatedPageIds: [],
        markdownPath: 'structure.md',
      }

      const markdown = buildMarkdownForTestCase(testCase)

      expect(markdown).toContain('## Preconditions')
      expect(markdown).toContain('## Steps')
    })

    it('should use ordered list for steps', () => {
      const testCase: TestCasePlan = {
        id: 'test-8',
        name: 'Ordered Steps Test',
        type: 'functional',
        priority: 'p1',
        relatedPageIds: [],
        markdownPath: 'ordered.md',
        steps: [
          { description: 'First step', expectedResult: 'Result 1' },
          { description: 'Second step', expectedResult: 'Result 2' },
          { description: 'Third step', expectedResult: 'Result 3' },
        ],
      }

      const markdown = buildMarkdownForTestCase(testCase)
      const lines = markdown.split('\n')

      expect(lines.some(l => l.startsWith('1. '))).toBe(true)
      expect(lines.some(l => l.startsWith('2. '))).toBe(true)
      expect(lines.some(l => l.startsWith('3. '))).toBe(true)
    })

    it('should use unordered list for preconditions', () => {
      const testCase: TestCasePlan = {
        id: 'test-9',
        name: 'Preconditions List Test',
        type: 'functional',
        priority: 'p1',
        relatedPageIds: [],
        markdownPath: 'precond.md',
        preconditions: [
          'First precondition',
          'Second precondition',
        ],
      }

      const markdown = buildMarkdownForTestCase(testCase)
      const lines = markdown.split('\n')

      const preconditionLines = lines.filter(l => l.startsWith('- '))
      expect(preconditionLines.length).toBeGreaterThanOrEqual(2)
    })

    it('should handle URLs with query parameters and hash', () => {
      const testCase: TestCasePlan = {
        id: 'test-10',
        name: 'URL with Query and Hash',
        type: 'functional',
        priority: 'p1',
        relatedPageIds: [],
        markdownPath: 'url-query-hash.md',
        preconditions: ['Base URL accessible: {{BASE_URL}}'],
        steps: [
          {
            description: 'Navigate to {{BASE_URL}}/products?category=laptops&sort=price',
            expectedResult: 'Products page loads with filtered results',
          },
          {
            description: 'Navigate to {{BASE_URL}}/profile#settings',
            expectedResult: 'Profile settings section is visible',
          },
        ],
      }

      const markdown = buildMarkdownForTestCase(testCase)

      expect(markdown).toContain('{{BASE_URL}}/products?category=laptops&sort=price')
      expect(markdown).toContain('{{BASE_URL}}/profile#settings')
      expect(markdown).not.toMatch(/https?:\/\/[^\s]+/)
    })

    it('should handle LOGIN_BASE_URL when different from BASE_URL', () => {
      const testCase: TestCasePlan = {
        id: 'test-11',
        name: 'Login with Separate URL',
        type: 'functional',
        priority: 'p0',
        relatedPageIds: [],
        markdownPath: 'login-separate.md',
        preconditions: [
          'Base URL accessible: {{BASE_URL}}',
          'Login page accessible: {{LOGIN_BASE_URL}}/auth',
        ],
        steps: [
          {
            description: 'Navigate to {{LOGIN_BASE_URL}}/auth/login',
            expectedResult: 'Login page loads with authentication form',
          },
          {
            description: 'After login, redirect to {{BASE_URL}}/dashboard',
            expectedResult: 'User dashboard is displayed',
          },
        ],
      }

      const markdown = buildMarkdownForTestCase(testCase)

      expect(markdown).toContain('{{BASE_URL}}')
      expect(markdown).toContain('{{LOGIN_BASE_URL}}')
      expect(markdown).toContain('{{LOGIN_BASE_URL}}/auth/login')
      expect(markdown).toContain('{{BASE_URL}}/dashboard')
    })
  })
})
