/**
 * Export Paths
 *
 * Handles file naming and path safety for Playwright test export.
 */

import { resolve, relative, basename, dirname } from 'node:path'
import { mkdir } from 'node:fs/promises'

const UNSAFE_PATH_CHARS = /[<>:"|?*\x00-\x1f]/g
const PATH_TRAVERSAL = /\.\./g
const MULTIPLE_SLASHES = /[\\/]+/g
const LEADING_TRAILING_UNDERSCORES = /^_+|_+$/g

/**
 * Sanitize a path segment to prevent directory traversal and invalid characters.
 */
export function sanitizePathSegment(segment: string): string {
  return segment
    .replace(UNSAFE_PATH_CHARS, '_')
    .replace(PATH_TRAVERSAL, '_')
    .replace(MULTIPLE_SLASHES, '_')
    .replace(LEADING_TRAILING_UNDERSCORES, '')
    .slice(0, 200)
}

/**
 * Generate a deterministic export file name from a spec path.
 * Converts the relative spec path to a safe .spec.ts filename.
 *
 * Example: specs/saucedemo-01-login.md -> saucedemo-01-login.spec.ts
 */
export function generateExportFileName(specPath: string, cwd: string): string {
  const relativePath = specPath.startsWith(cwd)
    ? relative(cwd, specPath)
    : basename(specPath)

  const sanitized = sanitizePathSegment(
    relativePath.replace(/\.md$/i, '').replace(/[\\/]/g, '-'),
  )

  return `${sanitized}.spec.ts`
}

/**
 * Get the export directory path.
 * @param cwd - Current working directory
 * @param exportDir - Custom export directory (relative to cwd), defaults to 'tests/autoqa'
 */
export function getExportDir(cwd: string, exportDir?: string): string {
  return resolve(cwd, exportDir ?? 'tests/autoqa')
}

/**
 * Get the full export file path.
 * @param cwd - Current working directory
 * @param specPath - Path to the spec file
 * @param exportDir - Custom export directory (relative to cwd)
 */
export function getExportPath(cwd: string, specPath: string, exportDir?: string): string {
  const dir = getExportDir(cwd, exportDir)
  const fileName = generateExportFileName(specPath, cwd)
  return resolve(dir, fileName)
}

/**
 * Get the relative export path (safe for logging, no absolute paths).
 * @param cwd - Current working directory
 * @param specPath - Path to the spec file
 * @param exportDir - Custom export directory (relative to cwd)
 */
export function getRelativeExportPath(cwd: string, specPath: string, exportDir?: string): string {
  const fileName = generateExportFileName(specPath, cwd)
  const dir = exportDir ?? 'tests/autoqa'
  return `${dir}/${fileName}`
}

/**
 * Ensure the export directory exists.
 * @param cwd - Current working directory
 * @param exportDir - Custom export directory (relative to cwd)
 */
export async function ensureExportDir(cwd: string, exportDir?: string): Promise<string> {
  const dir = getExportDir(cwd, exportDir)
  await mkdir(dir, { recursive: true })
  return dir
}

/**
 * Convert an absolute path to a safe relative path for output.
 * Never exposes absolute paths in logs or errors.
 */
export function toSafeRelativePath(absolutePath: string, cwd: string): string {
  const cwdNormalized = cwd.endsWith('/') ? cwd : cwd + '/'

  if (absolutePath.startsWith(cwdNormalized)) {
    return absolutePath.slice(cwdNormalized.length)
  }

  if (absolutePath.startsWith(cwd)) {
    return absolutePath.slice(cwd.length + 1)
  }

  const match = absolutePath.match(/[^/]+\.spec\.ts$/)
  if (match) {
    return match[0]
  }

  return '[redacted].spec.ts'
}
