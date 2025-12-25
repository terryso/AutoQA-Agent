import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  exportFromIR,
  isSpecExportable,
  toCamelCase,
  generateMeaningfulVarName,
  sanitizeVariableName,
} from '../../src/runner/export-from-ir.js'
import type { MarkdownSpec } from '../../src/markdown/spec-types.js'
import type { ActionRecord } from '../../src/ir/types.js'

describe('export-from-ir', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `export-from-ir-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  async function setupIRFile(records: ActionRecord[]): Promise<string> {
    const runId = 'test-run'
    const irDir = join(testDir, '.autoqa', 'runs', runId)
    await mkdir(irDir, { recursive: true })

    const irPath = join(irDir, 'ir.jsonl')
    const content = records.map((r) => JSON.stringify(r)).join('\n')
    await writeFile(irPath, content, 'utf-8')

    return runId
  }

  function createMockRecord(overrides: Partial<ActionRecord> = {}): ActionRecord {
    return {
      runId: 'test-run',
      specPath: join(testDir, 'specs', 'test.md'),
      stepIndex: 1,
      toolName: 'click',
      toolInput: {},
      outcome: { ok: true },
      timestamp: Date.now(),
      ...overrides,
    }
  }

  function createMockSpec(): MarkdownSpec {
    return {
      preconditions: ['Base URL accessible'],
      steps: [
        { index: 1, text: 'Navigate to /', kind: 'action' },
        { index: 2, text: "Fill the 'Username' field with testuser", kind: 'action' },
        { index: 3, text: "Click the 'Login' button", kind: 'action' },
        { index: 4, text: "Verify the page shows 'Dashboard'", kind: 'assertion' },
      ],
    }
  }

  describe('exportFromIR', () => {
    it('exports a valid Playwright test file', async () => {
      const specPath = join(testDir, 'specs', 'test.md')
      const spec = createMockSpec()

      const records: ActionRecord[] = [
        createMockRecord({
          specPath,
          stepIndex: 1,
          toolName: 'navigate',
          toolInput: { url: '/' },
        }),
        createMockRecord({
          specPath,
          stepIndex: 2,
          toolName: 'fill',
          toolInput: { textLength: 8, fillValue: { kind: 'literal', value: 'testuser' } },
          element: {
            fingerprint: { tagName: 'input' },
            locatorCandidates: [],
            chosenLocator: {
              kind: 'getByTestId',
              value: 'username',
              code: "page.getByTestId('username')",
              validation: { unique: true },
            },
          },
        }),
        createMockRecord({
          specPath,
          stepIndex: 3,
          toolName: 'click',
          toolInput: {},
          element: {
            fingerprint: { tagName: 'button' },
            locatorCandidates: [],
            chosenLocator: {
              kind: 'getByRole',
              value: 'button',
              code: "page.getByRole('button', { name: 'Login' })",
              validation: { unique: true },
            },
          },
        }),
        createMockRecord({
          specPath,
          stepIndex: 4,
          toolName: 'assertTextPresent',
          toolInput: { text: 'Dashboard', visibleNth: 0 },
        }),
      ]

      const runId = await setupIRFile(records)

      const result = await exportFromIR({
        cwd: testDir,
        runId,
        specPath,
        spec,
        baseUrl: 'https://example.com',
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.relativePath).toBe('tests/autoqa/specs-test.spec.ts')

        const content = await readFile(result.exportPath, 'utf-8')
        expect(content).toContain("import { test, expect } from '@playwright/test'")
        expect(content).toContain('loadEnvFiles()')
        expect(content).toContain("const baseUrl = getEnvVar('AUTOQA_BASE_URL')")
        expect(content).toContain('page.goto')
        expect(content).toContain("page.getByTestId('username').fill")
        expect(content).toContain("page.getByRole('button', { name: 'Login' }).click()")
        expect(content).toContain("page.getByText('Dashboard')")
      }
    })

    it('uses IR toolName as single source of truth (regression test for select bug)', async () => {
      // This test verifies the fix for the bug where:
      // - Spec step text: "选择 '活动营销' 从 导航菜单" (matches parseSelectStep pattern)
      // - IR toolName: 'click' (actual action performed)
      // - Old behavior: generated .selectOption() (WRONG - based on text parsing)
      // - New behavior: generated .click() (CORRECT - based on IR toolName)

      const specPath = join(testDir, 'specs', 'test.md')
      const spec: MarkdownSpec = {
        preconditions: ['Base URL accessible'],
        steps: [
          { index: 1, text: "选择 '活动营销' 从 导航菜单", kind: 'action' },
        ],
      }

      const records: ActionRecord[] = [
        createMockRecord({
          specPath,
          stepIndex: 1,
          toolName: 'click',  // IR says it's a click, not select
          toolInput: {},
          element: {
            fingerprint: { tagName: 'span', textSnippet: '活动营销' },
            locatorCandidates: [],
            chosenLocator: {
              kind: 'textExact',
              value: '活动营销',
              code: "page.getByText('活动营销', { exact: true })",
              validation: { unique: true, visible: true, enabled: true },
            },
          },
        }),
      ]

      const runId = await setupIRFile(records)

      const result = await exportFromIR({
        cwd: testDir,
        runId,
        specPath,
        spec,
        baseUrl: 'https://example.com',
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        const content = await readFile(result.exportPath, 'utf-8')
        // Should generate click (based on IR toolName), not selectOption
        expect(content).toContain("page.getByText('活动营销', { exact: true }).click()")
        // Should NOT contain selectOption (the old bug would generate this)
        expect(content).not.toContain('.selectOption')
      }
    })

    it('generates selectOption when IR toolName is select_option', async () => {
      const specPath = join(testDir, 'specs', 'test.md')
      const spec: MarkdownSpec = {
        preconditions: ['Base URL accessible'],
        steps: [
          { index: 1, text: "Select 'Option A' from the 'Dropdown'", kind: 'action' },
        ],
      }

      const records: ActionRecord[] = [
        createMockRecord({
          specPath,
          stepIndex: 1,
          toolName: 'select_option',
          toolInput: { label: 'Option A' },
          element: {
            fingerprint: { tagName: 'select' },
            locatorCandidates: [],
            chosenLocator: {
              kind: 'getByTestId',
              value: 'dropdown',
              code: "page.getByTestId('dropdown')",
              validation: { unique: true },
            },
          },
        }),
      ]

      const runId = await setupIRFile(records)

      const result = await exportFromIR({
        cwd: testDir,
        runId,
        specPath,
        spec,
        baseUrl: 'https://example.com',
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        const content = await readFile(result.exportPath, 'utf-8')
        expect(content).toContain("page.getByTestId('dropdown').selectOption")
        expect(content).toContain("label: 'Option A'")
      }
    })

    it('generates TODO comment when step has no IR record', async () => {
      const specPath = join(testDir, 'specs', 'test.md')
      const spec: MarkdownSpec = {
        preconditions: ['Base URL accessible'],
        steps: [
          { index: 1, text: 'Navigate to /', kind: 'action' },
          { index: 2, text: "Verify the page shows 'Products'", kind: 'assertion' },
        ],
      }

      const records: ActionRecord[] = [
        createMockRecord({
          specPath,
          stepIndex: 1,
          toolName: 'navigate',
          toolInput: { url: '/' },
        }),
        // No IR record for step 2
      ]

      const runId = await setupIRFile(records)

      const result = await exportFromIR({
        cwd: testDir,
        runId,
        specPath,
        spec,
        baseUrl: 'https://example.com',
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        const content = await readFile(result.exportPath, 'utf-8')
        expect(content).toContain('// TODO: Step 2 - No IR record found')
      }
    })

    it('fails when no IR records found for spec', async () => {
      const specPath = join(testDir, 'specs', 'test.md')
      const spec: MarkdownSpec = {
        preconditions: ['Base URL accessible'],
        steps: [{ index: 1, text: 'Navigate to /', kind: 'action' }],
      }

      const runId = await setupIRFile([])

      const result = await exportFromIR({
        cwd: testDir,
        runId,
        specPath,
        spec,
        baseUrl: 'https://example.com',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('No IR records found')
      }
    })

    it('fails when element-targeting action is missing chosenLocator', async () => {
      const specPath = join(testDir, 'specs', 'test.md')
      const spec: MarkdownSpec = {
        preconditions: ['Base URL accessible'],
        steps: [
          { index: 1, text: "Click the 'Login' button", kind: 'action' },
        ],
      }

      const records: ActionRecord[] = [
        createMockRecord({
          specPath,
          stepIndex: 1,
          toolName: 'click',
          toolInput: {},
          // No element/chosenLocator
        }),
      ]

      const runId = await setupIRFile(records)

      const result = await exportFromIR({
        cwd: testDir,
        runId,
        specPath,
        spec,
        baseUrl: 'https://example.com',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('missing valid chosenLocator')
      }
    })

    it('generates assertElementVisible code correctly', async () => {
      const specPath = join(testDir, 'specs', 'test.md')
      const spec: MarkdownSpec = {
        preconditions: ['Base URL accessible'],
        steps: [
          { index: 1, text: 'Navigate to /', kind: 'action' },
          { index: 2, text: "Assert that 'Login' button is visible", kind: 'assertion' },
        ],
      }

      const records: ActionRecord[] = [
        createMockRecord({
          specPath,
          stepIndex: 1,
          toolName: 'navigate',
          toolInput: { url: '/' },
        }),
        createMockRecord({
          specPath,
          stepIndex: 2,
          toolName: 'assertElementVisible',
          toolInput: {},
          element: {
            fingerprint: { tagName: 'button' },
            locatorCandidates: [],
            chosenLocator: {
              kind: 'getByRole',
              value: 'button:Login',
              code: "page.getByRole('button', { name: 'Login' })",
              validation: { unique: true },
            },
          },
        }),
      ]

      const runId = await setupIRFile(records)

      const result = await exportFromIR({
        cwd: testDir,
        runId,
        specPath,
        spec,
        baseUrl: 'https://example.com',
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        const content = await readFile(result.exportPath, 'utf-8')
        expect(content).toContain("page.getByRole('button', { name: 'Login' })")
        expect(content).toContain('toHaveCount(1)')
        expect(content).toContain('toBeVisible()')
      }
    })

    it('handles fill with template_var fillValue', async () => {
      const specPath = join(testDir, 'specs', 'test.md')
      const spec: MarkdownSpec = {
        preconditions: ['Base URL accessible'],
        steps: [
          { index: 1, text: "Fill the 'Username' field with standard_user", kind: 'action' },
        ],
      }

      const records: ActionRecord[] = [
        createMockRecord({
          specPath,
          stepIndex: 1,
          toolName: 'fill',
          toolInput: {
            textLength: 13,
            fillValue: { kind: 'template_var', name: 'USERNAME' },
          },
          element: {
            fingerprint: { tagName: 'input' },
            locatorCandidates: [],
            chosenLocator: {
              kind: 'getByTestId',
              value: 'username',
              code: "page.getByTestId('username')",
              validation: { unique: true },
            },
          },
        }),
      ]

      const runId = await setupIRFile(records)

      const result = await exportFromIR({
        cwd: testDir,
        runId,
        specPath,
        spec,
        baseUrl: 'https://example.com',
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        const content = await readFile(result.exportPath, 'utf-8')
        expect(content).toContain("const username = getEnvVar('AUTOQA_USERNAME')")
        expect(content).toContain("page.getByTestId('username').fill(username)")
        expect(content).not.toContain(".fill('standard_user')")
      }
    })

    it('handles fill with literal fillValue', async () => {
      const specPath = join(testDir, 'specs', 'test.md')
      const spec: MarkdownSpec = {
        preconditions: ['Base URL accessible'],
        steps: [
          { index: 1, text: "Fill the search field with 暖场", kind: 'action' },
        ],
      }

      const records: ActionRecord[] = [
        createMockRecord({
          specPath,
          stepIndex: 1,
          toolName: 'fill',
          toolInput: {
            textLength: 2,
            fillValue: { kind: 'literal', value: '暖场' },
          },
          element: {
            fingerprint: { tagName: 'input' },
            locatorCandidates: [],
            chosenLocator: {
              kind: 'getByPlaceholder',
              value: '输入直播名称或频道号',
              code: "page.getByPlaceholder('输入直播名称或频道号')",
              validation: { unique: true },
            },
          },
        }),
      ]

      const runId = await setupIRFile(records)

      const result = await exportFromIR({
        cwd: testDir,
        runId,
        specPath,
        spec,
        baseUrl: 'https://example.com',
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        const content = await readFile(result.exportPath, 'utf-8')
        expect(content).toContain("page.getByPlaceholder('输入直播名称或频道号').fill('暖场')")
      }
    })

    it('handles navigate with relative URL', async () => {
      const specPath = join(testDir, 'specs', 'test.md')
      const spec: MarkdownSpec = {
        preconditions: ['Base URL accessible'],
        steps: [
          { index: 1, text: 'Navigate to /login', kind: 'action' },
        ],
      }

      const records: ActionRecord[] = [
        createMockRecord({
          specPath,
          stepIndex: 1,
          toolName: 'navigate',
          toolInput: { url: '/login' },
        }),
      ]

      const runId = await setupIRFile(records)

      const result = await exportFromIR({
        cwd: testDir,
        runId,
        specPath,
        spec,
        baseUrl: 'https://example.com',
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        const content = await readFile(result.exportPath, 'utf-8')
        expect(content).toContain("await page.goto(new URL('/login', baseUrl).toString())")
      }
    })

    it('handles navigate with absolute URL from different origin', async () => {
      const specPath = join(testDir, 'specs', 'test.md')
      const spec: MarkdownSpec = {
        preconditions: ['Base URL accessible'],
        steps: [
          { index: 1, text: 'Navigate to https://external.com/page', kind: 'action' },
        ],
      }

      const records: ActionRecord[] = [
        createMockRecord({
          specPath,
          stepIndex: 1,
          toolName: 'navigate',
          toolInput: { url: 'https://external.com/page' },
        }),
      ]

      const runId = await setupIRFile(records)

      const result = await exportFromIR({
        cwd: testDir,
        runId,
        specPath,
        spec,
        baseUrl: 'https://example.com',
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        const content = await readFile(result.exportPath, 'utf-8')
        expect(content).toContain("await page.goto('https://external.com/page')")
      }
    })

    it('uses env vars for template variables in raw spec content', async () => {
      const specPath = join(testDir, 'specs', 'test.md')
      const spec: MarkdownSpec = {
        preconditions: ['Base URL accessible'],
        steps: [
          { index: 1, text: 'Navigate to {{BASE_URL}}/login', kind: 'action' },
        ],
      }

      const rawSpecContent = `## Steps

1. Navigate to {{BASE_URL}}/login
`

      const records: ActionRecord[] = [
        createMockRecord({
          specPath,
          stepIndex: 1,
          toolName: 'navigate',
          toolInput: { url: 'https://example.com/login' }, // Rendered URL
        }),
      ]

      const runId = await setupIRFile(records)

      const result = await exportFromIR({
        cwd: testDir,
        runId,
        specPath,
        spec,
        baseUrl: 'https://example.com',
        rawSpecContent,
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        const content = await readFile(result.exportPath, 'utf-8')
        expect(content).toContain("await page.goto(new URL('/login', baseUrl).toString())")
      }
    })

    it('skips scroll actions but generates code for wait actions', async () => {
      const specPath = join(testDir, 'specs', 'test.md')
      const spec: MarkdownSpec = {
        preconditions: ['Base URL accessible'],
        steps: [
          { index: 1, text: 'Navigate to /', kind: 'action' },
          { index: 2, text: 'Scroll down', kind: 'action' },
          { index: 3, text: 'Wait for 1.5 seconds', kind: 'action' },
          { index: 4, text: "Click the 'Submit' button", kind: 'action' },
        ],
      }

      const records: ActionRecord[] = [
        createMockRecord({
          specPath,
          stepIndex: 1,
          toolName: 'navigate',
          toolInput: { url: '/' },
        }),
        createMockRecord({
          specPath,
          stepIndex: 2,
          toolName: 'scroll',
          toolInput: {},
        }),
        createMockRecord({
          specPath,
          stepIndex: 3,
          toolName: 'wait',
          toolInput: { seconds: 1.5 },
        }),
        createMockRecord({
          specPath,
          stepIndex: 4,
          toolName: 'click',
          toolInput: {},
          element: {
            fingerprint: { tagName: 'button' },
            locatorCandidates: [],
            chosenLocator: {
              kind: 'getByRole',
              value: 'button',
              code: "page.getByRole('button', { name: 'Submit' })",
              validation: { unique: true },
            },
          },
        }),
      ]

      const runId = await setupIRFile(records)

      const result = await exportFromIR({
        cwd: testDir,
        runId,
        specPath,
        spec,
        baseUrl: 'https://example.com',
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        const content = await readFile(result.exportPath, 'utf-8')
        // Should have navigate, click, and wait code
        expect(content).toContain('page.goto')
        expect(content).toContain('.click()')
        expect(content).toContain('await page.waitForTimeout(1500)')
        // Scroll action should not generate code (runtime-only)
        expect(content).not.toContain('scroll')
      }
    })

    it('generates TODO for unsupported tool types', async () => {
      const specPath = join(testDir, 'specs', 'test.md')
      const spec: MarkdownSpec = {
        preconditions: ['Base URL accessible'],
        steps: [
          { index: 1, text: 'Some unknown action', kind: 'action' },
        ],
      }

      // Cast to unknown tool to test error handling
      const records: ActionRecord[] = [
        createMockRecord({
          specPath,
          stepIndex: 1,
          toolName: 'unknown' as any,
          toolInput: {},
        }),
      ]

      const runId = await setupIRFile(records)

      const result = await exportFromIR({
        cwd: testDir,
        runId,
        specPath,
        spec,
        baseUrl: 'https://example.com',
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        const content = await readFile(result.exportPath, 'utf-8')
        expect(content).toContain('// TODO: Step 1 - Unsupported tool')
      }
    })
  })

  describe('isSpecExportable', () => {
    it('returns exportable: true when all actions have valid locators', async () => {
      const specPath = join(testDir, 'specs', 'test.md')

      const records: ActionRecord[] = [
        createMockRecord({
          specPath,
          stepIndex: 1,
          toolName: 'click',
          outcome: { ok: true },
          element: {
            fingerprint: { tagName: 'button' },
            locatorCandidates: [],
            chosenLocator: {
              kind: 'getByTestId',
              value: 'btn',
              code: "page.getByTestId('btn')",
              validation: { unique: true },
            },
          },
        }),
      ]

      const runId = await setupIRFile(records)

      const result = await isSpecExportable(testDir, runId, specPath)
      expect(result.exportable).toBe(true)
    })

    it('returns exportable: false when actions are missing locators', async () => {
      const specPath = join(testDir, 'specs', 'test.md')

      const records: ActionRecord[] = [
        createMockRecord({
          specPath,
          stepIndex: 1,
          toolName: 'click',
          outcome: { ok: true },
          // No element/chosenLocator
        }),
      ]

      const runId = await setupIRFile(records)

      const result = await isSpecExportable(testDir, runId, specPath)
      expect(result.exportable).toBe(false)
      expect(result.reason).toContain('missing valid chosenLocator')
    })

    it('returns exportable: false when no IR records found', async () => {
      const specPath = join(testDir, 'specs', 'test.md')
      const runId = await setupIRFile([])

      const result = await isSpecExportable(testDir, runId, specPath)
      expect(result.exportable).toBe(false)
      expect(result.reason).toContain('No IR records found')
    })
  })

  // ============================================================================
  // toCamelCase function tests
  // ============================================================================

  describe('toCamelCase', () => {
    describe('kebab-case to camelCase', () => {
      it('converts simple kebab-case', () => {
        expect(toCamelCase('account-input')).toBe('accountInput')
        expect(toCamelCase('user-name')).toBe('userName')
      })

      it('converts multi-part kebab-case', () => {
        expect(toCamelCase('login-submit-btn')).toBe('loginSubmitBtn')
        expect(toCamelCase('user-profile-name')).toBe('userProfileName')
      })

      it('handles single word', () => {
        expect(toCamelCase('account')).toBe('account')
        expect(toCamelCase('button')).toBe('button')
      })
    })

    describe('snake_case to camelCase', () => {
      it('converts simple snake_case', () => {
        expect(toCamelCase('account_input')).toBe('accountInput')
        expect(toCamelCase('user_name')).toBe('userName')
      })

      it('converts multi-part snake_case', () => {
        expect(toCamelCase('user_name_field')).toBe('userNameField')
        expect(toCamelCase('login_submit_button')).toBe('loginSubmitButton')
      })
    })

    describe('space separated to camelCase', () => {
      it('converts space separated words', () => {
        expect(toCamelCase('account input')).toBe('accountInput')
        expect(toCamelCase('User Name')).toBe('userName')
        expect(toCamelCase('User Name Field')).toBe('userNameField')
      })
    })

    describe('removes special characters', () => {
      it('removes @ and # characters', () => {
        expect(toCamelCase('account@input#field')).toBe('accountInputField')
      })

      it('removes dot characters', () => {
        expect(toCamelCase('user.name_field')).toBe('userNameField')
        expect(toCamelCase('user.name')).toBe('userName')
      })
    })

    describe('handles Chinese characters', () => {
      it('preserves Chinese characters', () => {
        expect(toCamelCase('请输入直播名称')).toBe('请输入直播名称')
      })

      it('converts mixed Chinese and kebab-case', () => {
        expect(toCamelCase('账号-输入')).toBe('账号输入')
        expect(toCamelCase('user-account-账号')).toBe('userAccount账号')
      })
    })

    describe('makes first letter lowercase', () => {
      it('lowercases first letter of PascalCase', () => {
        expect(toCamelCase('AccountInput')).toBe('accountInput')
        expect(toCamelCase('User')).toBe('user')
      })

      it('only lowercases first letter', () => {
        expect(toCamelCase('ACCOUNT')).toBe('aCCOUNT')
      })
    })

    describe('edge cases', () => {
      it('handles empty string', () => {
        expect(toCamelCase('')).toBe('')
      })

      it('handles special characters only', () => {
        expect(toCamelCase('---')).toBe('')
        expect(toCamelCase('___')).toBe('')
        expect(toCamelCase('@@@')).toBe('')
        expect(toCamelCase('   ')).toBe('')
      })

      it('handles single character', () => {
        expect(toCamelCase('a')).toBe('a')
        expect(toCamelCase('A')).toBe('a')
      })

      it('handles numbers', () => {
        expect(toCamelCase('user123')).toBe('user123')
        expect(toCamelCase('input-field-2')).toBe('inputField2')
      })
    })
  })

  // ============================================================================
  // generateMeaningfulVarName function tests
  // ============================================================================

  describe('generateMeaningfulVarName', () => {
    describe('priority 1: testId', () => {
      it('uses testId when available', () => {
        expect(generateMeaningfulVarName({ testId: 'account' })).toBe('account')
        expect(generateMeaningfulVarName({ testId: 'username' })).toBe('username')
      })

      it('removes common suffixes from testId', () => {
        expect(generateMeaningfulVarName({ testId: 'username-input' })).toBe('username')
        expect(generateMeaningfulVarName({ testId: 'login-button' })).toBe('login')
        expect(generateMeaningfulVarName({ testId: 'submit-btn' })).toBe('submit')
        expect(generateMeaningfulVarName({ testId: 'email-field' })).toBe('email')
        expect(generateMeaningfulVarName({ testId: 'account-input' })).toBe('account')
      })

      it('handles kebab-case testIds', () => {
        expect(generateMeaningfulVarName({ testId: 'user-profile-name-input' })).toBe(
          'userProfileName',
        )
      })

      it('adds suffix parameter when provided', () => {
        expect(generateMeaningfulVarName({ testId: 'input' }, '2')).toBe('input2')
        expect(generateMeaningfulVarName({ testId: 'account' }, '3')).toBe('account3')
      })

      it('converts testId to lowercase before processing', () => {
        expect(generateMeaningfulVarName({ testId: 'Account-Input' })).toBe('account')
        expect(generateMeaningfulVarName({ testId: 'USERNAME-INPUT' })).toBe('username')
      })
    })

    describe('priority 2: placeholder', () => {
      it('uses placeholder when testId not available', () => {
        expect(generateMeaningfulVarName({ placeholder: '请输入手机号' })).toContain('手机号')
      })

      it('removes common Chinese prefixes from placeholder', () => {
        const result = generateMeaningfulVarName({ placeholder: '请输入用户名' })
        expect(result).not.toContain('请输入')
      })

      it('removes common English prefixes from placeholder', () => {
        expect(generateMeaningfulVarName({ placeholder: 'Input username' })).toBe('username')
        expect(generateMeaningfulVarName({ placeholder: 'Enter your email' })).toBe('email')
      })

      it('handles English placeholders', () => {
        expect(generateMeaningfulVarName({ placeholder: 'Enter your email' })).toBe('email')
      })

      it('falls back to original placeholder if empty after stripping', () => {
        // "请输入" stripped would be empty, should use original
        const result = generateMeaningfulVarName({ placeholder: '请输入' })
        expect(result).toBeTruthy()
      })
    })

    describe('priority 3: textSnippet', () => {
      it('uses textSnippet when testId and placeholder not available', () => {
        expect(generateMeaningfulVarName({ textSnippet: '同意并登录' })).toContain('同意并登录')
      })

      it('handles button text snippets', () => {
        expect(generateMeaningfulVarName({ textSnippet: '保存并创建直播' })).toContain(
          '保存并创建直播',
        )
      })

      it('handles English text snippets', () => {
        expect(generateMeaningfulVarName({ textSnippet: 'Save and Create' })).toBe(
          'saveAndCreate',
        )
      })
    })

    describe('priority 4: id attribute', () => {
      it('uses id attribute when higher priorities not available', () => {
        expect(generateMeaningfulVarName({ id: 'input-account' })).toBe('inputAccount')
        expect(generateMeaningfulVarName({ id: 'user_name' })).toBe('userName')
      })
    })

    describe('priority 5: tagName + role', () => {
      it('falls back to role + tagName', () => {
        expect(generateMeaningfulVarName({ role: 'button', tagName: 'button' })).toBe(
          'buttonbutton',
        )
      })

      it('uses only tagName when role not available', () => {
        expect(generateMeaningfulVarName({ tagName: 'input' })).toBe('input')
        expect(generateMeaningfulVarName({ tagName: 'button' })).toBe('button')
      })

      it('uses only role when tagName not available', () => {
        expect(generateMeaningfulVarName({ role: 'textbox' })).toBe('textbox')
        expect(generateMeaningfulVarName({ role: 'button' })).toBe('button')
      })

      it('returns "element" when nothing available', () => {
        expect(generateMeaningfulVarName({})).toBe('element')
      })
    })

    describe('edge cases', () => {
      it('handles empty fingerprint', () => {
        expect(generateMeaningfulVarName({})).toBe('element')
      })

      it('prioritizes testId over other fields', () => {
        const fp = {
          testId: 'username-input',
          placeholder: 'Enter username',
          textSnippet: 'Username',
          id: 'user-id',
        }
        expect(generateMeaningfulVarName(fp)).toBe('username')
      })

      it('prioritizes placeholder over textSnippet and id', () => {
        const fp = {
          placeholder: 'Enter email',
          textSnippet: 'Email',
          id: 'email-id',
        }
        expect(generateMeaningfulVarName(fp)).toBe('email')
      })

      it('prioritizes textSnippet over id', () => {
        const fp = {
          textSnippet: 'Click Me',
          id: 'button-id',
        }
        expect(generateMeaningfulVarName(fp)).toBe('clickMe')
      })
    })
  })

  // ============================================================================
  // sanitizeVariableName function tests
  // ============================================================================

  describe('sanitizeVariableName', () => {
    it('handles pure digits', () => {
      expect(sanitizeVariableName('7174952')).toBe('text7174952')
      expect(sanitizeVariableName('123')).toBe('text123')
      expect(sanitizeVariableName('0')).toBe('text0')
    })

    it('removes Chinese characters', () => {
      expect(sanitizeVariableName('频道7174952')).toBe('text7174952')
      expect(sanitizeVariableName('频道')).toBe('text') // all Chinese
      expect(sanitizeVariableName('频道：7174952')).toBe('text7174952') // with colon removed
    })

    it('preserves valid English identifiers', () => {
      expect(sanitizeVariableName('testAutomationChannel')).toBe('testAutomationChannel')
      expect(sanitizeVariableName('myVar123')).toBe('myVar123')
    })

    it('handles empty string', () => {
      expect(sanitizeVariableName('')).toBe('text')
    })

    it('removes special characters', () => {
      expect(sanitizeVariableName('test@channel')).toBe('testchannel')
      expect(sanitizeVariableName('test-channel')).toBe('testchannel')
      expect(sanitizeVariableName('test_channel')).toBe('testchannel')
    })

    it('handles mixed Chinese and English', () => {
      expect(sanitizeVariableName('Test频道Channel')).toBe('TestChannel')
      expect(sanitizeVariableName('test频道7174952')).toBe('test7174952') // 'test' is English, kept
    })

    it('lowercases first letter when needed for camelCase conversion', () => {
      // Note: sanitizeVariableName doesn't do camelCase conversion, that's toCamelCase's job
      // This just ensures valid identifier
      expect(sanitizeVariableName('TestAutomation')).toBe('TestAutomation')
    })

    it('uses custom fallback when provided', () => {
      expect(sanitizeVariableName('', 'var')).toBe('var')
      expect(sanitizeVariableName('频道', 'val')).toBe('val')
    })
  })

  // ============================================================================
  // Integration tests for variable name uniqueness
  // ============================================================================

  describe('variable name uniqueness in step with multiple records', () => {
    it('generates unique variable names for multiple assertElementVisible in same step', async () => {
      const specPath = join(testDir, 'specs', 'test.md')
      const spec: MarkdownSpec = {
        preconditions: ['Base URL accessible'],
        steps: [
          { index: 2, text: 'Verify account and password inputs are visible', kind: 'assertion' },
        ],
      }

      const records: ActionRecord[] = [
        createMockRecord({
          specPath,
          stepIndex: 2,
          toolName: 'assertElementVisible',
          element: {
            fingerprint: { testId: 'account-input', tagName: 'input' },
            chosenLocator: {
              kind: 'getByTestId',
              value: 'account-input',
              code: "page.getByTestId('account-input')",
              validation: { unique: true },
            },
            locatorCandidates: [],
          },
        }),
        createMockRecord({
          specPath,
          stepIndex: 2,
          toolName: 'assertElementVisible',
          element: {
            fingerprint: { testId: 'account-password-input', tagName: 'input' },
            chosenLocator: {
              kind: 'getByTestId',
              value: 'account-password-input',
              code: "page.getByTestId('account-password-input')",
              validation: { unique: true },
            },
            locatorCandidates: [],
          },
        }),
      ]

      const runId = await setupIRFile(records)
      const result = await exportFromIR({
        cwd: testDir,
        runId,
        specPath,
        spec,
        baseUrl: 'https://example.com',
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        const content = await readFile(result.exportPath, 'utf-8')
        // Should have two different variable names (-input suffix stripped)
        expect(content).toContain('const account = page.getByTestId(\'account-input\')')
        expect(content).toContain('const accountPassword = page.getByTestId(\'account-password-input\')')
        // Should not have duplicate declarations - count occurrences of 'const account ='
        const matches = content.match(/const account\s*=/g)
        expect(matches?.length ?? 0).toBe(1)
      }
    })

    it('adds numeric suffix when same meaningful name would conflict', async () => {
      const specPath = join(testDir, 'specs', 'test.md')
      const spec: MarkdownSpec = {
        preconditions: ['Base URL accessible'],
        steps: [{ index: 1, text: 'Verify two inputs', kind: 'assertion' }],
      }

      const records: ActionRecord[] = [
        createMockRecord({
          specPath,
          stepIndex: 1,
          toolName: 'assertElementVisible',
          element: {
            fingerprint: { testId: 'input', tagName: 'input' },
            chosenLocator: {
              kind: 'getByTestId',
              value: 'input',
              code: "page.getByTestId('input')",
              validation: { unique: true },
            },
            locatorCandidates: [],
          },
        }),
        createMockRecord({
          specPath,
          stepIndex: 1,
          toolName: 'assertElementVisible',
          element: {
            fingerprint: { testId: 'input', tagName: 'input' },
            chosenLocator: {
              kind: 'getByTestId',
              value: 'input-2',
              code: "page.getByTestId('input-2')",
              validation: { unique: true },
            },
            locatorCandidates: [],
          },
        }),
      ]

      const runId = await setupIRFile(records)
      const result = await exportFromIR({
        cwd: testDir,
        runId,
        specPath,
        spec,
        baseUrl: 'https://example.com',
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        const content = await readFile(result.exportPath, 'utf-8')
        // Should have input and input2
        expect(content).toContain('const input')
        expect(content).toContain('const input2')
      }
    })

    it('generates meaningful names for elements with different testIds', async () => {
      const specPath = join(testDir, 'specs', 'test.md')
      const spec: MarkdownSpec = {
        preconditions: ['Base URL accessible'],
        steps: [{ index: 1, text: 'Verify form elements', kind: 'assertion' }],
      }

      const records: ActionRecord[] = [
        createMockRecord({
          specPath,
          stepIndex: 1,
          toolName: 'assertElementVisible',
          element: {
            fingerprint: { testId: 'username-input', tagName: 'input' },
            chosenLocator: {
              kind: 'getByTestId',
              value: 'username-input',
              code: "page.getByTestId('username-input')",
              validation: { unique: true },
            },
            locatorCandidates: [],
          },
        }),
        createMockRecord({
          specPath,
          stepIndex: 1,
          toolName: 'assertElementVisible',
          element: {
            fingerprint: { testId: 'email-input', tagName: 'input' },
            chosenLocator: {
              kind: 'getByTestId',
              value: 'email-input',
              code: "page.getByTestId('email-input')",
              validation: { unique: true },
            },
            locatorCandidates: [],
          },
        }),
        createMockRecord({
          specPath,
          stepIndex: 1,
          toolName: 'assertElementVisible',
          element: {
            fingerprint: { testId: 'password-input', tagName: 'input' },
            chosenLocator: {
              kind: 'getByTestId',
              value: 'password-input',
              code: "page.getByTestId('password-input')",
              validation: { unique: true },
            },
            locatorCandidates: [],
          },
        }),
      ]

      const runId = await setupIRFile(records)
      const result = await exportFromIR({
        cwd: testDir,
        runId,
        specPath,
        spec,
        baseUrl: 'https://example.com',
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        const content = await readFile(result.exportPath, 'utf-8')
        expect(content).toContain('const username')
        expect(content).toContain('const email')
        expect(content).toContain('const password')
      }
    })
  })

  // ============================================================================
  // Update existing tests for new variable names
  // ============================================================================

  describe('existing tests updated for meaningful variable names', () => {
    it('generates assertElementVisible code with meaningful variable names', async () => {
      const specPath = join(testDir, 'specs', 'test.md')
      const spec: MarkdownSpec = {
        preconditions: ['Base URL accessible'],
        steps: [
          { index: 1, text: 'Navigate to /', kind: 'action' },
          { index: 2, text: "Assert that 'Login' button is visible", kind: 'assertion' },
        ],
      }

      const records: ActionRecord[] = [
        createMockRecord({
          specPath,
          stepIndex: 1,
          toolName: 'navigate',
          toolInput: { url: '/' },
        }),
        createMockRecord({
          specPath,
          stepIndex: 2,
          toolName: 'assertElementVisible',
          toolInput: {},
          element: {
            fingerprint: { tagName: 'button' },
            locatorCandidates: [],
            chosenLocator: {
              kind: 'getByRole',
              value: 'button:Login',
              code: "page.getByRole('button', { name: 'Login' })",
              validation: { unique: true },
            },
          },
        }),
      ]

      const runId = await setupIRFile(records)

      const result = await exportFromIR({
        cwd: testDir,
        runId,
        specPath,
        spec,
        baseUrl: 'https://example.com',
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        const content = await readFile(result.exportPath, 'utf-8')
        expect(content).toContain("page.getByRole('button', { name: 'Login' })")
        expect(content).toContain('toHaveCount(1)')
        expect(content).toContain('toBeVisible()')
        // Variable name should be based on tagName (no testId available)
        expect(content).toContain('const button')
      }
    })
  })

  // ============================================================================
  // Cross-step variable deduplication tests
  // ============================================================================

  describe('cross-step variable deduplication', () => {
    it('deduplicates variable names across different steps', async () => {
      const specPath = join(testDir, 'specs', 'test.md')
      const spec: MarkdownSpec = {
        preconditions: ['Base URL accessible'],
        steps: [
          { index: 1, text: "Verify 'Test Automation Channel' is visible", kind: 'assertion' },
          { index: 2, text: "Verify '7174952' is visible", kind: 'assertion' },
          { index: 3, text: "Verify 'Test Automation Channel' is visible again", kind: 'assertion' },
          { index: 4, text: "Verify '频道：7174952' is visible", kind: 'assertion' },
        ],
      }

      const records: ActionRecord[] = [
        createMockRecord({
          specPath,
          stepIndex: 1,
          toolName: 'assertTextPresent',
          toolInput: { text: 'Test Automation Channel', visibleNth: 0 },
        }),
        createMockRecord({
          specPath,
          stepIndex: 2,
          toolName: 'assertTextPresent',
          toolInput: { text: '7174952', visibleNth: 0 },
        }),
        createMockRecord({
          specPath,
          stepIndex: 3,
          toolName: 'assertTextPresent',
          toolInput: { text: 'Test Automation Channel', visibleNth: 0 },
        }),
        createMockRecord({
          specPath,
          stepIndex: 4,
          toolName: 'assertTextPresent',
          toolInput: { text: '频道：7174952', visibleNth: 0 },
        }),
      ]

      const runId = await setupIRFile(records)

      const result = await exportFromIR({
        cwd: testDir,
        runId,
        specPath,
        spec,
        baseUrl: 'https://example.com',
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        const content = await readFile(result.exportPath, 'utf-8')

        // Step 1: testAutomationChannel
        expect(content).toContain('const testAutomationChannel = page.getByText')

        // Step 2: text7174952 (digits get 'text' prefix)
        expect(content).toContain('const text7174952 = page.getByText')

        // Step 3: testAutomationChannel2 (deduplicated from step 1)
        expect(content).toContain('const testAutomationChannel2 = page.getByText')

        // Step 4: text71749522 (Chinese removed, then deduplicated from step 2)
        expect(content).toContain('const text71749522 = page.getByText')

        // Verify no duplicate declarations - count occurrences of each const declaration
        const testAutomationChannelMatches = content.match(/const testAutomationChannel\d*\s*=/g)
        expect(testAutomationChannelMatches?.length ?? 0).toBe(2)

        const text7174952Matches = content.match(/const text7174952\d*\s*=/g)
        expect(text7174952Matches?.length ?? 0).toBe(2)
      }
    })

    it('handles mixed text assertions with duplicates', async () => {
      const specPath = join(testDir, 'specs', 'test.md')
      const spec: MarkdownSpec = {
        preconditions: ['Base URL accessible'],
        steps: [
          { index: 1, text: "Navigate to /", kind: 'action' },
          { index: 2, text: "Verify text 'Dashboard' is visible", kind: 'assertion' },
          { index: 3, text: "Verify text '123' is visible", kind: 'assertion' },
          { index: 4, text: "Verify text 'Dashboard' is visible again", kind: 'assertion' },
          { index: 5, text: "Verify text '频道123' is visible", kind: 'assertion' },
        ],
      }

      const records: ActionRecord[] = [
        createMockRecord({
          specPath,
          stepIndex: 1,
          toolName: 'navigate',
          toolInput: { url: '/' },
        }),
        createMockRecord({
          specPath,
          stepIndex: 2,
          toolName: 'assertTextPresent',
          toolInput: { text: 'Dashboard', visibleNth: 0 },
        }),
        createMockRecord({
          specPath,
          stepIndex: 3,
          toolName: 'assertTextPresent',
          toolInput: { text: '123', visibleNth: 0 },
        }),
        createMockRecord({
          specPath,
          stepIndex: 4,
          toolName: 'assertTextPresent',
          toolInput: { text: 'Dashboard', visibleNth: 0 },
        }),
        createMockRecord({
          specPath,
          stepIndex: 5,
          toolName: 'assertTextPresent',
          toolInput: { text: '频道123', visibleNth: 0 },
        }),
      ]

      const runId = await setupIRFile(records)

      const result = await exportFromIR({
        cwd: testDir,
        runId,
        specPath,
        spec,
        baseUrl: 'https://example.com',
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        const content = await readFile(result.exportPath, 'utf-8')

        // Should have: dashboard, text123, dashboard2, text1232
        expect(content).toContain('const dashboard = page.getByText')
        expect(content).toContain('const text123 = page.getByText')
        expect(content).toContain('const dashboard2 = page.getByText')
        expect(content).toContain('const text1232 = page.getByText')
      }
    })
  })
})
