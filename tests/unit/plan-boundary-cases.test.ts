import { describe, it, expect } from 'vitest'
import { buildMarkdownForTestCase } from '../../src/plan/output.js'
import type { TestCasePlan } from '../../src/plan/types.js'

/**
 * Unit tests for boundary and negative case generation (Story 8.3)
 * 
 * Verifies that:
 * - Boundary test cases are properly structured
 * - Negative cases include appropriate error expectations
 * - Markdown output preserves quality constraints
 */

describe('Boundary and Negative Case Generation', () => {
  describe('buildMarkdownForTestCase with boundary cases', () => {
    it('should generate markdown for boundary case with empty input validation', () => {
      const testCase: TestCasePlan = {
        id: 'search-empty-input',
        name: 'Search with Empty Input',
        type: 'boundary',
        priority: 'p1',
        relatedPageIds: ['page-1'],
        markdownPath: 'search-empty-input.md',
        preconditions: [
          'Base URL accessible: {{BASE_URL}}',
          'User is on the search page',
        ],
        steps: [
          {
            description: 'Navigate to {{BASE_URL}}/search',
            expectedResult: 'Search page loads successfully',
          },
          {
            description: 'Click the "Search" button without entering any text',
            expectedResult: 'Error message "Search term is required" appears',
          },
        ],
      }

      const markdown = buildMarkdownForTestCase(testCase)

      expect(markdown).toContain('# Search with Empty Input (Auto-generated)')
      expect(markdown).toContain('Type: boundary')
      expect(markdown).toContain('## Preconditions')
      expect(markdown).toContain('Base URL accessible: {{BASE_URL}}')
      expect(markdown).toContain('## Steps')
      expect(markdown).toContain('Navigate to {{BASE_URL}}/search')
      expect(markdown).toContain('Expected: Search page loads successfully')
      expect(markdown).toContain('Error message "Search term is required" appears')
    })

    it('should generate markdown for negative case with invalid credentials', () => {
      const testCase: TestCasePlan = {
        id: 'login-invalid-credentials',
        name: 'Login with Invalid Credentials',
        type: 'boundary',
        priority: 'p0',
        relatedPageIds: ['page-login'],
        markdownPath: 'login-invalid-credentials.md',
        preconditions: [
          'Login page accessible: {{LOGIN_BASE_URL}}/login',
          'User is logged out',
        ],
        steps: [
          {
            description: 'Navigate to {{LOGIN_BASE_URL}}/login',
            expectedResult: 'Login page displays with username and password fields',
          },
          {
            description: 'Fill the "Username" field with "invalid_user"',
            expectedResult: 'Username field contains "invalid_user"',
          },
          {
            description: 'Fill the "Password" field with "wrong_password"',
            expectedResult: 'Password field is filled (masked)',
          },
          {
            description: 'Click the "Login" button',
            expectedResult: 'Error message "Invalid username or password" appears and user remains on login page',
          },
        ],
      }

      const markdown = buildMarkdownForTestCase(testCase)

      expect(markdown).toContain('# Login with Invalid Credentials (Auto-generated)')
      expect(markdown).toContain('Type: boundary')
      expect(markdown).toContain('Priority: P0')
      expect(markdown).toContain('User is logged out')
      expect(markdown).toContain('Invalid username or password')
    })

    it('should handle boundary case with maximum length input', () => {
      const testCase: TestCasePlan = {
        id: 'form-max-length',
        name: 'Form Submission with Maximum Length Input',
        type: 'boundary',
        priority: 'p2',
        relatedPageIds: ['page-form'],
        markdownPath: 'form-max-length.md',
        preconditions: [
          'Base URL accessible: {{BASE_URL}}',
          'Form page is accessible',
        ],
        steps: [
          {
            description: 'Navigate to {{BASE_URL}}/contact',
            expectedResult: 'Contact form page loads',
          },
          {
            description: 'Fill the "Message" field with 1000 characters',
            expectedResult: 'Message field accepts input up to maximum length',
          },
          {
            description: 'Attempt to enter additional characters beyond 1000',
            expectedResult: 'Input is truncated or prevented, character counter shows 1000/1000',
          },
        ],
      }

      const markdown = buildMarkdownForTestCase(testCase)

      expect(markdown).toContain('Maximum Length Input')
      expect(markdown).toContain('1000 characters')
      expect(markdown).toContain('truncated or prevented')
    })
  })

  describe('Quality constraints for boundary cases', () => {
    it('should preserve specific expected results in boundary cases', () => {
      const testCase: TestCasePlan = {
        id: 'search-no-results',
        name: 'Search with No Results',
        type: 'boundary',
        priority: 'p1',
        relatedPageIds: ['page-search'],
        markdownPath: 'search-no-results.md',
        preconditions: ['Base URL accessible: {{BASE_URL}}'],
        steps: [
          {
            description: 'Navigate to {{BASE_URL}}/search',
            expectedResult: 'Search page loads',
          },
          {
            description: 'Fill the search field with "xyznonexistentquery123"',
            expectedResult: 'Search field contains the query',
          },
          {
            description: 'Click the "Search" button',
            expectedResult: 'Message "No results found for \'xyznonexistentquery123\'" is displayed',
          },
        ],
      }

      const markdown = buildMarkdownForTestCase(testCase)

      // Verify all expected results are preserved
      expect(markdown).toContain('Expected: Search page loads')
      expect(markdown).toContain('Expected: Search field contains the query')
      expect(markdown).toContain('Expected: Message "No results found')
    })

    it('should maintain clear preconditions for negative test cases', () => {
      const testCase: TestCasePlan = {
        id: 'unauthorized-access',
        name: 'Unauthorized Access to Protected Resource',
        type: 'security',
        priority: 'p0',
        relatedPageIds: ['page-admin'],
        markdownPath: 'unauthorized-access.md',
        preconditions: [
          'Base URL accessible: {{BASE_URL}}',
          'User is logged out',
          'Protected admin page exists at {{BASE_URL}}/admin',
        ],
        steps: [
          {
            description: 'Navigate to {{BASE_URL}}/admin',
            expectedResult: 'User is redirected to login page or sees "Access Denied" message',
          },
        ],
      }

      const markdown = buildMarkdownForTestCase(testCase)

      expect(markdown).toContain('User is logged out')
      expect(markdown).toContain('Protected admin page exists')
      expect(markdown).toContain('Access Denied')
    })
  })
})
