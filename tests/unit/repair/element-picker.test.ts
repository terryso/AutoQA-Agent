/**
 * Unit tests for Element Picker functionality
 */

import { describe, it, expect, beforeEach, vi as mock } from 'vitest'
import {
  generateLocatorCandidates,
  locatorCodeToSelector,
  recommendBestLocator,
  formatLocatorCandidates,
  type ElementInfo,
  type ValidatedLocator,
} from '../../../src/repair/element-picker.js'

describe('element-picker', () => {
  describe('generateLocatorCandidates', () => {
    it('should prioritize data-testid highest (priority 100)', () => {
      const elementInfo: ElementInfo = {
        tagName: 'button',
        testId: 'submit-btn',
        id: 'submit',
        text: 'Submit',
      }

      const candidates = generateLocatorCandidates(elementInfo)

      expect(candidates[0]).toMatchObject({
        priority: 100,
        kind: 'getByTestId',
        value: 'submit-btn',
        code: "page.getByTestId('submit-btn')",
      })
    })

    it('should generate data-test with priority 95', () => {
      const elementInfo: ElementInfo = {
        tagName: 'button',
        testName: 'submit',
      }

      const candidates = generateLocatorCandidates(elementInfo)

      const dataTestCandidate = candidates.find((c) => c.reason === 'data-test attribute')
      expect(dataTestCandidate).toMatchObject({
        priority: 95,
        kind: 'getByTestId',
        value: 'submit',
      })
    })

    it('should generate data-cy with priority 90', () => {
      const elementInfo: ElementInfo = {
        tagName: 'button',
        dataCy: 'cy-submit',
      }

      const candidates = generateLocatorCandidates(elementInfo)

      const dataCyCandidate = candidates.find((c) => c.reason === 'data-cy attribute')
      expect(dataCyCandidate).toMatchObject({
        priority: 90,
        kind: 'getByTestId',
        value: 'cy-submit',
      })
    })

    it('should generate ID with priority 80 for short IDs', () => {
      const elementInfo: ElementInfo = {
        tagName: 'div',
        id: 'container',
      }

      const candidates = generateLocatorCandidates(elementInfo)

      const idCandidate = candidates.find((c) => c.kind === 'cssId')
      expect(idCandidate).toMatchObject({
        priority: 80,
        kind: 'cssId',
        value: 'container',
        code: "page.locator('#container')",
      })
    })

    it('should skip numeric IDs', () => {
      const elementInfo: ElementInfo = {
        tagName: 'div',
        id: '123',
      }

      const candidates = generateLocatorCandidates(elementInfo)

      const idCandidate = candidates.find((c) => c.kind === 'cssId')
      expect(idCandidate).toBeUndefined()
    })

    it('should skip long IDs (>20 chars)', () => {
      const elementInfo: ElementInfo = {
        tagName: 'div',
        id: 'very-long-id-name-that-exceeds-twenty-characters',
      }

      const candidates = generateLocatorCandidates(elementInfo)

      const idCandidate = candidates.find((c) => c.kind === 'cssId')
      expect(idCandidate).toBeUndefined()
    })

    it('should generate role+name with priority 70 when role and accessible name exist', () => {
      const elementInfo: ElementInfo = {
        tagName: 'button',
        role: 'button',
        text: 'Submit',
      }

      const candidates = generateLocatorCandidates(elementInfo)

      const roleCandidate = candidates.find((c) => c.kind === 'getByRole')
      expect(roleCandidate).toMatchObject({
        priority: 70,
        kind: 'getByRole',
        value: 'button:Submit',
        code: "page.getByRole('button', { name: 'Submit' })",
      })
    })

    it('should use aria-label as accessible name when text is too long', () => {
      const elementInfo: ElementInfo = {
        tagName: 'button',
        role: 'button',
        ariaLabel: 'Submit Form',
        text: 'This is a very long text that exceeds thirty characters limit',
      }

      const candidates = generateLocatorCandidates(elementInfo)

      const roleCandidate = candidates.find((c) => c.kind === 'getByRole')
      expect(roleCandidate).toMatchObject({
        priority: 70,
        code: "page.getByRole('button', { name: 'Submit Form' })",
      })
    })

    it('should generate placeholder with priority 60', () => {
      const elementInfo: ElementInfo = {
        tagName: 'input',
        placeholder: 'Email address',
      }

      const candidates = generateLocatorCandidates(elementInfo)

      const placeholderCandidate = candidates.find((c) => c.kind === 'getByPlaceholder')
      expect(placeholderCandidate).toMatchObject({
        priority: 60,
        kind: 'getByPlaceholder',
        value: 'Email address',
      })
    })

    it('should generate exact text with priority 50 for short text', () => {
      const elementInfo: ElementInfo = {
        tagName: 'button',
        text: 'Submit',
      }

      const candidates = generateLocatorCandidates(elementInfo)

      const exactTextCandidate = candidates.find((c) => c.kind === 'textExact')
      expect(exactTextCandidate).toMatchObject({
        priority: 50,
        kind: 'textExact',
        value: 'Submit',
        code: "page.getByText('Submit', { exact: true })",
      })
    })

    it('should not generate exact text for multiline text', () => {
      const elementInfo: ElementInfo = {
        tagName: 'div',
        text: 'Line 1\nLine 2',
      }

      const candidates = generateLocatorCandidates(elementInfo)

      const exactTextCandidate = candidates.find((c) => c.kind === 'textExact')
      expect(exactTextCandidate).toBeUndefined()
    })

    it('should not generate exact text for text >= 30 chars', () => {
      const elementInfo: ElementInfo = {
        tagName: 'div',
        text: 'this is a very long text content',
      }

      const candidates = generateLocatorCandidates(elementInfo)

      const exactTextCandidate = candidates.find((c) => c.kind === 'textExact')
      expect(exactTextCandidate).toBeUndefined()
    })

    it('should generate partial text with priority 40', () => {
      const elementInfo: ElementInfo = {
        tagName: 'div',
        text: 'Submit the form now',
      }

      const candidates = generateLocatorCandidates(elementInfo)

      const partialTextCandidate = candidates.find((c) => c.kind === 'text')
      expect(partialTextCandidate).toMatchObject({
        priority: 40,
        kind: 'text',
        code: "page.getByText('Submit the form now')",
      })
    })

    it('should generate aria-label with priority 30', () => {
      const elementInfo: ElementInfo = {
        tagName: 'input',
        ariaLabel: 'Email',
      }

      const candidates = generateLocatorCandidates(elementInfo)

      const ariaLabelCandidate = candidates.find((c) => c.kind === 'getByLabel')
      expect(ariaLabelCandidate).toMatchObject({
        priority: 30,
        kind: 'getByLabel',
        value: 'Email',
      })
    })

    it('should generate name attribute with priority 20', () => {
      const elementInfo: ElementInfo = {
        tagName: 'input',
        name: 'email',
      }

      const candidates = generateLocatorCandidates(elementInfo)

      const nameCandidate = candidates.find((c) => c.reason === 'Name attribute')
      expect(nameCandidate).toMatchObject({
        priority: 20,
        kind: 'cssAttr',
        value: 'name="email"',
        code: "page.locator('[name=\"email\"]')",
      })
    })

    it('should filter out state classes and generate CSS class with priority 10', () => {
      const elementInfo: ElementInfo = {
        tagName: 'div',
        className: 'active selected hover container',
      }

      const candidates = generateLocatorCandidates(elementInfo)

      const classCandidate = candidates.find((c) => c.reason === 'CSS class')
      expect(classCandidate).toMatchObject({
        priority: 10,
        kind: 'cssSelector',
        value: 'container',
        code: "page.locator('.container')",
      })
    })

    it('should generate tag name fallback with priority 5', () => {
      const elementInfo: ElementInfo = {
        tagName: 'button',
      }

      const candidates = generateLocatorCandidates(elementInfo)

      const tagCandidate = candidates.find((c) => c.reason === 'Tag name (fallback)')
      expect(tagCandidate).toMatchObject({
        priority: 5,
        kind: 'cssSelector',
        value: 'button',
        code: "page.locator('button')",
      })
    })

    it('should sort candidates by priority descending', () => {
      const elementInfo: ElementInfo = {
        tagName: 'button',
        testId: 'submit',
        id: 'btn-submit',
        className: 'btn',
        text: 'Submit',
      }

      const candidates = generateLocatorCandidates(elementInfo)

      const priorities = candidates.map((c) => c.priority)
      for (let i = 0; i < priorities.length - 1; i++) {
        expect(priorities[i]).toBeGreaterThanOrEqual(priorities[i + 1])
      }
    })
  })

  describe('locatorCodeToSelector', () => {
    it('should convert getByTestId to data-testid selector', () => {
      const result = locatorCodeToSelector("page.getByTestId('submit')")
      expect(result).toBe('[data-testid="submit"]')
    })

    it('should convert getByRole to role selector', () => {
      const result = locatorCodeToSelector("page.getByRole('button')")
      expect(result).toBe('[role="button"]')
    })

    it('should convert getByRole with name to role+aria-label selector', () => {
      const result = locatorCodeToSelector("page.getByRole('button', { name: 'Submit' })")
      expect(result).toBe('[role="button"][aria-label~="Submit"]')
    })

    it('should convert getByPlaceholder to placeholder selector', () => {
      const result = locatorCodeToSelector("page.getByPlaceholder('Email')")
      expect(result).toBe('[placeholder="Email"]')
    })

    it('should convert getByLabel to aria-label selector', () => {
      const result = locatorCodeToSelector("page.getByLabel('Email')")
      expect(result).toBe('[aria-label="Email"]')
    })

    it('should convert locator with ID to # selector', () => {
      const result = locatorCodeToSelector("page.locator('#submit')")
      expect(result).toBe('#submit')
    })

    it('should convert locator with name attribute to [name=] selector', () => {
      const result = locatorCodeToSelector("page.locator('[name=\"email\"]')")
      expect(result).toBe('[name="email"]')
    })

    it('should convert locator with class to . selector', () => {
      const result = locatorCodeToSelector("page.locator('.btn')")
      expect(result).toBe('.btn')
    })

    it('should return null for getByText (no CSS equivalent)', () => {
      const result = locatorCodeToSelector("page.getByText('Submit')")
      expect(result).toBeNull()
    })

    it('should return null for unparseable locator code', () => {
      const result = locatorCodeToSelector('page.unknownMethod("foo")')
      expect(result).toBeNull()
    })
  })

  describe('recommendBestLocator', () => {
    it('should return the highest priority unique locator', () => {
      const validated: ValidatedLocator[] = [
        {
          kind: 'getByTestId',
          value: 'submit',
          code: "page.getByTestId('submit')",
          priority: 100,
          reason: 'data-testid',
          validation: { unique: true },
        },
        {
          kind: 'cssId',
          value: 'btn',
          code: "page.locator('#btn')",
          priority: 80,
          reason: 'ID',
          validation: { unique: true },
        },
      ]

      const result = recommendBestLocator(validated)
      expect(result).toMatchObject({
        kind: 'getByTestId',
        priority: 100,
      })
    })

    it('should return null for empty array', () => {
      const result = recommendBestLocator([])
      expect(result).toBeNull()
    })

    it('should fallback to highest priority when no unique locators exist', () => {
      const validated: ValidatedLocator[] = [
        {
          kind: 'text',
          value: 'Submit',
          code: "page.getByText('Submit')",
          priority: 40,
          reason: 'Partial text',
          validation: { unique: false },
        },
        {
          kind: 'cssSelector',
          value: 'button',
          code: "page.locator('button')",
          priority: 5,
          reason: 'Tag',
          validation: { unique: false },
        },
      ]

      const result = recommendBestLocator(validated)
      expect(result).toMatchObject({
        kind: 'text',
        priority: 40,
      })
    })
  })

  describe('formatLocatorCandidates', () => {
    it('should format candidates with checkmarks for unique locators', () => {
      const validated: ValidatedLocator[] = [
        {
          kind: 'getByTestId',
          value: 'submit',
          code: "page.getByTestId('submit')",
          priority: 100,
          reason: 'data-testid attribute (recommended)',
          validation: { unique: true },
        },
        {
          kind: 'text',
          value: 'Submit',
          code: "page.getByText('Submit')",
          priority: 40,
          reason: 'Partial text match',
          validation: { unique: false },
        },
      ]

      const formatted = formatLocatorCandidates(validated)

      expect(formatted).toContain('✅')
      expect(formatted).toContain("page.getByTestId('submit')")
      expect(formatted).toContain('(唯一)')
      expect(formatted).toContain('⚠️')
      expect(formatted).toContain("(可能不唯一)")
    })

    it('should include recommendation section', () => {
      const validated: ValidatedLocator[] = [
        {
          kind: 'getByTestId',
          value: 'submit',
          code: "page.getByTestId('submit')",
          priority: 100,
          reason: 'data-testid attribute (recommended)',
          validation: { unique: true },
        },
      ]

      const formatted = formatLocatorCandidates(validated)

      expect(formatted).toContain('💡 推荐:')
      expect(formatted).toContain('✅ 唯一')
    })
  })
})
