import { Command } from 'commander'

export function createProgram() {
  const program = new Command()

  program.name('autoqa').description('AutoQA Agent CLI')

  return program
}
