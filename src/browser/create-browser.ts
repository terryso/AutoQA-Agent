import { chromium, type Browser } from 'playwright'

export type CreateBrowserOptions = {
  headless: boolean
  slowMo?: number
}

export async function createBrowser(options: CreateBrowserOptions): Promise<Browser> {
  return chromium.launch({ headless: options.headless, slowMo: options.slowMo })
}
