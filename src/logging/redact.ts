const MAX_STRING_LENGTH = 400

export function truncateString(value: string, maxLength: number = MAX_STRING_LENGTH): string {
  if (value.length <= maxLength) return value
  return value.slice(0, maxLength) + '...[truncated]'
}

export function redactUrlCredentials(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.username || parsed.password) {
      parsed.username = ''
      parsed.password = ''
    }
    const sensitiveParams = ['token', 'key', 'secret', 'password', 'auth', 'api_key', 'apikey', 'access_token']
    for (const param of sensitiveParams) {
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.set(param, '[REDACTED]')
      }
    }
    return parsed.toString()
  } catch {
    return truncateString(url)
  }
}

export function sanitizeOriginOnly(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.origin
  } catch {
    return url
  }
}

export type RedactedToolInput = Record<string, unknown>

export function redactToolInput(toolName: string, input: Record<string, unknown>): RedactedToolInput {
  const result: RedactedToolInput = {}

  for (const [key, value] of Object.entries(input)) {
    if (toolName === 'fill' && key === 'text') {
      result.textLength = typeof value === 'string' ? value.length : 0
      continue
    }

    if (toolName === 'navigate' && key === 'url' && typeof value === 'string') {
      result[key] = redactUrlCredentials(value)
      continue
    }

    if (typeof value === 'string') {
      result[key] = truncateString(value)
      continue
    }

    result[key] = value
  }

  return result
}

export function sanitizeRelativePath(absolutePath: string, cwd: string): string {
  const cwdNormalized = cwd.endsWith('/') ? cwd : cwd + '/'
  if (absolutePath.startsWith(cwdNormalized)) {
    return absolutePath.slice(cwdNormalized.length)
  }
  if (absolutePath.startsWith(cwd)) {
    return absolutePath.slice(cwd.length + 1)
  }
  const match = absolutePath.match(/\.autoqa\/runs\/[^/]+\/.*$/)
  if (match) {
    return match[0]
  }
  return '[path-redacted]'
}
