import { Command } from 'commander'

import { registerInitCommand, type InitCommandDeps } from './commands/init.js'
import { registerRunCommand } from './commands/run.js'
import { registerPlanCommand } from './commands/plan.js'

export type CreateProgramOptions = {
  initCommandDeps?: InitCommandDeps
}

export function createProgram(options: CreateProgramOptions = {}) {
  const program = new Command()

  program.name('autoqa').description('AutoQA Agent CLI')

  registerInitCommand(program, options.initCommandDeps)
  registerRunCommand(program)
  registerPlanCommand(program)

  return program
}
