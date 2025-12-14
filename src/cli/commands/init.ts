import { unlinkSync } from 'node:fs'
import { join } from 'node:path'

import { Command } from 'commander'

import { isUserCorrectableFsError } from '../fs-errors.js'
import { writeOutLine } from '../output.js'

import {
  AutoqaConfigAlreadyExistsError,
  AUTOQA_CONFIG_FILE_NAME,
  writeDefaultConfigFile,
} from '../../config/init.js'
import { ensureExampleSpecs } from '../../specs/init.js'
import { probeAgentSdkAuth, type AgentSdkAuthProbeResult } from '../../auth/probe.js'

function isAuthenticationFailed(code: unknown): boolean {
  return code === 'AUTHENTICATION_FAILED' || code === 'authentication_failed'
}

function getErrorCode(err: unknown): unknown {
  if (!err || typeof err !== 'object') return undefined

  const anyErr = err as any

  return (
    anyErr.code ??
    anyErr.error?.code ??
    anyErr.error?.type ??
    anyErr.cause?.code ??
    anyErr.cause?.error?.code
  )
}

function hasAnthropicApiKey(): boolean {
  const apiKey = process.env.ANTHROPIC_API_KEY
  return typeof apiKey === 'string' && apiKey.length > 0
}

export type InitCommandDeps = {
  probeAgentSdkAuth?: () => Promise<AgentSdkAuthProbeResult>
}

export function registerInitCommand(program: Command, deps: InitCommandDeps = {}) {
  const probeAuth = deps.probeAgentSdkAuth ?? probeAgentSdkAuth

  program
    .command('init')
    .description(
      `Generate default ${AUTOQA_CONFIG_FILE_NAME} and example specs in current directory`,
    )
    .action(async () => {
      const { writeOut } = program.configureOutput()
      const cwd = process.cwd()
      const configPath = join(cwd, AUTOQA_CONFIG_FILE_NAME)
      let didWriteConfig = false

      try {
        writeDefaultConfigFile(cwd)
        didWriteConfig = true
      } catch (err: any) {
        if (err instanceof AutoqaConfigAlreadyExistsError) {
          program.error(
            `${AUTOQA_CONFIG_FILE_NAME} already exists. Refusing to overwrite.`,
            { exitCode: 2 },
          )
          return
        }

        if (isUserCorrectableFsError(err)) {
          program.error(
            `Failed to create ${AUTOQA_CONFIG_FILE_NAME}: ${err?.message ?? String(err)}`,
            { exitCode: 2 },
          )
          return
        }

        program.error(
          `Failed to create ${AUTOQA_CONFIG_FILE_NAME}: ${err?.message ?? String(err)}`,
        )
        return
      }

      let didWriteExample = false

      try {
        const result = ensureExampleSpecs(cwd)
        didWriteExample = result.didWriteExample
      } catch (err: any) {
        let rollbackMessage = ''
        if (didWriteConfig) {
          try {
            unlinkSync(configPath)
            rollbackMessage = ` Rolled back ${AUTOQA_CONFIG_FILE_NAME}.`
          } catch (rollbackErr: any) {
            rollbackMessage = ` Also failed to remove ${AUTOQA_CONFIG_FILE_NAME}: ${rollbackErr?.message ?? String(rollbackErr)}`
          }
        }

        const message = `${err?.message ?? String(err)}${rollbackMessage}`

        if (isUserCorrectableFsError(err)) {
          program.error(`Failed to create specs/login-example.md: ${message}`, {
            exitCode: 2,
          })
          return
        }

        program.error(`Failed to create specs/login-example.md: ${message}`)
        return
      }

      writeOutLine(writeOut, `Created ${AUTOQA_CONFIG_FILE_NAME}`)

      if (didWriteExample) {
        writeOutLine(writeOut, 'Created specs/login-example.md')
      } else {
        writeOutLine(writeOut, 'specs/login-example.md already exists. Skipping.')
      }

      let probeResult: AgentSdkAuthProbeResult
      try {
        probeResult = await probeAuth()
      } catch (err: unknown) {
        const code = getErrorCode(err)
        probeResult = isAuthenticationFailed(code)
          ? { kind: 'authentication_failed' }
          : { kind: 'unknown' }
      }

      if (probeResult.kind === 'available') {
        writeOutLine(writeOut, '检测到 Claude Code 已授权（Agent SDK 可直接使用）。无需配置 ANTHROPIC_API_KEY。')
      } else if (probeResult.kind === 'authentication_failed') {
        if (hasAnthropicApiKey()) {
          writeOutLine(writeOut, '未检测到 Claude Code 授权。已检测到 ANTHROPIC_API_KEY，将在后续运行时使用该 Key。')
        } else {
          writeOutLine(writeOut, '未检测到 Claude Code 授权。需要设置 ANTHROPIC_API_KEY。')
        }
      } else {
        writeOutLine(writeOut, '无法确认 Claude Code 授权状态，将在后续运行时再次校验。')
      }
    })
}
