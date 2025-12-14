import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { createProgram } from '../../src/cli/program.js'

describe('autoqa init', () => {
  it('creates autoqa.config.json with schemaVersion', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'autoqa-init-'))
    const originalCwd = process.cwd()

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      process.chdir(tempDir)

      const program = createProgram()
      program.configureOutput({
        writeOut: () => {},
        writeErr: () => {},
      })

      program.parse(['init'], { from: 'user' })

      const configPath = join(tempDir, 'autoqa.config.json')
      const contents = readFileSync(configPath, 'utf8')

      expect(contents.endsWith('\n')).toBe(true)
      expect(JSON.parse(contents)).toEqual({ schemaVersion: 1 })
    } finally {
      logSpy.mockRestore()
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('creates specs/login-example.md with minimal Markdown structure', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'autoqa-init-'))
    const originalCwd = process.cwd()

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      process.chdir(tempDir)

      const program = createProgram()
      program.configureOutput({
        writeOut: () => {},
        writeErr: () => {},
      })

      program.parse(['init'], { from: 'user' })

      const specsDirPath = join(tempDir, 'specs')
      const exampleSpecPath = join(specsDirPath, 'login-example.md')

      expect(existsSync(specsDirPath)).toBe(true)
      expect(existsSync(exampleSpecPath)).toBe(true)

      const contents = readFileSync(exampleSpecPath, 'utf8')
      expect(contents).toContain('## Preconditions')
      expect(contents).toMatch(/^1\./m)
    } finally {
      logSpy.mockRestore()
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('does not overwrite existing specs/login-example.md and still succeeds', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'autoqa-init-'))
    const originalCwd = process.cwd()

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      process.chdir(tempDir)

      const specsDirPath = join(tempDir, 'specs')
      mkdirSync(specsDirPath, { recursive: true })

      const exampleSpecPath = join(specsDirPath, 'login-example.md')
      const customContents = '# Custom Spec\n\n## Preconditions\n\n- custom\n\n1. step\n\n'
      writeFileSync(exampleSpecPath, customContents, 'utf8')

      const program = createProgram()
      program.configureOutput({
        writeOut: () => {},
        writeErr: () => {},
      })

      program.parse(['init'], { from: 'user' })

      const configPath = join(tempDir, 'autoqa.config.json')
      expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual({ schemaVersion: 1 })
      expect(readFileSync(exampleSpecPath, 'utf8')).toBe(customContents)

      expect(logSpy).toHaveBeenCalledWith('specs/login-example.md already exists. Skipping.')
    } finally {
      logSpy.mockRestore()
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('rolls back autoqa.config.json and exits with code 2 if specs directory cannot be created', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'autoqa-init-'))
    const originalCwd = process.cwd()

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      process.chdir(tempDir)

      const specsPath = join(tempDir, 'specs')
      writeFileSync(specsPath, 'not a directory', 'utf8')

      let errOutput = ''

      const program = createProgram()
      program.configureOutput({
        writeOut: () => {},
        writeErr: (str) => {
          errOutput += str
        },
      })
      program.exitOverride()

      let exitCode: number | undefined

      try {
        program.parse(['init'], { from: 'user' })
      } catch (err: any) {
        exitCode = err.exitCode
      }

      expect(exitCode).toBe(2)
      expect(errOutput).toContain('Failed to create specs/login-example.md')
      expect(errOutput).toContain('Rolled back autoqa.config.json')

      const configPath = join(tempDir, 'autoqa.config.json')
      expect(existsSync(configPath)).toBe(false)
    } finally {
      logSpy.mockRestore()
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('refuses to overwrite existing autoqa.config.json and exits with code 2', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'autoqa-init-'))
    const originalCwd = process.cwd()

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      process.chdir(tempDir)

      const configPath = join(tempDir, 'autoqa.config.json')
      writeFileSync(configPath, '{\n  "schemaVersion": 999\n}\n', 'utf8')

      let errOutput = ''

      const program = createProgram()
      program.configureOutput({
        writeOut: () => {},
        writeErr: (str) => {
          errOutput += str
        },
      })
      program.exitOverride()

      let exitCode: number | undefined

      try {
        program.parse(['init'], { from: 'user' })
      } catch (err: any) {
        exitCode = err.exitCode
      }

      expect(exitCode).toBe(2)
      expect(errOutput).toContain('Refusing to overwrite')
      expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual({ schemaVersion: 999 })
    } finally {
      logSpy.mockRestore()
      process.chdir(originalCwd)
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
