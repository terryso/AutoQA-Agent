import { z } from 'zod'

export const guardrailsSchema = z.object({
  maxToolCallsPerSpec: z.number().int().positive().optional(),
  maxConsecutiveErrors: z.number().int().positive().optional(),
  maxRetriesPerStep: z.number().int().positive().optional(),
})

export type Guardrails = z.infer<typeof guardrailsSchema>

export const planGuardrailsSchema = z.object({
  maxAgentTurnsPerRun: z.number().int().positive().optional(),
  maxSnapshotsPerRun: z.number().int().positive().optional(),
  maxPagesPerRun: z.number().int().positive().optional(),
  maxTokenPerRun: z.number().int().positive().optional(),
})

export type PlanGuardrails = z.infer<typeof planGuardrailsSchema>

export const planConfigSchema = z.object({
  baseUrl: z.string().url().optional(),
  maxDepth: z.number().int().min(0).max(10).optional(),
  maxPages: z.number().int().positive().optional(),
  testTypes: z.array(z.enum(['functional', 'form', 'navigation', 'responsive', 'boundary', 'security'])).optional(),
  guardrails: planGuardrailsSchema.optional(),
})

export type PlanConfigFromFile = z.infer<typeof planConfigSchema>

export const autoqaConfigSchema = z
  .object({
    schemaVersion: z.number().int().min(1),
    guardrails: guardrailsSchema.optional(),
    exportDir: z.string().optional(),
    plan: planConfigSchema.optional(),
  })
  .strict()

export type AutoqaConfig = z.infer<typeof autoqaConfigSchema>
