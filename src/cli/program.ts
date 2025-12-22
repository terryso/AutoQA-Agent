import { Command } from 'commander'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { registerInitCommand, type InitCommandDeps } from './commands/init.js'
import { registerRunCommand } from './commands/run.js'
import { registerPlanCommand } from './commands/plan.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export type CreateProgramOptions = {
  initCommandDeps?: InitCommandDeps
}

export function createProgram(options: CreateProgramOptions = {}) {
  const program = new Command()

  // 动态读取版本信息
  let packageJson
  try {
    // 使用 process.cwd() 获取当前工作目录
    const packageJsonPath = join(process.cwd(), 'package.json')
    packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  } catch (error) {
    // 如果读取失败，使用硬编码版本
    packageJson = { version: '0.0.6' }
  }

  program
    .name('autoqa')
    .description('AutoQA Agent CLI')
    .version(packageJson.version, '-V, --version', 'Display version number')

  registerInitCommand(program, options.initCommandDeps)
  registerRunCommand(program)
  registerPlanCommand(program)

  return program
}
