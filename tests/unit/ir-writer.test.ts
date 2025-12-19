import { describe, it, expect } from 'vitest'

import {
  sanitizePathSegment,
  buildIRPath,
  toSafeRelativePath,
  redactToolInputForIR,
} from '../../src/ir/writer.js'

describe('IR Writer', () => {
  describe('sanitizePathSegment', () => {
    it('should return the segment unchanged for safe input', () => {
      expect(sanitizePathSegment('abc123')).toBe('abc123')
      expect(sanitizePathSegment('run-2024-01-01')).toBe('run-2024-01-01')
    })

    it('should remove directory traversal sequences', () => {
      expect(sanitizePathSegment('../etc/passwd')).toBe('etc_passwd')
      expect(sanitizePathSegment('..\\..\\windows')).toBe('windows')
      expect(sanitizePathSegment('foo/../bar')).toBe('foo_bar')
    })

    it('should replace slashes with underscores', () => {
      expect(sanitizePathSegment('foo/bar/baz')).toBe('foo_bar_baz')
      expect(sanitizePathSegment('foo\\bar\\baz')).toBe('foo_bar_baz')
    })

    it('should remove dangerous characters', () => {
      expect(sanitizePathSegment('foo<bar>baz')).toBe('foobarbaz')
      expect(sanitizePathSegment('foo:bar')).toBe('foobar')
      expect(sanitizePathSegment('foo|bar')).toBe('foobar')
      expect(sanitizePathSegment('foo?bar')).toBe('foobar')
      expect(sanitizePathSegment('foo*bar')).toBe('foobar')
    })

    it('should handle empty or invalid input', () => {
      expect(sanitizePathSegment('')).toBe('unknown')
      expect(sanitizePathSegment('.')).toBe('unknown')
      expect(sanitizePathSegment('..')).toBe('unknown')
      expect(sanitizePathSegment(null as any)).toBe('unknown')
      expect(sanitizePathSegment(undefined as any)).toBe('unknown')
    })

    it('should truncate very long segments', () => {
      const longSegment = 'a'.repeat(300)
      const result = sanitizePathSegment(longSegment)
      expect(result.length).toBeLessThanOrEqual(200)
    })

    it('should remove leading dots', () => {
      expect(sanitizePathSegment('.hidden')).toBe('hidden')
      expect(sanitizePathSegment('...dots')).toBe('dots')
    })
  })

  describe('buildIRPath', () => {
    it('should build correct path for valid runId', () => {
      const result = buildIRPath('/home/user/project', 'run-123')
      expect(result).toBe('/home/user/project/.autoqa/runs/run-123/ir.jsonl')
    })

    it('should sanitize runId in path', () => {
      const result = buildIRPath('/home/user/project', '../../../etc')
      expect(result).not.toContain('..')
      expect(result).toContain('.autoqa/runs/')
      expect(result).toContain('/ir.jsonl')
    })

    it('should handle Windows-style paths in runId', () => {
      const result = buildIRPath('/home/user/project', 'foo\\bar')
      expect(result).not.toContain('\\')
    })
  })

  describe('toSafeRelativePath', () => {
    it('should convert absolute path to relative', () => {
      const result = toSafeRelativePath(
        '/home/user/project/.autoqa/runs/run-123/ir.jsonl',
        '/home/user/project',
      )
      expect(result).toBe('.autoqa/runs/run-123/ir.jsonl')
    })

    it('should handle cwd with trailing slash', () => {
      const result = toSafeRelativePath(
        '/home/user/project/.autoqa/runs/run-123/ir.jsonl',
        '/home/user/project/',
      )
      expect(result).toBe('.autoqa/runs/run-123/ir.jsonl')
    })

    it('should extract .autoqa path from unrelated absolute path', () => {
      const result = toSafeRelativePath(
        '/other/path/.autoqa/runs/run-123/ir.jsonl',
        '/home/user/project',
      )
      expect(result).toBe('.autoqa/runs/run-123/ir.jsonl')
    })

    it('should redact path if no safe extraction possible', () => {
      const result = toSafeRelativePath(
        '/etc/passwd',
        '/home/user/project',
      )
      expect(result).toBe('.autoqa/runs/[redacted]/ir.jsonl')
      expect(result).not.toContain('/etc/')
    })
  })

  describe('redactToolInputForIR', () => {
    it('should redact fill text and replace with length', () => {
      const result = redactToolInputForIR('fill', {
        targetDescription: 'password field',
        text: 'secret123',
      })
      expect(result.textLength).toBe(9)
      expect(result.text).toBeUndefined()
      expect(result.targetDescription).toBe('password field')
    })

    it('should redact fill text for password input (regression test for sensitive data)', () => {
      const result = redactToolInputForIR('fill', {
        targetDescription: 'Password input',
        text: 'my_secret_password_123',
      })
      expect(result.textLength).toBe(22)
      expect(result.text).toBeUndefined()
      expect(JSON.stringify(result)).not.toContain('my_secret_password_123')
    })

    it('should redact fill text for username input (regression test for sensitive data)', () => {
      const result = redactToolInputForIR('fill', {
        targetDescription: 'Username input',
        text: 'admin_user',
      })
      expect(result.textLength).toBe(10)
      expect(result.text).toBeUndefined()
      expect(JSON.stringify(result)).not.toContain('admin_user')
    })

    it('should preserve fillValue in fill tool input', () => {
      const result = redactToolInputForIR('fill', {
        targetDescription: 'Username input',
        text: 'admin_user',
        fillValue: { kind: 'template_var', name: 'USERNAME' },
      })
      expect(result.fillValue).toEqual({ kind: 'template_var', name: 'USERNAME' })
      expect(result.textLength).toBe(10)
      expect(result.text).toBeUndefined()
    })

    it('should preserve literal fillValue in fill tool input', () => {
      const result = redactToolInputForIR('fill', {
        targetDescription: 'Search input',
        text: '暖场',
        fillValue: { kind: 'literal', value: '暖场' },
      })
      expect(result.fillValue).toEqual({ kind: 'literal', value: '暖场' })
      expect(result.textLength).toBe(2)
      expect(result.text).toBeUndefined()
    })

    it('should not redact text for non-fill tools', () => {
      const result = redactToolInputForIR('click', {
        targetDescription: 'submit button',
        text: 'some text',
      })
      expect(result.text).toBe('some text')
      expect(result.textLength).toBeUndefined()
    })

    it('should truncate long string values', () => {
      const longValue = 'a'.repeat(300)
      const result = redactToolInputForIR('click', {
        targetDescription: longValue,
      })
      expect((result.targetDescription as string).length).toBeLessThan(300)
      expect(result.targetDescription).toContain('...[truncated]')
    })

    it('should preserve non-string values', () => {
      const result = redactToolInputForIR('scroll', {
        direction: 'down',
        amount: 100,
        nested: { foo: 'bar' },
      })
      expect(result.direction).toBe('down')
      expect(result.amount).toBe(100)
      expect(result.nested).toEqual({ foo: 'bar' })
    })
  })
})
