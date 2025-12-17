import { chromium, type Browser } from 'playwright'

export type CreateBrowserOptions = {
  headless: boolean
  slowMo?: number
}

export async function createBrowser(options: CreateBrowserOptions): Promise<Browser> {
  const explicitChannel = (process.env.AUTOQA_CHROMIUM_CHANNEL ?? '').trim()
  const shouldDefaultToChromeChannel = !options.headless && !explicitChannel
  const channel = explicitChannel || (shouldDefaultToChromeChannel ? 'chrome' : '')

  const rawDisableTranslate = (process.env.AUTOQA_CHROME_DISABLE_TRANSLATE ?? '').trim().toLowerCase()
  const disableTranslate = rawDisableTranslate === '' || rawDisableTranslate === '1' || rawDisableTranslate === 'true'
  const translateArgs = disableTranslate && !options.headless ? ['--disable-features=Translate,TranslateUI', '--disable-translate'] : []

  const args = options.headless
    ? ['--window-size=1440,900', ...translateArgs]
    : ['--start-maximized', ...translateArgs]

  try {
    return await chromium.launch({
      headless: options.headless,
      slowMo: options.slowMo,
      args,
      ...(channel ? { channel } : {}),
    })
  } catch (err: unknown) {
    if (!shouldDefaultToChromeChannel) throw err

    return await chromium.launch({
      headless: options.headless,
      slowMo: options.slowMo,
      args,
    })
  }
}
