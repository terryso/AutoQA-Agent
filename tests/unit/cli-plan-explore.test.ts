import { describe, it, expect } from 'vitest'
import { Command } from 'commander'
import { registerPlanCommand } from '../../src/cli/commands/plan.js'

describe('cli/commands/plan', () => {
  describe('registerPlanCommand', () => {
    it('should register plan command', () => {
      const program = new Command()
      registerPlanCommand(program)

      const planCommand = program.commands.find((cmd) => cmd.name() === 'plan')
      expect(planCommand).toBeDefined()
      expect(planCommand?.description()).toBe('Plan and explore test scenarios')
    })

    it('should register explore subcommand', () => {
      const program = new Command()
      registerPlanCommand(program)

      const planCommand = program.commands.find((cmd) => cmd.name() === 'plan')
      const exploreCommand = planCommand?.commands.find((cmd) => cmd.name() === 'explore')

      expect(exploreCommand).toBeDefined()
      expect(exploreCommand?.description()).toBe('Explore a web application and generate page structure')
    })

    it('should have required url option', () => {
      const program = new Command()
      registerPlanCommand(program)

      const planCommand = program.commands.find((cmd) => cmd.name() === 'plan')
      const exploreCommand = planCommand?.commands.find((cmd) => cmd.name() === 'explore')

      const urlOption = exploreCommand?.options.find((opt) => opt.long === '--url')
      expect(urlOption).toBeDefined()
      expect(urlOption?.required).toBe(true)
    })

    it('should have optional depth option with default value', () => {
      const program = new Command()
      registerPlanCommand(program)

      const planCommand = program.commands.find((cmd) => cmd.name() === 'plan')
      const exploreCommand = planCommand?.commands.find((cmd) => cmd.name() === 'explore')

      const depthOption = exploreCommand?.options.find((opt) => opt.long === '--depth')
      expect(depthOption).toBeDefined()
    })

    it('should have login-related options', () => {
      const program = new Command()
      registerPlanCommand(program)

      const planCommand = program.commands.find((cmd) => cmd.name() === 'plan')
      const exploreCommand = planCommand?.commands.find((cmd) => cmd.name() === 'explore')

      const loginUrlOption = exploreCommand?.options.find((opt) => opt.long === '--login-url')
      const usernameOption = exploreCommand?.options.find((opt) => opt.long === '--username')
      const passwordOption = exploreCommand?.options.find((opt) => opt.long === '--password')

      expect(loginUrlOption).toBeDefined()
      expect(usernameOption).toBeDefined()
      expect(passwordOption).toBeDefined()
    })

    it('should have headless option', () => {
      const program = new Command()
      registerPlanCommand(program)

      const planCommand = program.commands.find((cmd) => cmd.name() === 'plan')
      const exploreCommand = planCommand?.commands.find((cmd) => cmd.name() === 'explore')

      const headlessOption = exploreCommand?.options.find((opt) => opt.long === '--headless')
      expect(headlessOption).toBeDefined()
    })

    it('should have guardrail options', () => {
      const program = new Command()
      registerPlanCommand(program)

      const planCommand = program.commands.find((cmd) => cmd.name() === 'plan')
      const exploreCommand = planCommand?.commands.find((cmd) => cmd.name() === 'explore')

      const maxPagesOption = exploreCommand?.options.find((opt) => opt.long === '--max-pages')
      const maxAgentTurnsOption = exploreCommand?.options.find((opt) => opt.long === '--max-agent-turns')
      const maxSnapshotsOption = exploreCommand?.options.find((opt) => opt.long === '--max-snapshots')

      expect(maxPagesOption).toBeDefined()
      expect(maxAgentTurnsOption).toBeDefined()
      expect(maxSnapshotsOption).toBeDefined()
    })
  })
})
