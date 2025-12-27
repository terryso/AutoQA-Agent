/**
 * Unit tests for IR replayer
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { replayToStep } from '../../../src/repair/replayer.js'
import type { ActionRecord } from '../../../src/ir/types.js'
import type { ReplayResult } from '../../../src/repair/types.js'

// Mock page for testing
function createMockPage(overrides = {}) {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    waitForDuration: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn().mockReturnValue({
      click: vi.fn().mockResolvedValue(undefined),
      fill: vi.fn().mockResolvedValue(undefined),
      selectOption: vi.fn().mockResolvedValue(undefined),
      waitFor: vi.fn().mockResolvedValue(undefined),
    }),
    getByRole: vi.fn().mockReturnValue({
      click: vi.fn().mockResolvedValue(undefined),
      fill: vi.fn().mockResolvedValue(undefined),
      waitFor: vi.fn().mockResolvedValue(undefined),
    }),
    getByTestId: vi.fn().mockReturnValue({
      click: vi.fn().mockResolvedValue(undefined),
    }),
    getByPlaceholder: vi.fn().mockReturnValue({
      fill: vi.fn().mockResolvedValue(undefined),
    }),
    getByLabel: vi.fn().mockReturnValue({
      fill: vi.fn().mockResolvedValue(undefined),
    }),
    getByText: vi.fn().mockReturnValue({
      click: vi.fn().mockResolvedValue(undefined),
    }),
    evaluate: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('repair/replayer', () => {
  let mockLogger: { log: ReturnType<typeof vi.fn> }
  let mockPage: ReturnType<typeof createMockPage>

  beforeEach(() => {
    mockLogger = { log: vi.fn() }
    mockPage = createMockPage()
  })

  describe('replayToStep', () => {
    it('should return success with 0 replayed when no records to replay', async () => {
      const records: ActionRecord[] = []

      const result = await replayToStep(records, 5, {
        page: mockPage as any,
        runId: 'test-run',
        logger: mockLogger,
      })

      expect(result.ok).toBe(true)
      expect(result.replayedCount).toBe(0)
      expect(result.currentStepIndex).toBe(0)
    })

    it('should navigate to pageUrl when first step is missing locator', async () => {
      const records: ActionRecord[] = [
        {
          runId: 'test-run',
          specPath: 'test.spec.md',
          stepIndex: 3,
          stepText: 'Click button',
          toolName: 'click',
          toolInput: { targetDescription: 'button' },
          outcome: { ok: true },
          pageUrl: 'https://example.com/page',
          timestamp: Date.now(),
        },
      ]

      const result = await replayToStep(records, 3, {
        page: mockPage as any,
        runId: 'test-run',
        logger: mockLogger,
      })

      expect(result.ok).toBe(true)
      expect(result.replayedCount).toBe(0)
      expect(mockPage.goto).toHaveBeenCalledWith('https://example.com/page', expect.any(Object))
    })

    it('should replay navigate action', async () => {
      const records: ActionRecord[] = [
        {
          runId: 'test-run',
          specPath: 'test.spec.md',
          stepIndex: 0,
          stepText: 'Navigate to page',
          toolName: 'navigate',
          toolInput: { url: 'https://example.com' },
          outcome: { ok: true },
          pageUrl: 'https://example.com',
          timestamp: Date.now(),
        },
      ]

      const result = await replayToStep(records, 1, {
        page: mockPage as any,
        runId: 'test-run',
        logger: mockLogger,
      })

      expect(result.ok).toBe(true)
      expect(result.replayedCount).toBe(1)
      expect(mockPage.goto).toHaveBeenCalledWith('https://example.com', expect.any(Object))
    })

    it('should replay wait action', async () => {
      const records: ActionRecord[] = [
        {
          runId: 'test-run',
          specPath: 'test.spec.md',
          stepIndex: 0,
          stepText: 'Wait for 2 seconds',
          toolName: 'wait',
          toolInput: { seconds: 2 },
          outcome: { ok: true },
          timestamp: Date.now(),
        },
      ]

      const result = await replayToStep(records, 1, {
        page: mockPage as any,
        runId: 'test-run',
        logger: mockLogger,
      })

      expect(result.ok).toBe(true)
      expect(result.replayedCount).toBe(1)
      expect(mockPage.waitForDuration).toHaveBeenCalledWith(2000)
    })

    it('should replay click action with chosenLocator', async () => {
      const records: ActionRecord[] = [
        {
          runId: 'test-run',
          specPath: 'test.spec.md',
          stepIndex: 0,
          stepText: 'Click button',
          toolName: 'click',
          toolInput: { targetDescription: 'button' },
          outcome: { ok: true },
          element: {
            fingerprint: { tagName: 'button' },
            locatorCandidates: [],
            chosenLocator: {
              kind: 'cssId',
              value: 'submit-btn',
              code: "page.locator('#submit-btn')",
              validation: { unique: true },
            },
          },
          timestamp: Date.now(),
        },
      ]

      const result = await replayToStep(records, 1, {
        page: mockPage as any,
        runId: 'test-run',
        logger: mockLogger,
      })

      expect(result.ok).toBe(true)
      expect(result.replayedCount).toBe(1)
      expect(mockPage.locator).toHaveBeenCalledWith('#submit-btn')
    })

    it('should replay fill action with chosenLocator', async () => {
      const mockElement = {
        click: vi.fn().mockResolvedValue(undefined),
        fill: vi.fn().mockResolvedValue(undefined),
        selectOption: vi.fn().mockResolvedValue(undefined),
        waitFor: vi.fn().mockResolvedValue(undefined),
      }
      mockPage.locator.mockReturnValue(mockElement)

      const records: ActionRecord[] = [
        {
          runId: 'test-run',
          specPath: 'test.spec.md',
          stepIndex: 0,
          stepText: 'Fill input',
          toolName: 'fill',
          toolInput: { value: 'test value' },
          outcome: { ok: true },
          element: {
            fingerprint: { tagName: 'input' },
            locatorCandidates: [],
            chosenLocator: {
              kind: 'cssId',
              value: 'username',
              code: "page.locator('#username')",
              validation: { unique: true },
            },
          },
          timestamp: Date.now(),
        },
      ]

      const result = await replayToStep(records, 1, {
        page: mockPage as any,
        runId: 'test-run',
        logger: mockLogger,
      })

      expect(result.ok).toBe(true)
      expect(result.replayedCount).toBe(1)
      expect(mockElement.fill).toHaveBeenCalledWith('test value')
    })

    it('should handle getByRole locator code', async () => {
      const mockElement = {
        click: vi.fn().mockResolvedValue(undefined),
      }
      mockPage.getByRole.mockReturnValue(mockElement)

      const records: ActionRecord[] = [
        {
          runId: 'test-run',
          specPath: 'test.spec.md',
          stepIndex: 0,
          stepText: 'Click button',
          toolName: 'click',
          toolInput: { targetDescription: 'button' },
          outcome: { ok: true },
          element: {
            fingerprint: { tagName: 'button', role: 'button' },
            locatorCandidates: [],
            chosenLocator: {
              kind: 'getByRole',
              value: 'button',
              code: "page.getByRole('button', { name: 'Submit' })",
              validation: { unique: true },
            },
          },
          timestamp: Date.now(),
        },
      ]

      const result = await replayToStep(records, 1, {
        page: mockPage as any,
        runId: 'test-run',
        logger: mockLogger,
      })

      expect(result.ok).toBe(true)
      expect(result.replayedCount).toBe(1)
      expect(mockPage.getByRole).toHaveBeenCalledWith('button', { name: 'Submit' })
    })

    it('should stop and return failure when record lacks chosenLocator', async () => {
      const records: ActionRecord[] = [
        {
          runId: 'test-run',
          specPath: 'test.spec.md',
          stepIndex: 0,
          stepText: 'Navigate',
          toolName: 'navigate',
          toolInput: { url: 'https://example.com' },
          outcome: { ok: true },
          pageUrl: 'https://example.com',
          timestamp: Date.now(),
        },
        {
          runId: 'test-run',
          specPath: 'test.spec.md',
          stepIndex: 1,
          stepText: 'Click button',
          toolName: 'click',
          toolInput: { targetDescription: 'button' },
          outcome: { ok: true },
          // No chosenLocator
          timestamp: Date.now(),
        },
      ]

      const result = await replayToStep(records, 2, {
        page: mockPage as any,
        runId: 'test-run',
        logger: mockLogger,
      })

      expect(result.ok).toBe(false)
      expect(result.replayedCount).toBe(1)
      expect(result.failedAtStep).toBe(1)
      expect(result.reason).toBe('no_chosen_locator')
      expect(result.canContinueManually).toBe(true)
    })

    it('should skip records with failed outcome', async () => {
      const records: ActionRecord[] = [
        {
          runId: 'test-run',
          specPath: 'test.spec.md',
          stepIndex: 0,
          stepText: 'Navigate',
          toolName: 'navigate',
          toolInput: { url: 'https://example.com' },
          outcome: { ok: false, errorCode: 'TIMEOUT', errorMessage: 'Timed out' },
          pageUrl: 'https://example.com',
          timestamp: Date.now(),
        },
        {
          runId: 'test-run',
          specPath: 'test.spec.md',
          stepIndex: 1,
          stepText: 'Click button',
          toolName: 'click',
          toolInput: { targetDescription: 'button' },
          outcome: { ok: true },
          element: {
            fingerprint: { tagName: 'button' },
            locatorCandidates: [],
            chosenLocator: {
              kind: 'cssId',
              value: 'btn',
              code: "page.locator('#btn')",
              validation: { unique: true },
            },
          },
          timestamp: Date.now(),
        },
      ]

      const result = await replayToStep(records, 2, {
        page: mockPage as any,
        runId: 'test-run',
        logger: mockLogger,
      })

      expect(result.ok).toBe(true)
      expect(result.replayedCount).toBe(1) // Only the click, not the failed navigate
    })

    it('should handle pageUrl navigation failure', async () => {
      mockPage.goto.mockRejectedValue(new Error('Navigation failed: net::ERR_CONNECTION_REFUSED'))

      const records: ActionRecord[] = [
        {
          runId: 'test-run',
          specPath: 'test.spec.md',
          stepIndex: 3,
          stepText: 'Click button',
          toolName: 'click',
          toolInput: { targetDescription: 'button' },
          outcome: { ok: true },
          pageUrl: 'https://example.com/page',
          timestamp: Date.now(),
        },
      ]

      const result = await replayToStep(records, 3, {
        page: mockPage as any,
        runId: 'test-run',
        logger: mockLogger,
      })

      expect(result.ok).toBe(false)
      expect(result.replayedCount).toBe(0)
      expect(result.reason).toBe('navigation_failed')
      expect(result.canContinueManually).toBe(true)
    })

    it('should replay scroll action', async () => {
      const records: ActionRecord[] = [
        {
          runId: 'test-run',
          specPath: 'test.spec.md',
          stepIndex: 0,
          stepText: 'Scroll down',
          toolName: 'scroll',
          toolInput: { direction: 'down', amount: 500 },
          outcome: { ok: true },
          timestamp: Date.now(),
        },
      ]

      const result = await replayToStep(records, 1, {
        page: mockPage as any,
        runId: 'test-run',
        logger: mockLogger,
      })

      expect(result.ok).toBe(true)
      expect(result.replayedCount).toBe(1)
      expect(mockPage.evaluate).toHaveBeenCalledWith(expect.any(Function), 500)
    })

    it('should replay select_option action', async () => {
      const mockElement = {
        click: vi.fn().mockResolvedValue(undefined),
        fill: vi.fn().mockResolvedValue(undefined),
        selectOption: vi.fn().mockResolvedValue(undefined),
        waitFor: vi.fn().mockResolvedValue(undefined),
      }
      mockPage.locator.mockReturnValue(mockElement)

      const records: ActionRecord[] = [
        {
          runId: 'test-run',
          specPath: 'test.spec.md',
          stepIndex: 0,
          stepText: 'Select option',
          toolName: 'select_option',
          toolInput: { value: 'option1' },
          outcome: { ok: true },
          element: {
            fingerprint: { tagName: 'select' },
            locatorCandidates: [],
            chosenLocator: {
              kind: 'cssId',
              value: 'dropdown',
              code: "page.locator('#dropdown')",
              validation: { unique: true },
            },
          },
          timestamp: Date.now(),
        },
      ]

      const result = await replayToStep(records, 1, {
        page: mockPage as any,
        runId: 'test-run',
        logger: mockLogger,
      })

      expect(result.ok).toBe(true)
      expect(result.replayedCount).toBe(1)
      expect(mockElement.selectOption).toHaveBeenCalledWith('option1')
    })

    it('should replay assertElementVisible as wait', async () => {
      const mockElement = {
        click: vi.fn().mockResolvedValue(undefined),
        fill: vi.fn().mockResolvedValue(undefined),
        waitFor: vi.fn().mockResolvedValue(undefined),
      }
      mockPage.locator.mockReturnValue(mockElement)

      const records: ActionRecord[] = [
        {
          runId: 'test-run',
          specPath: 'test.spec.md',
          stepIndex: 0,
          stepText: 'Assert element visible',
          toolName: 'assertElementVisible',
          toolInput: { targetDescription: 'element' },
          outcome: { ok: true },
          element: {
            fingerprint: { tagName: 'div' },
            locatorCandidates: [],
            chosenLocator: {
              kind: 'cssId',
              value: 'my-div',
              code: "page.locator('#my-div')",
              validation: { unique: true },
            },
          },
          timestamp: Date.now(),
        },
      ]

      const result = await replayToStep(records, 1, {
        page: mockPage as any,
        runId: 'test-run',
        logger: mockLogger,
      })

      expect(result.ok).toBe(true)
      expect(result.replayedCount).toBe(1)
      expect(mockElement.waitFor).toHaveBeenCalledWith({ state: 'visible', timeout: expect.any(Number) })
    })
  })

  describe('ReplayResult type', () => {
    it('should have correct structure for success result', () => {
      const success: ReplayResult = {
        ok: true,
        replayedCount: 5,
        currentStepIndex: 5,
      }

      expect(success.ok).toBe(true)
      expect(success.replayedCount).toBe(5)
      expect(success.currentStepIndex).toBe(5)
    })

    it('should have correct structure for failure result', () => {
      const failure: ReplayResult = {
        ok: false,
        replayedCount: 3,
        failedAtStep: 4,
        error: 'Element not found',
        reason: 'locator_not_found',
        canContinueManually: true,
      }

      expect(failure.ok).toBe(false)
      expect(failure.replayedCount).toBe(3)
      expect(failure.failedAtStep).toBe(4)
      expect(failure.reason).toBe('locator_not_found')
      expect(failure.canContinueManually).toBe(true)
    })
  })
})
