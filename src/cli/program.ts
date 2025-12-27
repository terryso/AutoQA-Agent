import { Command } from 'commander'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { registerInitCommand, type InitCommandDeps } from './commands/init.js'
import { registerRunCommand } from './commands/run.js'
import { registerPlanCommand } from './commands/plan.js'
import { registerRepairCommand } from './commands/repair.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export type CreateProgramOptions = {
  initCommandDeps?: InitCommandDeps
}

export function createProgram(options: CreateProgramOptions = {}) {
  const program = new Command()

  // 动态读取版本信息
  let packageJson
  try {
    // 使用 import.meta.url 获取模块的绝对路径，然后找到 package.json
    const moduleDir = dirname(fileURLToPath(import.meta.url))

    // 添加调试信息
    // console.debug('AutoQA Debug: moduleDir =', moduleDir)

    let packageJsonPath

    // 判断是在开发环境还是构建后的环境
    if (moduleDir.endsWith('dist')) {
      // 构建后的环境：直接从 dist 目录向上查找
      packageJsonPath = join(moduleDir, '..', 'package.json')
    } else if (moduleDir.includes('/dist/')) {
      // 构建后的环境：可能在 dist 的子目录
      packageJsonPath = join(moduleDir, '..', '..', 'package.json')
    } else if (moduleDir.includes('/src/cli/')) {
      // 开发环境：从 src/cli 向上查找
      packageJsonPath = join(moduleDir, '..', '..', 'package.json')
    } else {
      // 其他情况，尝试直接从当前模块位置查找
      packageJsonPath = join(moduleDir, 'package.json')
    }

    packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  } catch (error) {
    // 如果读取失败，使用硬编码版本
    console.warn('Warning: Could not read version from package.json, using default')
    packageJson = { version: '0.0.1' }
  }

  program
    .name('autoqa')
    .description('AutoQA Agent CLI')
    .version(packageJson.version, '-V, --version', 'Display version number')

  registerInitCommand(program, options.initCommandDeps)
  registerRunCommand(program)
  registerPlanCommand(program)
  registerRepairCommand(program)

  return program
}
