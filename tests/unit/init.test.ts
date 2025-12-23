import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createProgram } from '../../src/cli/program.js'

describe('autoqa init', () => {
  it('creates autoqa.config.json with schemaVersion', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'autoqa-init-'))
    const originalCwd = process.cwd()

    try {
      process.chdir(tempDir)

      const program = createProgram({
        initCommandDeps: {
          probeAgentSdkAuth: async () => ({ kind: 'unknown' }),
        },
      })
      program.configureOutput({
        writeOut: () => {},
        writeErr: () => {},
      })

      await program.parseAsync(['init'], { from: 'user' })

      const configPath = join(tempDir, 'autoqa.config.json')
      const contents = readFileSync(configPath, 'utf8')

      expect(contents.endsWith('\n')).toBe(true)
      expect(JSON.parse(contents)).toEqual({
        schemaVersion: 1,
        guardrails: {
          maxToolCallsPerSpec: 200,
          maxConsecutiveErrors: 8,
          maxRetriesPerStep: 5,
        },
        exportDir: 'tests/autoqa',
      })
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('creates specs/login-example.md with minimal Markdown structure', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'autoqa-init-'))
    const originalCwd = process.cwd()

    try {
      process.chdir(tempDir)

      const program = createProgram({
        initCommandDeps: {
          probeAgentSdkAuth: async () => ({ kind: 'unknown' }),
        },
      })
      program.configureOutput({
        writeOut: () => {},
        writeErr: () => {},
      })

      await program.parseAsync(['init'], { from: 'user' })

      const specsDirPath = join(tempDir, 'specs')
      const exampleSpecPath = join(specsDirPath, 'login-example.md')

      expect(existsSync(specsDirPath)).toBe(true)
      expect(existsSync(exampleSpecPath)).toBe(true)

      const contents = readFileSync(exampleSpecPath, 'utf8')
      expect(contents).toContain('## Preconditions')
      expect(contents).toMatch(/^1\./m)
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('does not overwrite existing specs/login-example.md and still succeeds', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'autoqa-init-'))
    const originalCwd = process.cwd()

    let stdout = ''

    try {
      process.chdir(tempDir)

      const specsDirPath = join(tempDir, 'specs')
      mkdirSync(specsDirPath, { recursive: true })

      const exampleSpecPath = join(specsDirPath, 'login-example.md')
      const customContents = '# Custom Spec\n\n## Preconditions\n\n- custom\n\n1. step\n\n'
      writeFileSync(exampleSpecPath, customContents, 'utf8')

      const program = createProgram({
        initCommandDeps: {
          probeAgentSdkAuth: async () => ({ kind: 'unknown' }),
        },
      })
      program.configureOutput({
        writeOut: (str: string) => {
          stdout += str
        },
        writeErr: () => {},
      })

      await program.parseAsync(['init'], { from: 'user' })

      const configPath = join(tempDir, 'autoqa.config.json')
      expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual({
        schemaVersion: 1,
        guardrails: {
          maxToolCallsPerSpec: 200,
          maxConsecutiveErrors: 8,
          maxRetriesPerStep: 5,
        },
        exportDir: 'tests/autoqa',
      })
      expect(readFileSync(exampleSpecPath, 'utf8')).toBe(customContents)

      expect(stdout).toContain('specs/login-example.md already exists. Skipping.')
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('rolls back autoqa.config.json and exits with code 2 if specs directory cannot be created', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'autoqa-init-'))
    const originalCwd = process.cwd()

    try {
      process.chdir(tempDir)

      const specsPath = join(tempDir, 'specs')
      writeFileSync(specsPath, 'not a directory', 'utf8')

      let errOutput = ''

      const program = createProgram({
        initCommandDeps: {
          probeAgentSdkAuth: async () => ({ kind: 'unknown' }),
        },
      })
      program.configureOutput({
        writeOut: () => {},
        writeErr: (str) => {
          errOutput += str
        },
      })
      program.exitOverride()

      let exitCode: number | undefined

      try {
        await program.parseAsync(['init'], { from: 'user' })
      } catch (err: any) {
        exitCode = err.exitCode
      }

      expect(exitCode).toBe(2)
      expect(errOutput).toContain('Failed to create specs/login-example.md')
      expect(errOutput).toContain('Rolled back autoqa.config.json')

      const configPath = join(tempDir, 'autoqa.config.json')
      expect(existsSync(configPath)).toBe(false)
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('refuses to overwrite existing autoqa.config.json and exits with code 2', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'autoqa-init-'))
    const originalCwd = process.cwd()

    try {
      process.chdir(tempDir)

      const configPath = join(tempDir, 'autoqa.config.json')
      writeFileSync(configPath, '{\n  "schemaVersion": 999\n}\n', 'utf8')

      let errOutput = ''

      const program = createProgram({
        initCommandDeps: {
          probeAgentSdkAuth: async () => ({ kind: 'unknown' }),
        },
      })
      program.configureOutput({
        writeOut: () => {},
        writeErr: (str) => {
          errOutput += str
        },
      })
      program.exitOverride()

      let exitCode: number | undefined

      try {
        await program.parseAsync(['init'], { from: 'user' })
      } catch (err: any) {
        exitCode = err.exitCode
      }

      expect(exitCode).toBe(2)
      expect(errOutput).toContain('Refusing to overwrite')
      expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual({ schemaVersion: 999 })
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('prints a clear message when Claude Code auth is available (no ANTHROPIC_API_KEY needed)', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'autoqa-init-'))
    const originalCwd = process.cwd()

    let stdout = ''

    try {
      process.chdir(tempDir)

      const program = createProgram({
        initCommandDeps: {
          probeAgentSdkAuth: async () => ({ kind: 'available' }),
        },
      })
      program.configureOutput({
        writeOut: (str: string) => {
          stdout += str
        },
        writeErr: () => {},
      })

      await program.parseAsync(['init'], { from: 'user' })

      expect(stdout).toContain('No ANTHROPIC_API_KEY needed')
      expect(existsSync(join(tempDir, 'autoqa.config.json'))).toBe(true)
      expect(existsSync(join(tempDir, 'specs', 'login-example.md'))).toBe(true)
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('prints a clear message when Claude Code auth is unavailable and ANTHROPIC_API_KEY is not set', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'autoqa-init-'))
    const originalCwd = process.cwd()

    const originalApiKey = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY

    let stdout = ''

    try {
      process.chdir(tempDir)

      const program = createProgram({
        initCommandDeps: {
          probeAgentSdkAuth: async () => {
            throw { code: 'AUTHENTICATION_FAILED' }
          },
        },
      })
      program.configureOutput({
        writeOut: (str: string) => {
          stdout += str
        },
        writeErr: () => {},
      })

      await program.parseAsync(['init'], { from: 'user' })

      expect(stdout).toContain('ANTHROPIC_API_KEY is required')
      expect(existsSync(join(tempDir, 'autoqa.config.json'))).toBe(true)
      expect(existsSync(join(tempDir, 'specs', 'login-example.md'))).toBe(true)
    } finally {
      if (typeof originalApiKey === 'string') process.env.ANTHROPIC_API_KEY = originalApiKey
      else delete process.env.ANTHROPIC_API_KEY

      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('creates tests/helpers/autoqa-env.ts with expected content', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'autoqa-init-'))
    const originalCwd = process.cwd()

    try {
      process.chdir(tempDir)

      const program = createProgram({
        initCommandDeps: {
          probeAgentSdkAuth: async () => ({ kind: 'unknown' }),
        },
      })
      program.configureOutput({
        writeOut: () => {},
        writeErr: () => {},
      })

      await program.parseAsync(['init'], { from: 'user' })

      const helperPath = join(tempDir, 'tests/helpers/autoqa-env.ts')

      expect(existsSync(helperPath)).toBe(true)

      const contents = readFileSync(helperPath, 'utf8')
      expect(contents).toContain('export function loadEnvFiles()')
      expect(contents).toContain('export function getEnvVar(')
      expect(contents).toContain('AutoQA Environment Helper')
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('does not overwrite existing tests/helpers/autoqa-env.ts', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'autoqa-init-'))
    const originalCwd = process.cwd()

    let stdout = ''

    try {
      process.chdir(tempDir)

      const helpersDirPath = join(tempDir, 'tests/helpers')
      mkdirSync(helpersDirPath, { recursive: true })

      const helperPath = join(helpersDirPath, 'autoqa-env.ts')
      const customContents = '// Custom helper\nexport const custom = true\n'
      writeFileSync(helperPath, customContents, 'utf8')

      const program = createProgram({
        initCommandDeps: {
          probeAgentSdkAuth: async () => ({ kind: 'unknown' }),
        },
      })
      program.configureOutput({
        writeOut: (str: string) => {
          stdout += str
        },
        writeErr: () => {},
      })

      await program.parseAsync(['init'], { from: 'user' })

      expect(readFileSync(helperPath, 'utf8')).toBe(customContents)
      expect(stdout).toContain('tests/helpers/autoqa-env.ts already exists. Skipping.')
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('rolls back autoqa.config.json if tests/helpers directory cannot be created', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'autoqa-init-'))
    const originalCwd = process.cwd()

    try {
      process.chdir(tempDir)

      const testsPath = join(tempDir, 'tests')
      mkdirSync(testsPath, { recursive: true })

      const helpersPath = join(testsPath, 'helpers')
      writeFileSync(helpersPath, 'not a directory', 'utf8')

      let errOutput = ''

      const program = createProgram({
        initCommandDeps: {
          probeAgentSdkAuth: async () => ({ kind: 'unknown' }),
        },
      })
      program.configureOutput({
        writeOut: () => {},
        writeErr: (str) => {
          errOutput += str
        },
      })
      program.exitOverride()

      let exitCode: number | undefined

      try {
        await program.parseAsync(['init'], { from: 'user' })
      } catch (err: any) {
        exitCode = err.exitCode
      }

      expect(exitCode).toBe(2)
      expect(errOutput).toContain('Failed to create tests/helpers/autoqa-env.ts')
      expect(errOutput).toContain('Rolled back autoqa.config.json')

      const configPath = join(tempDir, 'autoqa.config.json')
      expect(existsSync(configPath)).toBe(false)
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('prints a conservative message when probe fails with non-auth error (do not assume unauthorized)', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'autoqa-init-'))
    const originalCwd = process.cwd()

    let stdout = ''

    try {
      process.chdir(tempDir)

      const program = createProgram({
        initCommandDeps: {
          probeAgentSdkAuth: async () => {
            throw { code: 'ECONNRESET' }
          },
        },
      })
      program.configureOutput({
        writeOut: (str: string) => {
          stdout += str
        },
        writeErr: () => {},
      })

      await program.parseAsync(['init'], { from: 'user' })

      expect(stdout).toContain('Unable to confirm Claude Code authorization status')
      expect(existsSync(join(tempDir, 'autoqa.config.json'))).toBe(true)
      expect(existsSync(join(tempDir, 'specs', 'login-example.md'))).toBe(true)
    } finally {
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
