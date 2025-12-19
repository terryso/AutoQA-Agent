import { describe, it, expect } from 'vitest'

import {
  sanitizePathSegment,
  generateExportFileName,
  getExportDir,
  getExportPath,
  getRelativeExportPath,
  toSafeRelativePath,
} from '../../src/runner/export-paths.js'

describe('export-paths', () => {
  describe('sanitizePathSegment', () => {
    it('removes directory traversal sequences', () => {
      expect(sanitizePathSegment('../../../etc/passwd')).toBe('etc_passwd')
      expect(sanitizePathSegment('foo/../bar')).toBe('foo___bar')
    })

    it('removes unsafe characters', () => {
      expect(sanitizePathSegment('file<name>:test')).toBe('file_name__test')
      expect(sanitizePathSegment('file|name?test*')).toBe('file_name_test')
    })

    it('normalizes slashes to underscores', () => {
      expect(sanitizePathSegment('path/to/file')).toBe('path_to_file')
      expect(sanitizePathSegment('path\\to\\file')).toBe('path_to_file')
    })

    it('converts slashes to underscores', () => {
      // Slashes are converted to underscores, then leading/trailing underscores are stripped
      expect(sanitizePathSegment('/path/')).toBe('path')
      expect(sanitizePathSegment('///path///')).toBe('path')
    })

    it('truncates to 200 characters', () => {
      const longSegment = 'a'.repeat(300)
      expect(sanitizePathSegment(longSegment).length).toBe(200)
    })
  })

  describe('generateExportFileName', () => {
    const cwd = '/project'

    it('generates .spec.ts filename from spec path', () => {
      expect(generateExportFileName('/project/specs/login.md', cwd)).toBe('specs-login.spec.ts')
    })

    it('handles nested paths', () => {
      expect(generateExportFileName('/project/specs/auth/login.md', cwd)).toBe('specs-auth-login.spec.ts')
    })

    it('handles paths outside cwd', () => {
      expect(generateExportFileName('/other/specs/test.md', cwd)).toBe('test.spec.ts')
    })

    it('removes .md extension', () => {
      expect(generateExportFileName('/project/test.md', cwd)).toBe('test.spec.ts')
      expect(generateExportFileName('/project/test.MD', cwd)).toBe('test.spec.ts')
    })
  })

  describe('getExportDir', () => {
    it('returns tests/autoqa path by default', () => {
      expect(getExportDir('/project')).toBe('/project/tests/autoqa')
    })

    it('returns custom export directory when specified', () => {
      expect(getExportDir('/project', 'custom/output')).toBe('/project/custom/output')
    })
  })

  describe('getExportPath', () => {
    it('returns full export path with default directory', () => {
      expect(getExportPath('/project', '/project/specs/login.md')).toBe(
        '/project/tests/autoqa/specs-login.spec.ts',
      )
    })

    it('returns full export path with custom directory', () => {
      expect(getExportPath('/project', '/project/specs/login.md', 'custom/output')).toBe(
        '/project/custom/output/specs-login.spec.ts',
      )
    })
  })

  describe('getRelativeExportPath', () => {
    it('returns relative path with default directory', () => {
      expect(getRelativeExportPath('/project', '/project/specs/login.md')).toBe(
        'tests/autoqa/specs-login.spec.ts',
      )
    })

    it('returns relative path with custom directory', () => {
      expect(getRelativeExportPath('/project', '/project/specs/login.md', 'custom/output')).toBe(
        'custom/output/specs-login.spec.ts',
      )
    })
  })

  describe('toSafeRelativePath', () => {
    const cwd = '/project'

    it('converts absolute path to relative', () => {
      expect(toSafeRelativePath('/project/tests/autoqa/test.spec.ts', cwd)).toBe(
        'tests/autoqa/test.spec.ts',
      )
    })

    it('handles cwd with trailing slash', () => {
      expect(toSafeRelativePath('/project/tests/autoqa/test.spec.ts', '/project/')).toBe(
        'tests/autoqa/test.spec.ts',
      )
    })

    it('extracts spec.ts filename from unknown paths', () => {
      expect(toSafeRelativePath('/unknown/custom/output/test.spec.ts', cwd)).toBe(
        'test.spec.ts',
      )
    })

    it('returns redacted path for unrecognized paths', () => {
      expect(toSafeRelativePath('/other/path/file.ts', cwd)).toBe(
        '[redacted].spec.ts',
      )
    })
  })
})
