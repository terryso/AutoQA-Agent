/**
 * End-to-end tests for Story 8.1: Login include integration
 * 
 * Validates that:
 * 1. Planner automatically inserts `include: login` for test cases requiring authentication
 * 2. Runner can resolve and expand the include directive from steps/ directory
 * 3. The entire flow works seamlessly without manual intervention
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildMarkdownForTestCase } from '../../src/plan/output.js'
import { parseMarkdownSpec } from '../../src/markdown/parse-markdown-spec.js'
import { expandIncludes } from '../../src/markdown/include.js'
import type { TestCasePlan } from '../../src/plan/types.js'
import { readFileSync } from 'node:fs'

describe('Login Include E2E Integration', () => {
  const testCwd = resolve(process.cwd(), 'tests', 'fixtures', 'login-include-e2e')
  const stepsDir = resolve(testCwd, 'steps')
  const specsStepsDir = resolve(testCwd, 'specs', 'steps')

  beforeEach(async () => {
    await rm(testCwd, { recursive: true, force: true })
    await mkdir(stepsDir, { recursive: true })
    await mkdir(specsStepsDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testCwd, { recursive: true, force: true })
  })

  describe('Planner generates include directive', () => {
    it('should auto-insert include: login for test cases with login preconditions', () => {
      const testCase: TestCasePlan = {
        id: 'login-test-1',
        name: 'User Login Flow',
        type: 'form',
        priority: 'p0',
        relatedPageIds: ['login', 'dashboard'],
        markdownPath: 'auth/login.md',
        preconditions: [
          'Valid test account available (via AUTOQA_USERNAME / AUTOQA_PASSWORD environment variables)',
          'Base URL accessible: {{BASE_URL}}',
        ],
        steps: [
          {
            description: 'Navigate to {{BASE_URL}}/dashboard',
            expectedResult: 'Dashboard page loads with user information',
          },
          {
            description: 'Verify the page shows "Welcome {{USERNAME}}"',
            expectedResult: 'Welcome message displays username',
          },
        ],
      }

      const markdown = buildMarkdownForTestCase(testCase)

      // Verify include directive is present
      expect(markdown).toContain('1. include: login')
      expect(markdown).toContain('2. Navigate to {{BASE_URL}}/dashboard')
      expect(markdown).toContain('3. Verify the page shows "Welcome {{USERNAME}}"')
    })

    it('should auto-insert include: login for test cases with credential template variables', () => {
      const testCase: TestCasePlan = {
        id: 'profile-test-1',
        name: 'Update User Profile',
        type: 'form',
        priority: 'p1',
        relatedPageIds: ['profile'],
        markdownPath: 'user/profile.md',
        preconditions: ['User is logged in'],
        steps: [
          {
            description: 'Navigate to {{BASE_URL}}/profile',
            expectedResult: 'Profile page loads',
          },
          {
            description: 'Fill the "email" field with {{USERNAME}}@example.com',
            expectedResult: 'Email is updated',
          },
        ],
      }

      const markdown = buildMarkdownForTestCase(testCase, { loginStepsSpec: 'login' })

      // Verify include directive is present
      expect(markdown).toContain('1. include: login')
      expect(markdown).toContain('2. Navigate to {{BASE_URL}}/profile')
    })

    it('should NOT insert include for test cases without login requirements', () => {
      const testCase: TestCasePlan = {
        id: 'public-test-1',
        name: 'Browse Public Products',
        type: 'navigation',
        priority: 'p2',
        relatedPageIds: ['products'],
        markdownPath: 'public/products.md',
        preconditions: ['Base URL accessible: {{BASE_URL}}'],
        steps: [
          {
            description: 'Navigate to {{BASE_URL}}/products',
            expectedResult: 'Products page loads',
          },
          {
            description: 'Verify at least one product is visible',
            expectedResult: 'Product list is displayed',
          },
        ],
      }

      const markdown = buildMarkdownForTestCase(testCase)

      // Verify NO include directive is present
      expect(markdown).not.toContain('include:')
      expect(markdown).toContain('1. Navigate to {{BASE_URL}}/products')
      expect(markdown).toContain('2. Verify at least one product is visible')
    })

    it('should generate markdown with include for login-required test case', async () => {
      const testCase: TestCasePlan = {
        id: 'polyv-login-flow',
        name: 'Polyv Login Flow',
        type: 'form',
        priority: 'p0',
        relatedPageIds: ['page-login'],
        markdownPath: 'polyv-login-flow.md',
        requiresLogin: true,
        preconditions: [
          'Valid Polyv account available',
        ],
        steps: [
          {
            description: 'Navigate to {{BASE_URL}}/live',
            expectedResult: 'Live page loads',
          },
        ],
      }

      const markdown = buildMarkdownForTestCase(testCase)

      // Verify include directive is present
      expect(markdown).toContain('1. include: login')
      expect(markdown).toContain('2. Navigate to {{BASE_URL}}/live')
    })

    it('should support custom loginStepsSpec path', () => {
      const testCase: TestCasePlan = {
        id: 'polyv-test-1',
        name: 'Polyv Login Flow',
        type: 'form',
        priority: 'p0',
        relatedPageIds: ['login'],
        markdownPath: 'polyv/login-test.md',
        requiresLogin: true,
        preconditions: ['Valid Polyv account available'],
        steps: [
          {
            description: 'Navigate to {{BASE_URL}}/live',
            expectedResult: 'Live page loads',
          },
        ],
      }

      const markdown = buildMarkdownForTestCase(testCase, { loginStepsSpec: 'polyv/login.md' })

      // Verify custom include path is used
      expect(markdown).toContain('1. include: polyv/login.md')
      expect(markdown).toContain('2. Navigate to {{BASE_URL}}/live')
    })
  })

  describe('Runner resolves and expands include directive', () => {
    it('should resolve include from steps/ directory', async () => {
      // Create login steps file in steps/
      const loginStepsContent = `# Login Steps

## Steps
1. Navigate to {{LOGIN_BASE_URL}}/login
   - Expected: Login page loads
2. Fill the "username" field with {{USERNAME}}
   - Expected: Username is entered
3. Fill the "password" field with {{PASSWORD}}
   - Expected: Password is entered
4. Click the "Login" button
   - Expected: User is redirected to dashboard
`
      await writeFile(resolve(stepsDir, 'login.md'), loginStepsContent, 'utf-8')

      // Create a test spec with include directive
      const testCase: TestCasePlan = {
        id: 'test-1',
        name: 'Dashboard Access',
        type: 'functional',
        priority: 'p0',
        relatedPageIds: ['dashboard'],
        markdownPath: 'dashboard.md',
        requiresLogin: true,
        preconditions: ['Valid test account available'],
        steps: [
          {
            description: 'Navigate to {{BASE_URL}}/dashboard',
            expectedResult: 'Dashboard loads',
          },
        ],
      }

      const markdown = buildMarkdownForTestCase(testCase, { loginStepsSpec: 'login' })
      const parseResult = parseMarkdownSpec(markdown)

      expect(parseResult.ok).toBe(true)
      if (!parseResult.ok) return

      // Expand includes
      const readFile = (path: string) => {
        try {
          return readFileSync(path, 'utf-8')
        } catch {
          return null
        }
      }

      const expandResult = expandIncludes(
        parseResult.value.steps.map(s => s.text),
        testCwd,
        readFile
      )

      expect(expandResult.ok).toBe(true)
      if (!expandResult.ok) return

      // Verify login steps are expanded
      expect(expandResult.value).toHaveLength(5) // 4 login steps + 1 original step
      expect(expandResult.value[0]).toContain('Navigate to {{LOGIN_BASE_URL}}/login')
      expect(expandResult.value[1]).toContain('Fill the "username" field with {{USERNAME}}')
      expect(expandResult.value[2]).toContain('Fill the "password" field with {{PASSWORD}}')
      expect(expandResult.value[3]).toContain('Click the "Login" button')
      expect(expandResult.value[4]).toContain('Navigate to {{BASE_URL}}/dashboard')
    })

    it('should fallback to specs/steps/ when steps/ does not exist', async () => {
      // Create login steps file ONLY in specs/steps/
      const loginStepsContent = `# Login Steps

## Steps
1. Navigate to {{LOGIN_BASE_URL}}/login
2. Fill username with {{USERNAME}}
3. Fill password with {{PASSWORD}}
4. Click submit
`
      await writeFile(resolve(specsStepsDir, 'login.md'), loginStepsContent, 'utf-8')

      const testCase: TestCasePlan = {
        id: 'test-2',
        name: 'Fallback Test',
        type: 'functional',
        priority: 'p0',
        relatedPageIds: ['page'],
        markdownPath: 'fallback.md',
        requiresLogin: true,
        preconditions: ['User needs to be logged in'],
        steps: [
          {
            description: 'Verify dashboard is visible',
            expectedResult: 'Dashboard appears',
          },
        ],
      }

      const markdown = buildMarkdownForTestCase(testCase, { loginStepsSpec: 'login' })
      const parseResult = parseMarkdownSpec(markdown)

      expect(parseResult.ok).toBe(true)
      if (!parseResult.ok) return

      const readFile = (path: string) => {
        try {
          return readFileSync(path, 'utf-8')
        } catch {
          return null
        }
      }

      const expandResult = expandIncludes(
        parseResult.value.steps.map(s => s.text),
        testCwd,
        readFile
      )

      expect(expandResult.ok).toBe(true)
      if (!expandResult.ok) return

      // Verify login steps from fallback location are expanded
      expect(expandResult.value).toHaveLength(5) // 4 login steps + 1 original step
      expect(expandResult.value[0]).toContain('Navigate to {{LOGIN_BASE_URL}}/login')
      expect(expandResult.value[4]).toContain('Verify dashboard is visible')
    })

    it('should resolve relative path includes like polyv/login.md', async () => {
      // Create nested login steps file
      const polyvDir = resolve(stepsDir, 'polyv')
      await mkdir(polyvDir, { recursive: true })

      const polyvLoginContent = `# Polyv Login Steps

## Steps
1. Navigate to {{LOGIN_BASE_URL}}/polyv/login
2. Fill Polyv username with {{USERNAME}}
3. Fill Polyv password with {{PASSWORD}}
4. Click Polyv login button
`
      await writeFile(resolve(polyvDir, 'login.md'), polyvLoginContent, 'utf-8')

      const testCase: TestCasePlan = {
        id: 'polyv-test',
        name: 'Polyv Feature Test',
        type: 'functional',
        priority: 'p0',
        relatedPageIds: ['polyv'],
        markdownPath: 'polyv/feature.md',
        requiresLogin: true,
        preconditions: ['Polyv account available'],
        steps: [
          {
            description: 'Navigate to {{BASE_URL}}/polyv/live',
            expectedResult: 'Live page loads',
          },
        ],
      }

      const markdown = buildMarkdownForTestCase(testCase, { loginStepsSpec: 'polyv/login.md' })
      const parseResult = parseMarkdownSpec(markdown)

      expect(parseResult.ok).toBe(true)
      if (!parseResult.ok) return

      const readFile = (path: string) => {
        try {
          return readFileSync(path, 'utf-8')
        } catch {
          return null
        }
      }

      const expandResult = expandIncludes(
        parseResult.value.steps.map(s => s.text),
        testCwd,
        readFile
      )

      expect(expandResult.ok).toBe(true)
      if (!expandResult.ok) return

      // Verify Polyv-specific login steps are expanded
      expect(expandResult.value).toHaveLength(5)
      expect(expandResult.value[0]).toContain('Navigate to {{LOGIN_BASE_URL}}/polyv/login')
      expect(expandResult.value[1]).toContain('Fill Polyv username')
      expect(expandResult.value[4]).toContain('Navigate to {{BASE_URL}}/polyv/live')
    })

    it('should return error when include file is not found', async () => {
      // Do NOT create any login steps file

      const testCase: TestCasePlan = {
        id: 'test-3',
        name: 'Missing Include Test',
        type: 'functional',
        priority: 'p0',
        relatedPageIds: ['page'],
        markdownPath: 'missing.md',
        requiresLogin: true,
        preconditions: ['User must be logged in'],
        steps: [
          {
            description: 'Do something',
            expectedResult: 'Something happens',
          },
        ],
      }

      const markdown = buildMarkdownForTestCase(testCase, { loginStepsSpec: 'login' })
      const parseResult = parseMarkdownSpec(markdown)

      expect(parseResult.ok).toBe(true)
      if (!parseResult.ok) return

      const readFile = (path: string) => {
        try {
          return readFileSync(path, 'utf-8')
        } catch {
          return null
        }
      }

      const expandResult = expandIncludes(
        parseResult.value.steps.map(s => s.text),
        testCwd,
        readFile
      )

      // Should fail with file not found error
      expect(expandResult.ok).toBe(false)
      if (expandResult.ok) return

      expect(expandResult.error.code).toBe('INCLUDE_FILE_NOT_FOUND')
      expect(expandResult.error.message).toContain('login')
      expect(expandResult.error.message).toContain('steps/login.md')
    })
  })
})
