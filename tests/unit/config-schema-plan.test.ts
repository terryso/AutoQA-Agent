import { describe, it, expect } from 'vitest'
import { planConfigSchema, planGuardrailsSchema } from '../../src/config/schema.js'

describe('plan config schema', () => {
  it('should validate valid plan config', () => {
    const validConfig = {
      baseUrl: 'https://example.com',
      maxDepth: 3,
      maxPages: 10,
      testTypes: ['functional', 'form'],
      guardrails: {
        maxAgentTurnsPerRun: 100,
        maxSnapshotsPerRun: 50,
      },
    }

    const result = planConfigSchema.safeParse(validConfig)
    expect(result.success).toBe(true)
  })

  it('should accept optional fields', () => {
    const minimalConfig = {
      baseUrl: 'https://example.com',
    }

    const result = planConfigSchema.safeParse(minimalConfig)
    expect(result.success).toBe(true)
  })

  it('should reject invalid baseUrl', () => {
    const invalidConfig = {
      baseUrl: 'not-a-url',
    }

    const result = planConfigSchema.safeParse(invalidConfig)
    expect(result.success).toBe(false)
  })

  it('should reject maxDepth out of range', () => {
    const invalidConfig = {
      baseUrl: 'https://example.com',
      maxDepth: 15,
    }

    const result = planConfigSchema.safeParse(invalidConfig)
    expect(result.success).toBe(false)
  })

  it('should validate test types enum', () => {
    const validTypes = {
      testTypes: ['functional', 'form', 'navigation', 'responsive', 'boundary', 'security'],
    }

    const result = planConfigSchema.safeParse(validTypes)
    expect(result.success).toBe(true)
  })

  it('should reject invalid test types', () => {
    const invalidTypes = {
      testTypes: ['invalid-type'],
    }

    const result = planConfigSchema.safeParse(invalidTypes)
    expect(result.success).toBe(false)
  })
})

describe('plan guardrails schema', () => {
  it('should validate valid guardrails', () => {
    const validGuardrails = {
      maxAgentTurnsPerRun: 100,
      maxSnapshotsPerRun: 50,
      maxPagesPerRun: 20,
      maxTokenPerRun: 100000,
    }

    const result = planGuardrailsSchema.safeParse(validGuardrails)
    expect(result.success).toBe(true)
  })

  it('should reject negative values', () => {
    const invalidGuardrails = {
      maxAgentTurnsPerRun: -1,
    }

    const result = planGuardrailsSchema.safeParse(invalidGuardrails)
    expect(result.success).toBe(false)
  })

  it('should reject zero values', () => {
    const invalidGuardrails = {
      maxPagesPerRun: 0,
    }

    const result = planGuardrailsSchema.safeParse(invalidGuardrails)
    expect(result.success).toBe(false)
  })
})
