export type ValidatedRunArgs = {
  baseUrl: string
  headless: boolean
  debug: boolean
}

export type ValidateRunArgsInput = {
  url?: string
  headless?: boolean
  debug?: boolean
}

export type ValidateRunArgsResult =
  | { ok: true; value: ValidatedRunArgs }
  | { ok: false; message: string }

function normalizeBaseUrl(urlStr: string): string {
  let s = urlStr.trim()
  while (s.endsWith('/')) s = s.slice(0, -1)
  return s
}

export function validateRunArgs(input: ValidateRunArgsInput): ValidateRunArgsResult {
  if (!input.url || input.url.trim().length === 0) {
    return {
      ok: false,
      message: 'Base URL is required. Provide --url <baseUrl>.',
    }
  }

  if (input.debug && input.headless) {
    return {
      ok: false,
      message: 'Conflicting options: --debug and --headless cannot be used together.',
    }
  }

  let parsed: URL
  try {
    parsed = new URL(input.url)
  } catch {
    return {
      ok: false,
      message: `Invalid --url: ${input.url}. Must be a valid http(s) URL.`,
    }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      message: `Invalid --url: ${input.url}. Must use http: or https:.`,
    }
  }

  const baseUrl = normalizeBaseUrl(parsed.toString())
  const debug = Boolean(input.debug)
  const headless = debug ? false : (input.headless ?? true)

  return {
    ok: true,
    value: {
      baseUrl,
      headless,
      debug,
    },
  }
}
