import { chromium, type Browser } from 'playwright'

export type CreateBrowserOptions = {
  headless: boolean
  slowMo?: number
}

export async function createBrowser(options: CreateBrowserOptions): Promise<Browser> {
  const args = options.headless ? ['--window-size=1440,900'] : ['--start-maximized']
  return chromium.launch({
    headless: options.headless,
    slowMo: options.slowMo,
    args,
  })
}
