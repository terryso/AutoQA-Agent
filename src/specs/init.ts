import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const EXAMPLE_SPEC_CONTENT = `# Login Example

## Preconditions

- Base URL is configured and reachable
- You have valid test credentials

## Steps

1. Navigate to the login page
2. Fill in username and password
3. Click the "Sign in" button
4. Verify the page shows a logged-in indicator
`

export function ensureExampleSpecs(
  cwd: string = process.cwd(),
): { specsDirPath: string; exampleSpecPath: string; didWriteExample: boolean } {
  const specsDirPath = join(cwd, 'specs')
  mkdirSync(specsDirPath, { recursive: true })

  const exampleSpecPath = join(specsDirPath, 'login-example.md')

  try {
    writeFileSync(exampleSpecPath, EXAMPLE_SPEC_CONTENT, {
      encoding: 'utf8',
      flag: 'wx',
    })

    return { specsDirPath, exampleSpecPath, didWriteExample: true }
  } catch (err: any) {
    if (err?.code === 'EEXIST') {
      return { specsDirPath, exampleSpecPath, didWriteExample: false }
    }

    throw err
  }
}
