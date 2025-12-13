import { describe, expect, it } from 'vitest'

import { createProgram } from '../../src/cli/program.js'

describe('autoqa cli', () => {
  it('prints help and exits with code 0', () => {
    const program = createProgram()

    let stdout = ''

    program.configureOutput({
      writeOut: (str: string) => {
        stdout += str
      },
      writeErr: () => {},
    })

    program.exitOverride()

    let exitCode: number | undefined

    try {
      program.parse(['--help'], { from: 'user' })
    } catch (err: any) {
      exitCode = err.exitCode
    }

    expect(exitCode).toBe(0)
    expect(stdout).toContain('AutoQA Agent CLI')
  })
})
