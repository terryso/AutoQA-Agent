import { createBrowser } from '../browser/create-browser.js'
import { createRequire } from 'node:module'

export type PreflightOptions = {
  baseUrl: string
  headless: boolean
  debug: boolean
}

export type PreflightResult =
  | { ok: true; chromiumVersion?: string; playwrightVersion?: string }
  | { ok: false; message: string; cause?: unknown }

function getPlaywrightVersion(): string | undefined {
  const require = createRequire(import.meta.url)
  try {
    const pkg = require('playwright/package.json')
    return typeof pkg?.version === 'string' ? pkg.version : undefined
  } catch {
    return undefined
  }
}

function formatCauseSuffix(err: unknown): string {
  if (!err || typeof err !== 'object') return ''
  const anyErr = err as any

  const code = anyErr?.code
  const codePart = typeof code === 'string' ? ` (${code})` : ''

  const message = anyErr?.message
  const msgPart = typeof message === 'string' && message.length > 0 ? `: ${message}` : ''

  return `${codePart}${msgPart}`
}

export async function runPreflight(options: PreflightOptions): Promise<PreflightResult> {
  try {
    const browser = await createBrowser({
      headless: options.headless,
      slowMo: options.debug ? 75 : undefined,
    })

    const chromiumVersion = browser.version()
    const playwrightVersion = getPlaywrightVersion()
    await browser.close()

    return { ok: true, chromiumVersion, playwrightVersion }
  } catch (err: unknown) {
    return {
      ok: false,
      message: `Failed to launch browser with Playwright${formatCauseSuffix(err)}`,
      cause: err,
    }
  }
}
