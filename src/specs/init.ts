import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Resolve template path: handle both bundled (global install) and source (test) environments
// - Bundled: template is in same dir as the bundled JS
// - Source: template is in src/templates/ relative to src/specs/
function getTemplatePath(): string {
  // Try bundled path first (template next to the bundled JS)
  const bundledPath = join(__dirname, 'autoqa-env.template.ts')
  if (existsSync(bundledPath)) {
    return bundledPath
  }

  // Fall back to source path (src/templates/ relative to src/specs/)
  return join(__dirname, '../templates/autoqa-env.template.ts')
}

const HELPER_TEMPLATE_PATH = getTemplatePath()

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

const HELPER_OUTPUT_PATH = 'tests/helpers/autoqa-env.ts'

export function ensureTestHelpers(
  cwd: string = process.cwd(),
): { helpersDirPath: string; helperPath: string; didWriteHelper: boolean } {
  const helpersDirPath = join(cwd, 'tests/helpers')
  mkdirSync(helpersDirPath, { recursive: true })

  const helperPath = join(cwd, HELPER_OUTPUT_PATH)

  try {
    const templateContent = readFileSync(HELPER_TEMPLATE_PATH, 'utf8')
    writeFileSync(helperPath, templateContent, {
      encoding: 'utf8',
      flag: 'wx',
    })

    return { helpersDirPath, helperPath, didWriteHelper: true }
  } catch (err: any) {
    if (err?.code === 'EEXIST') {
      return { helpersDirPath, helperPath, didWriteHelper: false }
    }

    throw err
  }
}
