import { describe, it, expect } from 'vitest'
import { buildMarkdownForTestCase } from '../../src/plan/output.js'
import type { TestCasePlan } from '../../src/plan/types.js'

/**
 * Unit tests for include: steps library reuse (Story 8.3)
 * 
 * Verifies that:
 * - Test cases requiring login automatically include login steps
 * - loginStepsSpec configuration is respected
 * - Include directive is properly formatted
 */

describe('Include Steps Library Reuse', () => {
  describe('requiresLogin detection', () => {
    it('should prepend login include when requiresLogin is explicitly true', () => {
      const testCase: TestCasePlan = {
        id: 'dashboard-view',
        name: 'View Dashboard After Login',
        type: 'functional',
        priority: 'p0',
        relatedPageIds: ['page-dashboard'],
        markdownPath: 'dashboard-view.md',
        requiresLogin: true,
        preconditions: [
          'Base URL accessible: {{BASE_URL}}',
        ],
        steps: [
          {
            description: 'Navigate to {{BASE_URL}}/dashboard',
            expectedResult: 'Dashboard page displays user information',
          },
        ],
      }

      const markdown = buildMarkdownForTestCase(testCase)

      expect(markdown).toContain('## Steps')
      expect(markdown).toContain('1. include: login')
      expect(markdown).toContain('2. Navigate to {{BASE_URL}}/dashboard')
    })

    it('should NOT prepend login include when requiresLogin is explicitly false', () => {
      const testCase: TestCasePlan = {
        id: 'dashboard-view',
        name: 'View Dashboard',
        type: 'functional',
        priority: 'p0',
        relatedPageIds: ['page-dashboard'],
        markdownPath: 'dashboard-view.md',
        requiresLogin: false,
        preconditions: [
          'Base URL accessible: {{BASE_URL}}',
          'User needs authentication',
        ],
        steps: [
          {
            description: 'Navigate to {{BASE_URL}}/dashboard',
            expectedResult: 'Dashboard page displays user information',
          },
        ],
      }

      const markdown = buildMarkdownForTestCase(testCase)

      expect(markdown).not.toContain('include: login')
      expect(markdown).toContain('1. Navigate to {{BASE_URL}}/dashboard')
    })

    it('should prepend login include for "needs to log in" precondition', () => {
      const testCase: TestCasePlan = {
        id: 'dashboard-view',
        name: 'View Dashboard After Login',
        type: 'functional',
        priority: 'p0',
        relatedPageIds: ['page-dashboard'],
        markdownPath: 'dashboard-view.md',
        preconditions: [
          'Base URL accessible: {{BASE_URL}}',
          'User needs to log in',
        ],
        steps: [
          {
            description: 'Navigate to {{BASE_URL}}/dashboard',
            expectedResult: 'Dashboard page displays user information',
          },
        ],
      }

      const markdown = buildMarkdownForTestCase(testCase)

      expect(markdown).toContain('## Steps')
      expect(markdown).toContain('1. include: login')
      expect(markdown).toContain('2. Navigate to {{BASE_URL}}/dashboard')
    })

    it('should NOT prepend login include for "already logged in" precondition', () => {
      const testCase: TestCasePlan = {
        id: 'dashboard-view',
        name: 'View Dashboard',
        type: 'functional',
        priority: 'p0',
        relatedPageIds: ['page-dashboard'],
        markdownPath: 'dashboard-view.md',
        preconditions: [
          'Base URL accessible: {{BASE_URL}}',
          'User is already logged in with valid credentials',
        ],
        steps: [
          {
            description: 'Navigate to {{BASE_URL}}/dashboard',
            expectedResult: 'Dashboard page displays user information',
          },
        ],
      }

      const markdown = buildMarkdownForTestCase(testCase)

      expect(markdown).not.toContain('include: login')
      expect(markdown).toContain('1. Navigate to {{BASE_URL}}/dashboard')
    })

    it('should prepend login include for test cases with credential variables', () => {
      const testCase: TestCasePlan = {
        id: 'profile-update',
        name: 'Update User Profile',
        type: 'functional',
        priority: 'p1',
        relatedPageIds: ['page-profile'],
        markdownPath: 'profile-update.md',
        preconditions: [
          'Base URL accessible: {{BASE_URL}}',
          'Valid test account available (via AUTOQA_USERNAME / AUTOQA_PASSWORD)',
        ],
        steps: [
          {
            description: 'Navigate to {{LOGIN_BASE_URL}}/login',
            expectedResult: 'Login page loads',
          },
          {
            description: 'Fill username with {{USERNAME}}',
            expectedResult: 'Username field is filled',
          },
        ],
      }

      const markdown = buildMarkdownForTestCase(testCase)

      expect(markdown).toContain('1. include: login')
    })

    it('should NOT prepend login include for public pages', () => {
      const testCase: TestCasePlan = {
        id: 'home-page',
        name: 'View Home Page',
        type: 'functional',
        priority: 'p1',
        relatedPageIds: ['page-home'],
        markdownPath: 'home-page.md',
        preconditions: [
          'Base URL accessible: {{BASE_URL}}',
        ],
        steps: [
          {
            description: 'Navigate to {{BASE_URL}}/',
            expectedResult: 'Home page displays',
          },
        ],
      }

      const markdown = buildMarkdownForTestCase(testCase)

      expect(markdown).not.toContain('include: login')
      expect(markdown).toContain('1. Navigate to {{BASE_URL}}/')
    })
  })

  describe('loginStepsSpec configuration', () => {
    it('should use custom loginStepsSpec when provided', () => {
      const testCase: TestCasePlan = {
        id: 'admin-login',
        name: 'Admin Login Test',
        type: 'functional',
        priority: 'p0',
        relatedPageIds: ['page-admin'],
        markdownPath: 'admin-login.md',
        preconditions: [
          'Login page accessible: {{LOGIN_BASE_URL}}/admin/login',
          'User needs to authenticate',
        ],
        steps: [
          {
            description: 'Navigate to {{BASE_URL}}/admin',
            expectedResult: 'Admin dashboard displays',
          },
        ],
      }

      const markdown = buildMarkdownForTestCase(testCase, { loginStepsSpec: 'admin/login' })

      expect(markdown).toContain('1. include: admin/login')
    })

    it('should default to "login" when loginStepsSpec is not provided', () => {
      const testCase: TestCasePlan = {
        id: 'user-login',
        name: 'User Login Test',
        type: 'functional',
        priority: 'p0',
        relatedPageIds: ['page-user'],
        markdownPath: 'user-login.md',
        preconditions: [
          'User needs to log in',
        ],
        steps: [
          {
            description: 'Navigate to {{BASE_URL}}/profile',
            expectedResult: 'Profile page displays',
          },
        ],
      }

      const markdown = buildMarkdownForTestCase(testCase)

      expect(markdown).toContain('1. include: login')
    })

    it('should handle loginStepsSpec with .md extension', () => {
      const testCase: TestCasePlan = {
        id: 'polyv-login',
        name: 'Polyv Login Test',
        type: 'functional',
        priority: 'p0',
        relatedPageIds: ['page-polyv'],
        markdownPath: 'polyv-login.md',
        preconditions: [
          'User needs authentication',
        ],
        steps: [
          {
            description: 'Navigate to {{BASE_URL}}/console',
            expectedResult: 'Console displays',
          },
        ],
      }

      const markdown = buildMarkdownForTestCase(testCase, { loginStepsSpec: 'polyv/login.md' })

      expect(markdown).toContain('1. include: polyv/login.md')
    })
  })

  describe('step numbering with include', () => {
    it('should correctly number steps after include directive', () => {
      const testCase: TestCasePlan = {
        id: 'multi-step-with-login',
        name: 'Multi-Step Test with Login',
        type: 'functional',
        priority: 'p1',
        relatedPageIds: ['page-test'],
        markdownPath: 'multi-step.md',
        requiresLogin: true,
        preconditions: [
          'Base URL accessible: {{BASE_URL}}',
        ],
        steps: [
          {
            description: 'Navigate to {{BASE_URL}}/step1',
            expectedResult: 'Step 1 page loads',
          },
          {
            description: 'Click the "Next" button',
            expectedResult: 'Step 2 page loads',
          },
          {
            description: 'Fill the form and submit',
            expectedResult: 'Success message appears',
          },
        ],
      }

      const markdown = buildMarkdownForTestCase(testCase)

      expect(markdown).toContain('1. include: login')
      expect(markdown).toContain('2. Navigate to {{BASE_URL}}/step1')
      expect(markdown).toContain('3. Click the "Next" button')
      expect(markdown).toContain('4. Fill the form and submit')
    })
  })
})
