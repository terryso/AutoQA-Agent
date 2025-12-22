import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const EXAMPLE_SPEC_CONTENT = `# Login Example

## Preconditions

- Base URL accessible: {{BASE_URL}}
- Test credentials available via AUTOQA_USERNAME/AUTOQA_PASSWORD

## Steps

1. Navigate to {{BASE_URL}}/
2. Verify the page shows the login form with fields "Username" and "Password"
3. Fill the "Username" field with {{USERNAME}}
4. Fill the "Password" field with {{PASSWORD}}
5. Click the "Login" button
6. Verify the user is logged in and sees the inventory/products page (e.g. header shows "Products")
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
