import { describe, it, expect } from 'vitest'

import {
  truncateString,
  redactUrlCredentials,
  sanitizeOriginOnly,
  redactToolInput,
  sanitizeRelativePath,
} from '../../src/logging/redact.js'

describe('truncateString', () => {
  it('returns original string if within limit', () => {
    expect(truncateString('hello', 10)).toBe('hello')
  })

  it('truncates long strings with marker', () => {
    const result = truncateString('a'.repeat(500), 400)
    expect(result.length).toBeLessThan(500)
    expect(result).toContain('...[truncated]')
  })

  it('uses default max length of 400', () => {
    const short = 'a'.repeat(400)
    const long = 'a'.repeat(401)
    expect(truncateString(short)).toBe(short)
    expect(truncateString(long)).toContain('...[truncated]')
  })
})

describe('redactUrlCredentials', () => {
  it('removes username and password from URL', () => {
    const result = redactUrlCredentials('https://user:pass@example.com/path')
    expect(result).not.toContain('user')
    expect(result).not.toContain('pass')
    expect(result).toContain('example.com')
  })

  it('redacts sensitive query parameters', () => {
    const result = redactUrlCredentials('https://example.com?token=secret123&name=test')
    expect(result).toContain('REDACTED')
    expect(result).not.toContain('secret123')
    expect(result).toContain('name=test')
  })

  it('redacts api_key parameter', () => {
    const result = redactUrlCredentials('https://example.com?api_key=mykey')
    expect(result).toContain('REDACTED')
    expect(result).not.toContain('mykey')
  })

  it('handles invalid URLs gracefully', () => {
    const result = redactUrlCredentials('not-a-valid-url')
    expect(result).toBe('not-a-valid-url')
  })
})

describe('sanitizeOriginOnly', () => {
  it('returns only origin from full URL', () => {
    expect(sanitizeOriginOnly('https://example.com/path?query=1')).toBe('https://example.com')
  })

  it('handles invalid URLs by returning original', () => {
    expect(sanitizeOriginOnly('not-a-url')).toBe('not-a-url')
  })
})

describe('redactToolInput', () => {
  it('redacts fill text to textLength only', () => {
    const result = redactToolInput('fill', { targetDescription: 'input', text: 'secret password' })
    expect(result).not.toHaveProperty('text')
    expect(result.textLength).toBe(15)
    expect(result.targetDescription).toBe('input')
  })

  it('redacts navigate URL credentials', () => {
    const result = redactToolInput('navigate', { url: 'https://user:pass@example.com/path' })
    expect(result.url).not.toContain('user')
    expect(result.url).not.toContain('pass')
  })

  it('truncates long string values', () => {
    const longValue = 'a'.repeat(500)
    const result = redactToolInput('click', { targetDescription: longValue })
    expect((result.targetDescription as string).length).toBeLessThan(500)
  })

  it('preserves non-string values', () => {
    const result = redactToolInput('scroll', { direction: 'down', amount: 100 })
    expect(result.direction).toBe('down')
    expect(result.amount).toBe(100)
  })
})

describe('sanitizeRelativePath', () => {
  it('converts absolute path to relative', () => {
    const result = sanitizeRelativePath('/home/user/project/.autoqa/runs/abc/screenshots/test.jpg', '/home/user/project')
    expect(result).toBe('.autoqa/runs/abc/screenshots/test.jpg')
  })

  it('extracts .autoqa path from unknown absolute path', () => {
    const result = sanitizeRelativePath('/unknown/path/.autoqa/runs/xyz/file.log', '/different/cwd')
    expect(result).toBe('.autoqa/runs/xyz/file.log')
  })

  it('returns redacted marker for unrecognized paths', () => {
    const result = sanitizeRelativePath('/some/other/path/file.txt', '/home/user')
    expect(result).toBe('[path-redacted]')
  })

  it('handles cwd with trailing slash', () => {
    const result = sanitizeRelativePath('/home/user/project/.autoqa/runs/abc/test.jpg', '/home/user/project/')
    expect(result).toBe('.autoqa/runs/abc/test.jpg')
  })
})
