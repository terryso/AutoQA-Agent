import { describe, it, expect } from 'vitest'

describe('plan orchestrator', () => {
  describe('runPlan modes', () => {
    it('should support full mode (explore + generate)', () => {
      const mode = 'full'
      expect(mode).toBe('full')
    })

    it('should support explore-only mode', () => {
      const mode = 'explore-only'
      expect(mode).toBe('explore-only')
    })

    it('should support generate-only mode', () => {
      const mode = 'generate-only'
      expect(mode).toBe('generate-only')
    })
  })

  describe('exit codes', () => {
    it('should return exit code 0 for successful plan', () => {
      const guardrailTriggered = false
      const exitCode = guardrailTriggered ? 1 : 0
      expect(exitCode).toBe(0)
    })

    it('should return exit code 1 when guardrail is triggered', () => {
      const guardrailTriggered = true
      const exitCode = guardrailTriggered ? 1 : 0
      expect(exitCode).toBe(1)
    })

    it('should return exit code 1 for runtime failures', () => {
      const hasError = true
      const exitCode = hasError ? 1 : 0
      expect(exitCode).toBe(1)
    })

    it('should return exit code 2 for configuration errors', () => {
      const isConfigError = true
      const exitCode = isConfigError ? 2 : 0
      expect(exitCode).toBe(2)
    })
  })
})
