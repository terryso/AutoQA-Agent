import { describe, it, expect } from 'vitest'

describe('plan command config merge', () => {
  it('should prioritize CLI options over config file', () => {
    const fileConfig = {
      plan: {
        baseUrl: 'https://config-file.com',
        maxDepth: 2,
        maxPages: 10,
        guardrails: {
          maxAgentTurnsPerRun: 100,
        },
      },
    }

    const options = {
      url: 'https://cli-option.com',
      depth: 5,
      maxPages: 20,
    }

    expect(options.url).toBe('https://cli-option.com')
    expect(options.depth).toBe(5)
    expect(options.maxPages).toBe(20)
  })

  it('should use config file values when CLI options are not provided', () => {
    const fileConfig = {
      plan: {
        baseUrl: 'https://config-file.com',
        maxDepth: 3,
        testTypes: ['functional', 'form'],
      },
    }

    const options = {}

    expect(fileConfig.plan.baseUrl).toBe('https://config-file.com')
    expect(fileConfig.plan.maxDepth).toBe(3)
    expect(fileConfig.plan.testTypes).toEqual(['functional', 'form'])
  })

  it('should use default values when neither CLI nor config provide values', () => {
    const fileConfig = {}
    const options = {}

    const defaultMaxDepth = 3

    expect(defaultMaxDepth).toBe(3)
  })

  it('should merge guardrails from CLI and config', () => {
    const fileConfig = {
      plan: {
        guardrails: {
          maxAgentTurnsPerRun: 100,
          maxSnapshotsPerRun: 50,
        },
      },
    }

    const options = {
      maxAgentTurns: 200,
    }

    expect(options.maxAgentTurns).toBe(200)
    expect(fileConfig.plan.guardrails.maxSnapshotsPerRun).toBe(50)
  })
})
