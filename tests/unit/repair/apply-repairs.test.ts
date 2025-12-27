/**
 * Unit tests for applyRepairs function
 */

import { describe, it, expect } from 'vitest'
import { applyRepairs } from '../../../src/runner/apply-repairs.js'
import type { ActionRecord } from '../../../src/ir/types.js'
import type { RepairRecord } from '../../../src/repair/types.js'

describe('applyRepairs', () => {
  const createMockLocator = (kind: string, value: string, code: string) => ({
    kind,
    value,
    code,
    validation: { unique: true, visible: true },
  })

  describe('when no repairs provided', () => {
    it('should return records unchanged', () => {
      const records: ActionRecord[] = [
        {
          runId: 'test-run',
          specPath: 'test.spec.md',
          stepIndex: 0,
          stepText: 'Navigate',
          toolName: 'navigate',
          toolInput: { url: 'https://example.com' },
          outcome: { ok: true },
          timestamp: Date.now(),
        },
      ]

      const result = applyRepairs(records, [])

      expect(result).toEqual(records)
    })
  })

  describe('when repair matches a record', () => {
    it('should add chosenLocator to record without element', () => {
      const records: ActionRecord[] = [
        {
          runId: 'test-run',
          specPath: 'specs/login.spec.md',
          stepIndex: 3,
          stepText: 'Click login button',
          toolName: 'click',
          toolInput: { targetDescription: 'login button' },
          outcome: { ok: true },
          pageUrl: 'https://example.com/login',
          timestamp: Date.now(),
          // No element field - missing locator
        },
      ]

      const repairs: RepairRecord[] = [
        {
          runId: 'test-run',
          specPath: 'specs/login.spec.md',
          stepIndex: 3,
          stepText: 'Click login button',
          timestamp: Date.now(),
          chosenLocator: createMockLocator(
            'cssId',
            'submit-btn',
            "page.locator('#submit-btn')",
          ),
          repairedAt: new Date().toISOString(),
          userConfirmed: true,
        },
      ]

      const result = applyRepairs(records, repairs)

      expect(result).toHaveLength(1)
      expect(result[0].element).toBeDefined()
      expect(result[0].element?.chosenLocator).toEqual(repairs[0].chosenLocator)
    })

    it('should update existing element with repair chosenLocator', () => {
      const existingLocator = createMockLocator(
        'getByText',
        'Login',
        "page.getByText('Login')",
      )

      const records: ActionRecord[] = [
        {
          runId: 'test-run',
          specPath: 'specs/login.spec.md',
          stepIndex: 3,
          stepText: 'Click login button',
          toolName: 'click',
          toolInput: { targetDescription: 'login button' },
          outcome: { ok: true },
          pageUrl: 'https://example.com/login',
          timestamp: Date.now(),
          element: {
            fingerprint: { tagName: 'button' },
            locatorCandidates: [existingLocator],
            chosenLocator: existingLocator,
          },
        },
      ]

      const repairLocator = createMockLocator(
        'cssId',
        'submit-btn',
        "page.locator('#submit-btn')",
      )

      const repairs: RepairRecord[] = [
        {
          runId: 'test-run',
          specPath: 'specs/login.spec.md',
          stepIndex: 3,
          stepText: 'Click login button',
          timestamp: Date.now(),
          chosenLocator: repairLocator,
          repairedAt: new Date().toISOString(),
          userConfirmed: true,
        },
      ]

      const result = applyRepairs(records, repairs)

      // Repair should override existing chosenLocator
      expect(result[0].element?.chosenLocator).toEqual(repairLocator)
      // But should preserve other element properties
      expect(result[0].element?.fingerprint).toEqual({ tagName: 'button' })
      expect(result[0].element?.locatorCandidates).toEqual([existingLocator])
    })
  })

  describe('when repair does not match any record', () => {
    it('should leave records unchanged', () => {
      const originalLocator = createMockLocator(
        'getByRole',
        'button',
        "page.getByRole('button')",
      )

      const records: ActionRecord[] = [
        {
          runId: 'test-run',
          specPath: 'specs/login.spec.md',
          stepIndex: 1,
          stepText: 'Click button',
          toolName: 'click',
          toolInput: { targetDescription: 'button' },
          outcome: { ok: true },
          element: {
            fingerprint: { tagName: 'button' },
            locatorCandidates: [originalLocator],
            chosenLocator: originalLocator,
          },
          timestamp: Date.now(),
        },
      ]

      const repairs: RepairRecord[] = [
        {
          runId: 'test-run',
          specPath: 'specs/login.spec.md',
          stepIndex: 5, // Different step
          stepText: 'Fill input',
          timestamp: Date.now(),
          chosenLocator: createMockLocator(
            'cssId',
            'input',
            "page.locator('#input')",
          ),
          repairedAt: new Date().toISOString(),
          userConfirmed: true,
        },
      ]

      const result = applyRepairs(records, repairs)

      expect(result[0].element?.chosenLocator).toEqual(originalLocator)
    })
  })

  describe('when multiple repairs and records', () => {
    it('should apply all matching repairs', () => {
      const records: ActionRecord[] = [
        {
          runId: 'test-run',
          specPath: 'specs/login.spec.md',
          stepIndex: 1,
          stepText: 'Fill username',
          toolName: 'fill',
          toolInput: { value: 'user@example.com' },
          outcome: { ok: true },
          timestamp: Date.now(),
        },
        {
          runId: 'test-run',
          specPath: 'specs/login.spec.md',
          stepIndex: 2,
          stepText: 'Fill password',
          toolName: 'fill',
          toolInput: { value: '***' },
          outcome: { ok: true },
          timestamp: Date.now(),
        },
        {
          runId: 'test-run',
          specPath: 'specs/login.spec.md',
          stepIndex: 3,
          stepText: 'Click login',
          toolName: 'click',
          toolInput: { targetDescription: 'login button' },
          outcome: { ok: true },
          timestamp: Date.now(),
        },
      ]

      const repairs: RepairRecord[] = [
        {
          runId: 'test-run',
          specPath: 'specs/login.spec.md',
          stepIndex: 1,
          stepText: 'Fill username',
          timestamp: Date.now(),
          chosenLocator: createMockLocator(
            'cssId',
            'username',
            "page.locator('#username')",
          ),
          repairedAt: new Date().toISOString(),
          userConfirmed: true,
        },
        {
          runId: 'test-run',
          specPath: 'specs/login.spec.md',
          stepIndex: 3,
          stepText: 'Click login',
          timestamp: Date.now(),
          chosenLocator: createMockLocator(
            'cssId',
            'login-btn',
            "page.locator('#login-btn')",
          ),
          repairedAt: new Date().toISOString(),
          userConfirmed: true,
        },
      ]

      const result = applyRepairs(records, repairs)

      expect(result).toHaveLength(3)

      // Step 1 should have repair
      expect(result[0].element?.chosenLocator).toEqual(repairs[0].chosenLocator)

      // Step 2 should not have element (no repair for it)
      expect(result[1].element).toBeUndefined()

      // Step 3 should have repair
      expect(result[2].element?.chosenLocator).toEqual(repairs[1].chosenLocator)
    })
  })

  describe('filtering by specPath', () => {
    it('should only apply repairs for matching specPath', () => {
      const records: ActionRecord[] = [
        {
          runId: 'test-run',
          specPath: 'specs/login.spec.md',
          stepIndex: 1,
          stepText: 'Click button',
          toolName: 'click',
          toolInput: { targetDescription: 'button' },
          outcome: { ok: true },
          timestamp: Date.now(),
        },
        {
          runId: 'test-run',
          specPath: 'specs/register.spec.md',
          stepIndex: 1,
          stepText: 'Click button',
          toolName: 'click',
          toolInput: { targetDescription: 'button' },
          outcome: { ok: true },
          timestamp: Date.now(),
        },
      ]

      const repairs: RepairRecord[] = [
        {
          runId: 'test-run',
          specPath: 'specs/login.spec.md',
          stepIndex: 1,
          stepText: 'Click button',
          timestamp: Date.now(),
          chosenLocator: createMockLocator(
            'cssId',
            'btn',
            "page.locator('#btn')",
          ),
          repairedAt: new Date().toISOString(),
          userConfirmed: true,
        },
      ]

      const result = applyRepairs(records, repairs)

      // Only login.spec.md record should have repair
      expect(result[0].element?.chosenLocator).toEqual(repairs[0].chosenLocator)
      expect(result[1].element).toBeUndefined()
    })
  })

  describe('records with null stepIndex', () => {
    it('should not apply repairs to records with null stepIndex', () => {
      const records: ActionRecord[] = [
        {
          runId: 'test-run',
          specPath: 'specs/test.spec.md',
          stepIndex: null,
          stepText: 'Unknown step',
          toolName: 'click',
          toolInput: {},
          outcome: { ok: true },
          timestamp: Date.now(),
        },
      ]

      const repairs: RepairRecord[] = [
        {
          runId: 'test-run',
          specPath: 'specs/test.spec.md',
          stepIndex: 1,
          stepText: 'Step 1',
          timestamp: Date.now(),
          chosenLocator: createMockLocator(
            'cssId',
            'test',
            "page.locator('#test')",
          ),
          repairedAt: new Date().toISOString(),
          userConfirmed: true,
        },
      ]

      const result = applyRepairs(records, repairs)

      // Record with null stepIndex should remain unchanged
      expect(result[0].element).toBeUndefined()
    })
  })
})
