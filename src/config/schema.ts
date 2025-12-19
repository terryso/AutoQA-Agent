import { z } from 'zod'

export const guardrailsSchema = z.object({
  maxToolCallsPerSpec: z.number().int().positive().optional(),
  maxConsecutiveErrors: z.number().int().positive().optional(),
  maxRetriesPerStep: z.number().int().positive().optional(),
})

export type Guardrails = z.infer<typeof guardrailsSchema>

export const autoqaConfigSchema = z
  .object({
    schemaVersion: z.number().int().min(1),
    guardrails: guardrailsSchema.optional(),
    exportDir: z.string().optional(),
  })
  .strict()

export type AutoqaConfig = z.infer<typeof autoqaConfigSchema>
