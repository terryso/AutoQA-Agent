/**
 * AutoQA Environment Loader
 * Shared utility for loading .env files in generated Playwright tests.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function stripQuotes(value: string): string {
  const s = value.trim()
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    return s.slice(1, -1)
  }
  return s
}

function parseDotEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  const lines = (content ?? '').split(/\r?\n/g)
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('#')) continue
    const withoutExport = line.startsWith('export ') ? line.slice('export '.length).trim() : line
    const eqIndex = withoutExport.indexOf('=')
    if (eqIndex <= 0) continue
    const key = withoutExport.slice(0, eqIndex).trim()
    if (!key) continue
    const rawValue = withoutExport.slice(eqIndex + 1)
    out[key] = stripQuotes(rawValue)
  }
  return out
}

function loadEnvFile(fileName: string, initialEnvKeys: Set<string>): void {
  const absPath = join(process.cwd(), fileName)
  if (!existsSync(absPath)) return
  const parsed = parseDotEnv(readFileSync(absPath, 'utf8'))
  for (const [k, v] of Object.entries(parsed)) {
    if (initialEnvKeys.has(k)) continue
    process.env[k] = v
  }
}

export function loadEnvFiles(): void {
  const initialEnvKeys = new Set(Object.keys(process.env))
  loadEnvFile('.env', initialEnvKeys)
  const envName = (process.env.AUTOQA_ENV ?? '').trim()
  if (envName) {
    loadEnvFile('.env.' + envName, initialEnvKeys)
  }
}

export function getEnvVar(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Missing ${key}`)
  }
  return value
}
