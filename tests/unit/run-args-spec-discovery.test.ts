import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const runPreflightMock = vi.fn(async (_options: any) => ({ ok: true as const }))
vi.mock('../../src/runner/preflight.js', () => ({
  runPreflight: runPreflightMock,
}))

beforeEach(() => {
  runPreflightMock.mockClear()
})

describe('autoqa run (args & spec discovery)', () => {
  it('discovers Markdown specs under a directory recursively in deterministic order', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'autoqa-run-'))
    const originalCwd = process.cwd()

    let stdout = ''

    try {
      const specsDir = join(tempDir, 'specs')
      mkdirSync(join(specsDir, 'sub'), { recursive: true })

      writeFileSync(join(specsDir, 'z.md'), '# z\n', 'utf8')
      writeFileSync(join(specsDir, 'a.md'), '# a\n', 'utf8')
      writeFileSync(join(specsDir, 'sub', 'm.md'), '# m\n', 'utf8')
      writeFileSync(join(specsDir, 'sub', '1.md'), '# 1\n', 'utf8')
      writeFileSync(join(specsDir, 'sub', 'ignore.txt'), 'ignore', 'utf8')

      process.chdir(tempDir)

      const { createProgram } = await import('../../src/cli/program.js')
      const program = createProgram()
      program.configureOutput({
        writeOut: (str: string) => {
          stdout += str
        },
        writeErr: () => {},
      })

      await program.parseAsync(['run', specsDir, '--url', 'http://example.test'], { from: 'user' })

      const lines = stdout.trim().split('\n')

      expect(lines).toEqual([
        join(specsDir, 'a.md'),
        join(specsDir, 'sub', '1.md'),
        join(specsDir, 'sub', 'm.md'),
        join(specsDir, 'z.md'),
      ])
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('accepts a single Markdown file path', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'autoqa-run-'))
    const originalCwd = process.cwd()

    let stdout = ''

    try {
      const specPath = join(tempDir, 'single.md')
      writeFileSync(specPath, '# single\n', 'utf8')

      process.chdir(tempDir)

      const { createProgram } = await import('../../src/cli/program.js')
      const program = createProgram()
      program.configureOutput({
        writeOut: (str: string) => {
          stdout += str
        },
        writeErr: () => {},
      })

      await program.parseAsync(['run', specPath, '--url', 'http://example.test'], { from: 'user' })

      const lines = stdout.trim().split('\n')
      expect(lines).toEqual([specPath])
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('exits with code 2 when path does not exist', async () => {
    const { createProgram } = await import('../../src/cli/program.js')
    const program = createProgram()

    let errOutput = ''

    program.configureOutput({
      writeOut: () => {},
      writeErr: (str: string) => {
        errOutput += str
      },
    })
    program.exitOverride()

    let exitCode: number | undefined

    try {
      await program.parseAsync(['run', 'does-not-exist.md', '--url', 'http://example.test'], { from: 'user' })
    } catch (err: any) {
      exitCode = err.exitCode
    }

    expect(exitCode).toBe(2)
    expect(errOutput).toContain('Invalid spec path')
    expect(errOutput).toContain('does-not-exist.md')
    expect(errOutput).toContain('ENOENT')
  })

  it('exits with code 2 when directory contains no Markdown specs', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'autoqa-run-'))
    const originalCwd = process.cwd()

    try {
      const emptyDir = join(tempDir, 'empty')
      mkdirSync(emptyDir, { recursive: true })

      process.chdir(tempDir)

      const { createProgram } = await import('../../src/cli/program.js')
      const program = createProgram()
      let errOutput = ''

      program.configureOutput({
        writeOut: () => {},
        writeErr: (str: string) => {
          errOutput += str
        },
      })
      program.exitOverride()

      let exitCode: number | undefined

      try {
        await program.parseAsync(['run', emptyDir, '--url', 'http://example.test'], { from: 'user' })
      } catch (err: any) {
        exitCode = err.exitCode
      }

      expect(exitCode).toBe(2)
      expect(errOutput).toContain('No Markdown spec files found under directory')
      expect(errOutput).toContain(emptyDir)
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('exits with code 2 when given a non-Markdown file', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'autoqa-run-'))
    const originalCwd = process.cwd()

    try {
      const filePath = join(tempDir, 'not-md.txt')
      writeFileSync(filePath, 'not markdown', 'utf8')

      process.chdir(tempDir)

      const { createProgram } = await import('../../src/cli/program.js')
      const program = createProgram()
      let errOutput = ''

      program.configureOutput({
        writeOut: () => {},
        writeErr: (str: string) => {
          errOutput += str
        },
      })
      program.exitOverride()

      let exitCode: number | undefined

      try {
        await program.parseAsync(['run', filePath, '--url', 'http://example.test'], { from: 'user' })
      } catch (err: any) {
        exitCode = err.exitCode
      }

      expect(exitCode).toBe(2)
      expect(errOutput).toContain('Spec file must be a Markdown (.md) file')
      expect(errOutput).toContain(filePath)
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('exits with code 2 when path is not accessible (EACCES)', async () => {
    vi.resetModules()

    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs')

      return {
        ...actual,
        statSync: ((path: unknown, ...rest: unknown[]) => {
          const pathStr = String(path)
          if (pathStr.includes('no-access')) {
            const err: any = new Error('EACCES: permission denied')
            err.code = 'EACCES'
            throw err
          }

          return (actual.statSync as any)(path, ...(rest as any))
        }) as any,
      }
    })

    const { createProgram } = await import('../../src/cli/program.js')
    const program = createProgram()

    let errOutput = ''

    program.configureOutput({
      writeOut: () => {},
      writeErr: (str: string) => {
        errOutput += str
      },
    })
    program.exitOverride()

    let exitCode: number | undefined

    try {
      await program.parseAsync(['run', 'no-access.md', '--url', 'http://example.test'], { from: 'user' })
    } catch (err: any) {
      exitCode = err.exitCode
    } finally {
      vi.doUnmock('node:fs')
      vi.resetModules()
    }

    expect(exitCode).toBe(2)
    expect(errOutput).toContain('Invalid spec path')
    expect(errOutput).toContain('no-access')
    expect(errOutput).toContain('EACCES')
  })

  it('exits with code 2 when path is too long (ENAMETOOLONG)', async () => {
    vi.resetModules()

    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs')

      return {
        ...actual,
        statSync: ((path: unknown, ...rest: unknown[]) => {
          const pathStr = String(path)
          if (pathStr.includes('too-long')) {
            const err: any = new Error('ENAMETOOLONG: name too long')
            err.code = 'ENAMETOOLONG'
            throw err
          }

          return (actual.statSync as any)(path, ...(rest as any))
        }) as any,
      }
    })

    const { createProgram } = await import('../../src/cli/program.js')
    const program = createProgram()

    let errOutput = ''

    program.configureOutput({
      writeOut: () => {},
      writeErr: (str: string) => {
        errOutput += str
      },
    })
    program.exitOverride()

    let exitCode: number | undefined

    try {
      await program.parseAsync(['run', 'too-long.md', '--url', 'http://example.test'], { from: 'user' })
    } catch (err: any) {
      exitCode = err.exitCode
    } finally {
      vi.doUnmock('node:fs')
      vi.resetModules()
    }

    expect(exitCode).toBe(2)
    expect(errOutput).toContain('Invalid spec path')
    expect(errOutput).toContain('too-long')
    expect(errOutput).toContain('ENAMETOOLONG')
  })

  it('discovers Markdown specs via symlink file (does not follow symlink directories)', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'autoqa-run-'))
    const originalCwd = process.cwd()

    let stdout = ''

    try {
      const specsDir = join(tempDir, 'specs')
      mkdirSync(specsDir, { recursive: true })

      const realSpec = join(specsDir, 'real.md')
      writeFileSync(realSpec, '# real\n', 'utf8')

      const linkedSpec = join(specsDir, 'linked.md')
      symlinkSync(realSpec, linkedSpec)

      process.chdir(tempDir)

      const { createProgram } = await import('../../src/cli/program.js')
      const program = createProgram()
      program.configureOutput({
        writeOut: (str: string) => {
          stdout += str
        },
        writeErr: () => {},
      })

      await program.parseAsync(['run', specsDir, '--url', 'http://example.test'], { from: 'user' })

      const lines = stdout.trim().split('\n')

      expect(lines).toEqual([linkedSpec, realSpec].sort())
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('exits with code 2 when --url is missing', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'autoqa-run-'))
    const originalCwd = process.cwd()

    try {
      const specPath = join(tempDir, 'single.md')
      writeFileSync(specPath, '# single\n', 'utf8')

      process.chdir(tempDir)

      const { createProgram } = await import('../../src/cli/program.js')
      const program = createProgram()

      let errOutput = ''
      program.configureOutput({
        writeOut: () => {},
        writeErr: (str: string) => {
          errOutput += str
        },
      })
      program.exitOverride()

      let exitCode: number | undefined
      try {
        await program.parseAsync(['run', specPath], { from: 'user' })
      } catch (err: any) {
        exitCode = err.exitCode
      }

      expect(exitCode).toBe(2)
      expect(errOutput).toContain('Base URL is required')
      expect(runPreflightMock).not.toHaveBeenCalled()
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('exits with code 2 when --debug and --headless are both provided', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'autoqa-run-'))
    const originalCwd = process.cwd()

    try {
      const specPath = join(tempDir, 'single.md')
      writeFileSync(specPath, '# single\n', 'utf8')

      process.chdir(tempDir)

      const { createProgram } = await import('../../src/cli/program.js')
      const program = createProgram()

      let errOutput = ''
      program.configureOutput({
        writeOut: () => {},
        writeErr: (str: string) => {
          errOutput += str
        },
      })
      program.exitOverride()

      let exitCode: number | undefined
      try {
        await program.parseAsync(
          ['run', specPath, '--url', 'http://example.test', '--debug', '--headless'],
          { from: 'user' },
        )
      } catch (err: any) {
        exitCode = err.exitCode
      }

      expect(exitCode).toBe(2)
      expect(errOutput).toContain('Conflicting options')
      expect(runPreflightMock).not.toHaveBeenCalled()
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('exits with code 2 when --url is not a valid URL', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'autoqa-run-'))
    const originalCwd = process.cwd()

    try {
      const specPath = join(tempDir, 'single.md')
      writeFileSync(specPath, '# single\n', 'utf8')

      process.chdir(tempDir)

      const { createProgram } = await import('../../src/cli/program.js')
      const program = createProgram()

      let errOutput = ''
      program.configureOutput({
        writeOut: () => {},
        writeErr: (str: string) => {
          errOutput += str
        },
      })
      program.exitOverride()

      let exitCode: number | undefined
      try {
        await program.parseAsync(['run', specPath, '--url', 'not-a-url'], { from: 'user' })
      } catch (err: any) {
        exitCode = err.exitCode
      }

      expect(exitCode).toBe(2)
      expect(errOutput).toContain('Invalid --url')
      expect(runPreflightMock).not.toHaveBeenCalled()
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('normalizes --url by removing trailing slash (passed to preflight)', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'autoqa-run-'))
    const originalCwd = process.cwd()

    try {
      const specPath = join(tempDir, 'single.md')
      writeFileSync(specPath, '# single\n', 'utf8')

      process.chdir(tempDir)

      const { createProgram } = await import('../../src/cli/program.js')
      const program = createProgram()
      program.configureOutput({ writeOut: () => {}, writeErr: () => {} })

      await program.parseAsync(['run', specPath, '--url', 'http://example.test/'], { from: 'user' })

      expect(runPreflightMock).toHaveBeenCalledTimes(1)
      expect(runPreflightMock.mock.calls[0]?.[0]).toMatchObject({
        baseUrl: 'http://example.test',
      })
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('sanitizes baseUrl in logs (origin only)', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'autoqa-run-'))
    const originalCwd = process.cwd()

    let errOutput = ''

    try {
      const specPath = join(tempDir, 'single.md')
      writeFileSync(specPath, '# single\n', 'utf8')

      process.chdir(tempDir)

      const { createProgram } = await import('../../src/cli/program.js')
      const program = createProgram()
      program.configureOutput({
        writeOut: () => {},
        writeErr: (str: string) => {
          errOutput += str
        },
      })

      await program.parseAsync(['run', specPath, '--url', 'http://user:pass@example.test/path?token=secret'], {
        from: 'user',
      })

      expect(errOutput).toContain('baseUrl=http://example.test')
      expect(errOutput).not.toContain('user:pass')
      expect(errOutput).not.toContain('token=secret')
      expect(errOutput).not.toContain('/path')
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('defaults to headless=true when not in debug mode', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'autoqa-run-'))
    const originalCwd = process.cwd()

    try {
      const specPath = join(tempDir, 'single.md')
      writeFileSync(specPath, '# single\n', 'utf8')

      process.chdir(tempDir)

      const { createProgram } = await import('../../src/cli/program.js')
      const program = createProgram()
      program.configureOutput({ writeOut: () => {}, writeErr: () => {} })

      await program.parseAsync(['run', specPath, '--url', 'http://example.test'], { from: 'user' })

      expect(runPreflightMock).toHaveBeenCalledTimes(1)
      expect(runPreflightMock.mock.calls[0]?.[0]).toMatchObject({
        headless: true,
        debug: false,
        baseUrl: 'http://example.test',
      })
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('uses headless=false when --debug is provided', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'autoqa-run-'))
    const originalCwd = process.cwd()

    try {
      const specPath = join(tempDir, 'single.md')
      writeFileSync(specPath, '# single\n', 'utf8')

      process.chdir(tempDir)

      const { createProgram } = await import('../../src/cli/program.js')
      const program = createProgram()
      program.configureOutput({ writeOut: () => {}, writeErr: () => {} })

      await program.parseAsync(['run', specPath, '--url', 'http://example.test', '--debug'], { from: 'user' })

      expect(runPreflightMock).toHaveBeenCalledTimes(1)
      expect(runPreflightMock.mock.calls[0]?.[0]).toMatchObject({
        headless: false,
        debug: true,
        baseUrl: 'http://example.test',
      })
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('uses headless=true when --headless is explicitly provided', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'autoqa-run-'))
    const originalCwd = process.cwd()

    try {
      const specPath = join(tempDir, 'single.md')
      writeFileSync(specPath, '# single\n', 'utf8')

      process.chdir(tempDir)

      const { createProgram } = await import('../../src/cli/program.js')
      const program = createProgram()
      program.configureOutput({ writeOut: () => {}, writeErr: () => {} })

      await program.parseAsync(['run', specPath, '--url', 'http://example.test', '--headless'], { from: 'user' })

      expect(runPreflightMock).toHaveBeenCalledTimes(1)
      expect(runPreflightMock.mock.calls[0]?.[0]).toMatchObject({
        headless: true,
        debug: false,
        baseUrl: 'http://example.test',
      })
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
