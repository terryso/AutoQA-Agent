/**
 * Unit tests for repair mode types and coordinator
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import type { ExportResult } from '../../../src/runner/export-from-ir.js'
import type { RepairRecord, RepairFile } from '../../../src/repair/types.js'
import type { ActionRecord } from '../../../src/ir/types.js'
import {
  createRepairCoordinator,
  shouldSuggestRepairMode,
  extractFailedSteps,
  type RepairCoordinator,
} from '../../../src/repair/coordinator.js'

// Mock the IR reader module
vi.mock('../../../src/runner/ir-reader.js', () => ({
  getSpecActionRecords: vi.fn(),
  hasValidChosenLocator: vi.fn(),
}))

// Mock the browser creation
vi.mock('../../../src/browser/create-browser.js', () => ({
  createBrowser: vi.fn(),
}))

describe('repair/types', () => {
  describe('RepairRecord', () => {
    it('should have required fields', () => {
      const record: RepairRecord = {
        runId: 'abc123',
        specPath: 'specs/test.spec.md',
        stepIndex: 3,
        stepText: 'Click login button',
        timestamp: Date.now(),
        chosenLocator: {
          kind: 'cssId',
          value: 'login-btn',
          code: "page.locator('#login-btn')",
          validation: { unique: true },
        },
        repairedAt: new Date().toISOString(),
        userConfirmed: true,
      }

      expect(record.runId).toBe('abc123')
      expect(record.specPath).toBe('specs/test.spec.md')
      expect(record.stepIndex).toBe(3)
      expect(record.chosenLocator.kind).toBe('cssId')
      expect(record.userConfirmed).toBe(true)
    })
  })

  describe('RepairFile', () => {
    it('should have required fields', () => {
      const file: RepairFile = {
        runId: 'abc123',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        repairs: [],
      }

      expect(file.runId).toBe('abc123')
      expect(file.repairs).toEqual([])
    })
  })

  describe('ExportResult with suggestRepairMode', () => {
    it('should include suggestRepairMode field in ExportFailure', () => {
      const failure: ExportResult = {
        ok: false,
        reason: 'Export failed: 2 action(s) missing valid chosenLocator',
        missingLocators: ['click at step 3', 'fill at step 5'],
        suggestRepairMode: true,
      }

      expect(failure.ok).toBe(false)
      expect(failure.suggestRepairMode).toBe(true)
      expect(failure.missingLocators).toHaveLength(2)
    })

    it('should allow suggestRepairMode to be false', () => {
      const failure: ExportResult = {
        ok: false,
        reason: 'Export failed: No IR records',
        suggestRepairMode: false,
      }

      expect(failure.ok).toBe(false)
      expect(failure.suggestRepairMode).toBe(false)
    })

    it('should not have suggestRepairMode in ExportSuccess', () => {
      const success: ExportResult = {
        ok: true,
        exportPath: '/path/to/test.spec.ts',
        relativePath: 'test.spec.ts',
      }

      expect(success.ok).toBe(true)
      expect(success.suggestRepairMode).toBeUndefined()
    })
  })
})

describe('repair/coordinator', () => {
  let mockLogger: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockLogger = vi.fn()
  })

  describe('shouldSuggestRepairMode', () => {
    it('should return true for export failure with suggestRepairMode=true', () => {
      const result: ExportResult = {
        ok: false,
        reason: 'Missing locators',
        suggestRepairMode: true,
      }

      expect(shouldSuggestRepairMode(result)).toBe(true)
    })

    it('should return false for export failure with suggestRepairMode=false', () => {
      const result: ExportResult = {
        ok: false,
        reason: 'Missing locators',
        suggestRepairMode: false,
      }

      expect(shouldSuggestRepairMode(result)).toBe(false)
    })

    it('should return false for export success', () => {
      const result: ExportResult = {
        ok: true,
        exportPath: '/path/to/test.ts',
        relativePath: 'test.ts',
      }

      expect(shouldSuggestRepairMode(result)).toBe(false)
    })

    it('should return false when suggestRepairMode is undefined', () => {
      const result: ExportResult = {
        ok: false,
        reason: 'Missing locators',
      }

      expect(shouldSuggestRepairMode(result)).toBe(false)
    })
  })

  describe('extractFailedSteps', () => {
    it('should parse step details from missingLocators', () => {
      const result: ExportResult = {
        ok: false,
        reason: 'Missing locators',
        missingLocators: ['click at step 3', 'fill at step 5', 'assertElementVisible at step 7'],
      }

      const steps = extractFailedSteps(result)

      expect(steps).toHaveLength(3)
      expect(steps[0]).toEqual({ stepIndex: 3, stepText: 'Step 3', toolName: 'click' })
      expect(steps[1]).toEqual({ stepIndex: 5, stepText: 'Step 5', toolName: 'fill' })
      expect(steps[2]).toEqual({ stepIndex: 7, stepText: 'Step 7', toolName: 'assertElementVisible' })
    })

    it('should handle unparsable step details', () => {
      const result: ExportResult = {
        ok: false,
        reason: 'Missing locators',
        missingLocators: ['unknown action', 'click at step 3'],
      }

      const steps = extractFailedSteps(result)

      expect(steps).toHaveLength(2)
      expect(steps[0].stepIndex).toBe(-1)
      expect(steps[0].toolName).toBe('unknown')
      expect(steps[1].stepIndex).toBe(3)
      expect(steps[1].toolName).toBe('click')
    })

    it('should return empty array for success result', () => {
      const result: ExportResult = {
        ok: true,
        exportPath: '/path/to/test.ts',
        relativePath: 'test.ts',
      }

      expect(extractFailedSteps(result)).toEqual([])
    })

    it('should return empty array when missingLocators is undefined', () => {
      const result: ExportResult = {
        ok: false,
        reason: 'Some other error',
      }

      expect(extractFailedSteps(result)).toEqual([])
    })
  })

  describe('createRepairCoordinator', () => {
    it('should create a RepairCoordinator instance', () => {
      const options = {
        runId: 'test-run-id',
        specPath: 'specs/test.spec.md',
        cwd: '/project',
        baseUrl: 'http://localhost:3000',
      }

      const coordinator = createRepairCoordinator(options)

      expect(coordinator).toBeDefined()
      expect(typeof coordinator.startRepairMode).toBe('function')
      expect(typeof coordinator.getFailedSteps).toBe('function')
      expect(typeof coordinator.cleanup).toBe('function')
    })

    it('should return empty failed steps initially', () => {
      const coordinator = createRepairCoordinator({
        runId: 'test-run-id',
        specPath: 'specs/test.spec.md',
        cwd: '/project',
        baseUrl: 'http://localhost:3000',
      })

      expect(coordinator.getFailedSteps()).toEqual([])
    })
  })

  describe('RepairCoordinator lifecycle', () => {
    let coordinator: RepairCoordinator

    afterEach(async () => {
      if (coordinator) {
        await coordinator.cleanup()
        coordinator = null as unknown as RepairCoordinator
      }
    })

    it('should handle cleanup when no browser was launched', async () => {
      coordinator = createRepairCoordinator({
        runId: 'test-run-id',
        specPath: 'specs/test.spec.md',
        cwd: '/project',
        baseUrl: 'http://localhost:3000',
      })

      // Should not throw even though no browser was created
      await expect(coordinator.cleanup()).resolves.toBeUndefined()
    })
  })

  describe('RepairCoordinator integration with replayer', () => {
    let coordinator: RepairCoordinator
    const mockWriteErr = vi.fn()

    beforeEach(async () => {
      vi.clearAllMocks()

      // Mock hasValidChosenLocator to return false for element-targeting steps
      const { hasValidChosenLocator } = await import('../../../src/runner/ir-reader.js')
      vi.mocked(hasValidChosenLocator).mockImplementation((record: ActionRecord) => {
        // Return false for click actions without chosenLocator
        return Boolean(record.element?.chosenLocator?.code)
      })
    })

    afterEach(async () => {
      if (coordinator) {
        await coordinator.cleanup()
        coordinator = null as unknown as RepairCoordinator
      }
    })

    it('should return error when no failed steps found', async () => {
      const { getSpecActionRecords } = await import('../../../src/runner/ir-reader.js')
      vi.mocked(getSpecActionRecords).mockResolvedValue([])

      coordinator = createRepairCoordinator({
        runId: 'test-run-id',
        specPath: 'specs/test.spec.md',
        cwd: '/project',
        baseUrl: 'http://localhost:3000',
        logger: { log: vi.fn() },
      })

      const result = await coordinator.startRepairMode()

      expect(result.ok).toBe(false)
      expect(result.reason).toContain('No failed steps found')
    })

    it('should identify failed steps from IR records', async () => {
      const { getSpecActionRecords } = await import('../../../src/runner/ir-reader.js')

      const mockRecords: ActionRecord[] = [
        {
          runId: 'test-run-id',
          specPath: 'specs/test.spec.md',
          stepIndex: 0,
          stepText: 'Navigate to page',
          toolName: 'navigate',
          toolInput: { url: 'http://localhost:3000' },
          outcome: { ok: true },
          pageUrl: 'http://localhost:3000',
          timestamp: Date.now(),
        },
        {
          runId: 'test-run-id',
          specPath: 'specs/test.spec.md',
          stepIndex: 1,
          stepText: 'Click button',
          toolName: 'click',
          toolInput: { targetDescription: 'button' },
          outcome: { ok: true },
          // No chosenLocator - this should be flagged as failed
          timestamp: Date.now(),
        },
      ]

      vi.mocked(getSpecActionRecords).mockResolvedValue(mockRecords)

      coordinator = createRepairCoordinator({
        runId: 'test-run-id',
        specPath: 'specs/test.spec.md',
        cwd: '/project',
        baseUrl: 'http://localhost:3000',
        logger: { log: vi.fn() },
      })

      // Before startRepairMode, failed steps should be empty
      expect(coordinator.getFailedSteps()).toEqual([])

      // Mock browser creation
      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      }
      const { createBrowser } = await import('../../../src/browser/create-browser.js')
      vi.mocked(createBrowser).mockResolvedValue({
        browser: {
          newContext: vi.fn().mockResolvedValue({
            newPage: vi.fn().mockResolvedValue(mockPage),
          }),
          close: vi.fn().mockResolvedValue(undefined),
        } as any,
        persistentContext: null,
      })

      const result = await coordinator.startRepairMode()

      // Should identify the failed step
      const failedSteps = coordinator.getFailedSteps()
      expect(failedSteps).toHaveLength(1)
      expect(failedSteps[0].stepIndex).toBe(1)
      expect(failedSteps[0].toolName).toBe('click')
    })

    it('should use writeErr to display replay failure prompt', async () => {
      const { getSpecActionRecords } = await import('../../../src/runner/ir-reader.js')

      // Create a record with pageUrl so it tries to navigate, then fails
      const mockRecords: ActionRecord[] = [
        {
          runId: 'test-run-id',
          specPath: 'specs/test.spec.md',
          stepIndex: 0,
          stepText: 'Click button',
          toolName: 'click',
          toolInput: { targetDescription: 'button' },
          outcome: { ok: true },
          pageUrl: 'http://localhost:3000',
          timestamp: Date.now(),
        },
      ]

      vi.mocked(getSpecActionRecords).mockResolvedValue(mockRecords)

      coordinator = createRepairCoordinator({
        runId: 'test-run-id',
        specPath: 'specs/test.spec.md',
        cwd: '/project',
        baseUrl: 'http://localhost:3000',
        logger: { log: vi.fn() },
        writeErr: mockWriteErr,
      })

      // Mock browser creation - navigation fails which triggers replay failure
      const mockPage = {
        goto: vi.fn().mockRejectedValue(new Error('Navigation failed')),
        close: vi.fn().mockResolvedValue(undefined),
      }
      const { createBrowser } = await import('../../../src/browser/create-browser.js')
      vi.mocked(createBrowser).mockResolvedValue({
        browser: {
          newContext: vi.fn().mockResolvedValue({
            newPage: vi.fn().mockResolvedValue(mockPage),
          }),
          close: vi.fn().mockResolvedValue(undefined),
        } as any,
        persistentContext: null,
      })

      await coordinator.startRepairMode()

      // Verify writeErr was called with the failure prompt
      expect(mockWriteErr).toHaveBeenCalled()
      const prompt = mockWriteErr.mock.calls[0][0] as string
      expect(prompt).toContain('重放失败')
      expect(prompt).toContain('Replay Failed')
    })
  })
})
