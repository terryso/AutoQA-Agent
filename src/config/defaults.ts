import type { AutoqaConfig, Guardrails } from './schema.js'

export const DEFAULT_GUARDRAILS: Required<Guardrails> = {
  maxToolCallsPerSpec: 200,
  maxConsecutiveErrors: 8,
  maxRetriesPerStep: 5,
}

export const DEFAULT_EXPORT_DIR = 'tests/autoqa'

export const defaultAutoqaConfig: AutoqaConfig = {
  schemaVersion: 1,
  guardrails: DEFAULT_GUARDRAILS,
  exportDir: DEFAULT_EXPORT_DIR,
}
