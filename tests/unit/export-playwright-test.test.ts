import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { exportPlaywrightTest, isSpecExportable } from '../../src/runner/export-playwright-test.js'
import type { MarkdownSpec } from '../../src/markdown/spec-types.js'
import type { ActionRecord } from '../../src/ir/types.js'

describe('export-playwright-test', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `export-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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

  describe('exportPlaywrightTest', () => {
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
          toolInput: { targetDescription: 'Username', text: '[REDACTED]' },
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
          toolInput: { targetDescription: 'Login button' },
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

      const result = await exportPlaywrightTest({
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
        expect(content).not.toContain("const baseUrl = 'https://example.com'")
        expect(content).toContain('page.goto')
        expect(content).toContain("page.getByTestId('username').fill")
        expect(content).toContain("page.getByRole('button', { name: 'Login' }).click()")
        expect(content).toContain("page.getByText('Dashboard')")
        expect(content).toContain('.nth(0)')
      }
    })

    it('generates TODO comment when assertion step is missing assertion IR record (simple case)', async () => {
      const specPath = join(testDir, 'specs', 'test.md')
      const spec: MarkdownSpec = {
        preconditions: ['Base URL accessible'],
        steps: [
          { index: 1, text: 'Navigate to /', kind: 'action' },
          { index: 2, text: "Verify the page shows 'Dashboard'", kind: 'assertion' },
        ],
      }

      const records: ActionRecord[] = [
        createMockRecord({
          specPath,
          stepIndex: 1,
          toolName: 'navigate',
          toolInput: { url: '/' },
        }),
      ]

      const runId = await setupIRFile(records)

      const result = await exportPlaywrightTest({
        cwd: testDir,
        runId,
        specPath,
        spec,
        baseUrl: 'https://example.com',
      })

      // Should succeed with TODO comment instead of failing
      expect(result.ok).toBe(true)
      if (result.ok) {
        const content = await readFile(result.exportPath, 'utf-8')
        expect(content).toContain('// TODO: Add assertion for:')
        expect(content).toContain('Dashboard')
      }
    })

    it('exports assertions based on IR even if spec assertion text is descriptive', async () => {
      const specPath = join(testDir, 'specs', 'test.md')
      const spec: MarkdownSpec = {
        preconditions: ['Base URL accessible'],
        steps: [
          { index: 1, text: 'Navigate to /', kind: 'action' },
          { index: 2, text: 'Verify the page shows the login form with fields "Username" and "Password"', kind: 'assertion' },
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
          toolInput: { text: 'Username', visibleNth: 0 },
        }),
        createMockRecord({
          specPath,
          stepIndex: 2,
          toolName: 'assertTextPresent',
          toolInput: { text: 'Password', visibleNth: 0 },
        }),
      ]

      const runId = await setupIRFile(records)

      const result = await exportPlaywrightTest({
        cwd: testDir,
        runId,
        specPath,
        spec,
        baseUrl: 'https://example.com',
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        const content = await readFile(result.exportPath, 'utf-8')
        expect(content).toContain("page.getByText('Username')")
        expect(content).toContain("page.getByText('Password')")
      }
    })

    it('fails when no IR records found for spec', async () => {
      const specPath = join(testDir, 'specs', 'test.md')
      const spec: MarkdownSpec = {
        preconditions: ['Base URL accessible'],
        steps: [{ index: 1, text: 'Navigate to /', kind: 'action' }],
      }

      const runId = await setupIRFile([])

      const result = await exportPlaywrightTest({
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

    it('fails when element-targeting action is missing chosenLocator and has no fallback', async () => {
      const specPath = join(testDir, 'specs', 'test.md')
      const spec: MarkdownSpec = {
        preconditions: ['Base URL accessible'],
        steps: [
          { index: 1, text: "Fill the 'Username' field with test", kind: 'action' },
        ],
      }

      // fill action without chosenLocator and without fallback support
      const records: ActionRecord[] = [
        createMockRecord({
          specPath,
          stepIndex: 1,
          toolName: 'fill',
          toolInput: { targetDescription: 'Username field', textLength: 4 },
          // No element/chosenLocator - fill doesn't support fallback
        }),
      ]

      const runId = await setupIRFile(records)

      const result = await exportPlaywrightTest({
        cwd: testDir,
        runId,
        specPath,
        spec,
        baseUrl: 'https://example.com',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('missing valid chosenLocator')
        expect(result.missingLocators).toBeDefined()
        expect(result.missingLocators!.length).toBeGreaterThan(0)
      }
    })

    it('succeeds with fallback locator when click is missing chosenLocator but has targetDescription', async () => {
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
          toolInput: { targetDescription: 'Login button' },
          // No element/chosenLocator but has targetDescription for fallback
        }),
      ]

      const runId = await setupIRFile(records)

      const result = await exportPlaywrightTest({
        cwd: testDir,
        runId,
        specPath,
        spec,
        baseUrl: 'https://example.com',
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        const content = await readFile(result.exportPath, 'utf-8')
        expect(content).toContain('click()')
        expect(content).toContain('TODO: verify this fallback locator')
      }
    })

    it('generates TODO comment when assertion step is missing assertion IR record', async () => {
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
      ]

      const runId = await setupIRFile(records)

      const result = await exportPlaywrightTest({
        cwd: testDir,
        runId,
        specPath,
        spec,
        baseUrl: 'https://example.com',
      })

      // Should succeed with TODO comment instead of failing
      expect(result.ok).toBe(true)
      if (result.ok) {
        const content = await readFile(result.exportPath, 'utf-8')
        expect(content).toContain('// TODO: Add assertion for:')
        expect(content).toContain('Products')
      }
    })

    it('uses env vars for template variables in raw spec', async () => {
      const specPath = join(testDir, 'specs', 'test.md')
      // Rendered spec (after template substitution)
      const spec: MarkdownSpec = {
        preconditions: ['Base URL accessible'],
        steps: [
          { index: 1, text: "Fill the 'Username' field with standard_user", kind: 'action' },
        ],
      }
      // Raw spec content with {{VAR}} placeholders
      const rawSpecContent = `## Steps

1. Fill the 'Username' field with {{USERNAME}}
`

      const records: ActionRecord[] = [
        createMockRecord({
          specPath,
          stepIndex: 1,
          toolName: 'fill',
          toolInput: { targetDescription: 'Username', text: '[REDACTED]', textRedacted: true },
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

      const result = await exportPlaywrightTest({
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
        expect(content).toContain("const username = getEnvVar('AUTOQA_USERNAME')")
        expect(content).toContain("page.getByTestId('username').fill(username)")
        expect(content).not.toContain('standard_user')
        expect(content).not.toContain('[REDACTED]')
      }
    })

    it('uses IR fillValue (template_var) for fill code generation', async () => {
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
            targetDescription: 'Username',
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

      const result = await exportPlaywrightTest({
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
        // The fill code should use the env var, not the literal value
        expect(content).not.toContain(".fill('standard_user')")
      }
    })

    it('uses IR fillValue (literal) for fill code generation', async () => {
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
            targetDescription: 'search field',
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

      const result = await exportPlaywrightTest({
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
        // Should not have env vars for fill value (literal), but baseUrl always uses getEnvVar
        expect(content).not.toContain('AUTOQA_USERNAME')
        expect(content).not.toContain('AUTOQA_PASSWORD')
      }
    })

    it('does not expose absolute paths in output', async () => {
      const specPath = join(testDir, 'specs', 'test.md')
      const spec: MarkdownSpec = {
        preconditions: ['Base URL accessible'],
        steps: [
          { index: 1, text: 'Navigate to /', kind: 'action' },
        ],
      }

      const records: ActionRecord[] = [
        createMockRecord({
          specPath,
          stepIndex: 1,
          toolName: 'navigate',
          toolInput: { url: '/' },
        }),
      ]

      const runId = await setupIRFile(records)

      const result = await exportPlaywrightTest({
        cwd: testDir,
        runId,
        specPath,
        spec,
        baseUrl: 'https://example.com',
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        // relativePath should not contain absolute path
        expect(result.relativePath).not.toContain(testDir)
        expect(result.relativePath).toBe('tests/autoqa/specs-test.spec.ts')
      }
    })

    it('generates element visibility assertions with role-based locators when possible', async () => {
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
          toolInput: { targetDescription: 'Login button' },
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

      const result = await exportPlaywrightTest({
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

    it('handles select_option with chosenLocator', async () => {
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
          toolInput: { ref: 'e5', label: 'Option A' },
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

      const result = await exportPlaywrightTest({
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

    it('uses fallback locator when chosenLocator is missing for click', async () => {
      const specPath = join(testDir, 'specs', 'test.md')
      const spec: MarkdownSpec = {
        preconditions: ['Base URL accessible'],
        steps: [
          { index: 1, text: 'Navigate to /', kind: 'action' },
          { index: 2, text: "Click the 'Search' button", kind: 'action' },
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
          toolName: 'click',
          toolInput: { targetDescription: 'search button to trigger search', ref: 'e132' },
          element: {
            fingerprint: { tagName: 'span' },
            locatorCandidates: [],
            // No chosenLocator - simulating the case where no stable locator was found
          },
        }),
      ]

      const runId = await setupIRFile(records)

      const result = await exportPlaywrightTest({
        cwd: testDir,
        runId,
        specPath,
        spec,
        baseUrl: 'https://example.com',
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        const content = await readFile(result.exportPath, 'utf-8')
        // Should use fallback locator with TODO comment
        expect(content).toContain('click()')
        expect(content).toContain('TODO: verify this fallback locator')
        expect(content).toContain('search')
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
})
