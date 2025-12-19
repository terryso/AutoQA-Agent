import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

import type { Locator, Page } from 'playwright'

import { click, fill, navigate, scroll, wait, assertTextPresent, assertElementVisible } from '../tools/index.js'
import { resolveVisibleElement } from '../tools/assertions/assert-element-visible.js'
import { resolveClickTarget, trySelectOptionByLabel } from '../tools/click.js'
import { resolveFillTarget } from '../tools/fill.js'
import { toToolError } from '../tools/playwright-error.js'
import type { ContentBlock } from './pre-action-screenshot.js'
import { runWithPreActionScreenshot } from './pre-action-screenshot.js'
import type { Logger } from '../logging/index.js'
import { redactToolInput, sanitizeOriginOnly, sanitizeRelativePath } from '../logging/index.js'
import { captureSnapshots, writeSnapshotsIfNeeded, type SnapshotMeta } from '../browser/snapshot.js'
import { createIRRecorder, nullRecorder, extractFingerprint, type ElementFingerprint, type IRRecorder, type PreActionResult, type IRToolName } from '../ir/index.js'

type ArtifactMode = 'all' | 'fail' | 'none'
type ToolContextMode = 'screenshot' | 'snapshot' | 'none'

function getArtifactMode(): ArtifactMode | undefined {
  const raw = (process.env.AUTOQA_ARTIFACTS ?? '').trim().toLowerCase()
  if (raw === 'all' || raw === 'fail' || raw === 'none') return raw
  return undefined
}

function shouldWriteArtifacts(debug: boolean, toolOk: boolean): boolean {
  const mode = getArtifactMode()
  if (mode === 'all') return true
  if (mode === 'none') return false
  if (mode === 'fail') return !toolOk
  return !toolOk
}

function getToolContextMode(): ToolContextMode {
  const raw = (process.env.AUTOQA_TOOL_CONTEXT ?? '').trim().toLowerCase()
  if (raw === 'screenshot' || raw === 'snapshot' || raw === 'none') return raw
  return 'screenshot'
}

function normalizeToolStringInput(value: string): string {
  const s = (value ?? '').trim()
  if (s.length >= 2 && s.startsWith('`') && s.endsWith('`')) {
    return s.slice(1, -1).trim()
  }
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    return s.slice(1, -1).trim()
  }
  return s
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function isValidSnapshotRef(ref: string): boolean {
  return /^e\d+$/.test(ref)
}

const TARGET_MATCH_STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'with',
  'for',
  'to',
  'in',
  'on',
  'of',
  'and',
  'or',
  'button',
  'link',
  'element',
  'item',
])

function normalizeTargetTokens(value: string): string[] {
  return (value ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !TARGET_MATCH_STOP_WORDS.has(t))
}

function fingerprintToSearchText(fp: ElementFingerprint | null | undefined): string {
  if (!fp) return ''
  return [
    fp.accessibleName,
    fp.ariaLabel,
    fp.textSnippet,
    fp.id,
    fp.testId,
    fp.nameAttr,
    fp.placeholder,
    fp.role,
    fp.tagName,
  ]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .join(' ')
    .toLowerCase()
}

function fingerprintMatchesTargetDescription(fp: ElementFingerprint | null | undefined, targetDescription: string): boolean {
  const tokens = normalizeTargetTokens(targetDescription)
  if (tokens.length === 0) return true
  const haystack = fingerprintToSearchText(fp)
  if (!haystack) return true
  return tokens.some((t) => haystack.includes(t))
}

function writeDebug(enabled: boolean, line: string): void {
  if (!enabled) return
  try {
    process.stderr.write(`${line}\n`)
  } catch {
    return
  }
}

function summarizeToolResult(result: { ok: boolean; data?: unknown; error?: any; screenshot?: unknown }): unknown {
  if (result.ok) {
    return {
      ok: true,
      data: result.data,
      screenshot: result.screenshot,
    }
  }

  const err = result.error ?? {}
  return {
    ok: false,
    error: {
      code: err.code,
      message: err.message,
      retriable: err.retriable,
    },
    screenshot: result.screenshot,
  }
}

import type { StepVarInfo } from '../runner/run-specs.js'
import type { FillValue } from '../ir/types.js'

export type CreateBrowserToolsMcpServerOptions = {
  page: Page
  baseUrl: string
  runId: string
  debug: boolean
  cwd?: string
  specPath: string
  logger: Logger
  onToolCall?: (toolName: string, stepIndex: number | null, isError: boolean) => void
  enableIR?: boolean
  /** Map of stepIndex -> variables used in that step */
  stepVarsMap?: Map<number, StepVarInfo>
}

function parseStepIndex(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) {
    return value
  }
  if (typeof value === 'string') {
    const s = value.trim()
    if (!/^\d+$/.test(s)) return null
    const parsed = parseInt(s, 10)
    if (!Number.isNaN(parsed) && parsed >= 1) {
      return parsed
    }
  }
  return null
}

 const stepIndexSchema = z
   .preprocess((value) => {
     if (typeof value === 'string') {
       const s = value.trim()
       if (!/^\d+$/.test(s)) return value
       return parseInt(s, 10)
     }
     return value
   }, z.number().int().positive())
   .optional()

const DEFAULT_JPEG_QUALITY = 60

/**
 * Compute the FillValue for IR recording.
 * - If stepVarsMap has a variable for this step, use template_var
 * - If fingerprint indicates password field, use redacted
 * - Otherwise use literal
 */
function computeFillValue(
  stepIndex: number | null,
  text: string,
  fingerprint: ElementFingerprint | null | undefined,
  stepVarsMap: Map<number, StepVarInfo> | undefined,
): FillValue {
  // Check if this step uses a template variable
  if (stepIndex !== null && stepVarsMap) {
    const stepInfo = stepVarsMap.get(stepIndex)
    if (stepInfo && stepInfo.vars.length > 0) {
      // Find which variable matches this fill (prefer PASSWORD/USERNAME for sensitive fields)
      const isPasswordField = fingerprint?.typeAttr === 'password'
      if (isPasswordField && stepInfo.vars.includes('PASSWORD')) {
        return { kind: 'template_var', name: 'PASSWORD' }
      }
      // Use the first variable found in this step
      return { kind: 'template_var', name: stepInfo.vars[0] }
    }
  }

  // If it's a password field without a template var, redact it
  if (fingerprint?.typeAttr === 'password') {
    return { kind: 'redacted' }
  }

  // Otherwise store the literal value
  return { kind: 'literal', value: text }
}

export function createBrowserToolsMcpServer(options: CreateBrowserToolsMcpServerOptions) {
  let counter = 0
  const nextFileBaseName = (toolName: string) => {
    counter += 1
    return `${toolName}-${counter}`
  }

  const { logger, specPath } = options
  const cwd = options.cwd ?? process.cwd()

  const irRecorder: IRRecorder | typeof nullRecorder = options.enableIR !== false
    ? createIRRecorder({
        cwd,
        runId: options.runId,
        specPath,
        enabled: true,
      })
    : nullRecorder

  function logToolCall(toolName: string, toolInput: Record<string, unknown>, stepIndex: number | null): void {
    logger.log({
      event: 'autoqa.tool.called',
      runId: options.runId,
      specPath,
      toolName,
      stepIndex,
      toolInput: redactToolInput(toolName, toolInput),
    })
  }

  function logToolResult(
    toolName: string,
    startTime: number,
    result: { ok: boolean; error?: any },
    stepIndex: number | null,
    meta: {
      error?: string
      screenshot?: { mimeType?: string; width?: number; height?: number; path?: string }
      snapshot?: SnapshotMeta
    },
  ): void {
    if (options.onToolCall) {
      options.onToolCall(toolName, stepIndex, !result.ok)
    }

    const event: any = {
      event: 'autoqa.tool.result',
      runId: options.runId,
      specPath,
      toolName,
      stepIndex,
      toolDurationMs: Date.now() - startTime,
      ok: result.ok,
    }

    if (!result.ok && result.error) {
      event.error = {
        code: result.error.code,
        message: result.error.message,
        retriable: result.error.retriable,
      }
    }

    if (meta.screenshot?.path) {
      event.screenshot = {
        mimeType: meta.screenshot.mimeType,
        width: meta.screenshot.width,
        height: meta.screenshot.height,
        relativePath: sanitizeRelativePath(meta.screenshot.path, cwd),
      }
    } else if (meta.error) {
      event.screenshotError = meta.error
    }

    if (meta.snapshot?.ariaPath || meta.snapshot?.axPath) {
      event.snapshot = {
        ariaRelativePath: meta.snapshot.ariaPath,
        axRelativePath: meta.snapshot.axPath,
      }
    }
    if (meta.snapshot?.error) {
      event.snapshotError = meta.snapshot.error
    }

    logger.log(event)
  }

  async function capturePreActionSnapshot() {
    try {
      return await captureSnapshots(options.page)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        aria: { ok: false as const, error: `Failed to capture ARIA snapshot: ${msg}` },
        ax: { ok: false as const, error: `Failed to capture AX snapshot: ${msg}` },
      }
    }
  }

  async function resolveRefLocator(ref: string): Promise<Locator> {
    const direct = options.page.locator(`aria-ref=${ref}`).first()
    try {
      const count = await direct.count()
      if (count > 0) return direct
    } catch {
    }

    try {
      const snapshotForAI = (options.page as any)?._snapshotForAI
      if (typeof snapshotForAI === 'function') {
        await snapshotForAI.call(options.page, { timeout: 5000 })
      }
    } catch {
    }

    return options.page.locator(`aria-ref=${ref}`).first()
  }

  return createSdkMcpServer({
    name: 'autoqa-browser-tools',
    version: '0.0.0',
    tools: [
      tool(
        'snapshot',
        'Capture an accessibility snapshot that includes stable refs for interactable elements.',
        {
          stepIndex: stepIndexSchema,
        },
        async (args) => {
          const stepIndex = parseStepIndex((args as any).stepIndex)
          const fileBaseName = nextFileBaseName('snapshot')
          const startTime = Date.now()
          logToolCall('snapshot', {}, stepIndex)
          writeDebug(options.debug, `mcp_tool=snapshot stepIndex=${stepIndex}`)

          const snapshotCapture = await capturePreActionSnapshot()

          const snapshotMeta = await writeSnapshotsIfNeeded(
            snapshotCapture,
            { cwd: options.cwd, runId: options.runId, fileBaseName },
            shouldWriteArtifacts(options.debug, true),
          )

          logToolResult('snapshot', startTime, { ok: true } as any, stepIndex, { snapshot: snapshotMeta })

          const content: ContentBlock[] = []
          if (snapshotMeta.error) content.push({ type: 'text', text: `SNAPSHOT_FAILED: ${snapshotMeta.error}` })

          const full = snapshotCapture.ax.ok && snapshotCapture.ax.json && typeof (snapshotCapture.ax.json as any).full === 'string'
            ? String((snapshotCapture.ax.json as any).full)
            : ''
          content.push({ type: 'text', text: full.length > 0 ? full : 'NO_AX_SNAPSHOT_AVAILABLE' })

          return { content, isError: false }
        },
      ),
      tool(
        'navigate',
        'Navigate the page to a given URL (absolute or /path relative to baseUrl). Captures a pre-action screenshot and returns it as an image block.',
        {
          url: z.string(),
          stepIndex: stepIndexSchema,
        },
        async (args) => {
          const stepIndex = parseStepIndex((args as any).stepIndex)
          const contextMode = getToolContextMode()
          const url = normalizeToolStringInput(args.url)
          const fileBaseName = nextFileBaseName('navigate')
          const startTime = Date.now()
          logToolCall('navigate', { url }, stepIndex)
          writeDebug(options.debug, `mcp_tool=navigate url=${sanitizeOriginOnly(url)} stepIndex=${stepIndex}`)

          const snapshotCapturePromise = contextMode === 'snapshot' ? capturePreActionSnapshot() : Promise.resolve(undefined)

          const { result, meta } = await runWithPreActionScreenshot({
            page: options.page,
            runId: options.runId,
            debug: options.debug,
            cwd: options.cwd,
            fileBaseName,
            quality: DEFAULT_JPEG_QUALITY,
            action: async () => {
              await snapshotCapturePromise
              return navigate({ page: options.page, baseUrl: options.baseUrl, url })
            },
          })

          const snapshotCapture = await snapshotCapturePromise
          const snapshotMeta = snapshotCapture
            ? await writeSnapshotsIfNeeded(
              snapshotCapture,
              { cwd: options.cwd, runId: options.runId, fileBaseName },
              shouldWriteArtifacts(options.debug, Boolean(result.ok)),
            )
            : ({ captured: false } as SnapshotMeta)

          logToolResult('navigate', startTime, result as any, stepIndex, { ...meta, snapshot: snapshotMeta })

          const content: ContentBlock[] = []
          if (meta.error) content.push({ type: 'text', text: `SCREENSHOT_FAILED: ${meta.error}` })
          if (snapshotMeta.error) content.push({ type: 'text', text: `SNAPSHOT_FAILED: ${snapshotMeta.error}` })
          content.push({ type: 'text', text: safeStringify(summarizeToolResult(result as any)) })

          return { content, isError: !result.ok }
        },
      ),
      tool(
        'click',
        'Click an element described by targetDescription. Captures a pre-action screenshot and returns it as an image block.',
        {
          targetDescription: z.string().optional(),
          ref: z.string().optional(),
          stepIndex: stepIndexSchema,
        },
        async (args) => {
          const stepIndex = parseStepIndex((args as any).stepIndex)
          const contextMode = getToolContextMode()
          const targetDescription = typeof (args as any).targetDescription === 'string' ? normalizeToolStringInput((args as any).targetDescription) : ''
          const ref = typeof (args as any).ref === 'string' ? normalizeToolStringInput((args as any).ref) : ''
          const fileBaseName = nextFileBaseName('click')
          const startTime = Date.now()
          logToolCall('click', { targetDescription, ref }, stepIndex)
          writeDebug(
            options.debug,
            `mcp_tool=click targetLength=${targetDescription.length}${ref ? ` refLength=${ref.length}` : ''} stepIndex=${stepIndex}`,
          )

          if (ref && !isValidSnapshotRef(ref)) {
            const result = {
              ok: false as const,
              error: {
                code: 'INVALID_INPUT' as const,
                message: `Invalid ref: ${ref}. Ref must come from snapshot like e15.`,
                retriable: false,
                cause: undefined,
              },
            }

            logToolResult('click', startTime, result as any, stepIndex, {})
            return {
              content: [{ type: 'text', text: safeStringify(summarizeToolResult(result as any)) }],
              isError: true,
            }
          }

          const snapshotCapturePromise = contextMode === 'snapshot' ? capturePreActionSnapshot() : Promise.resolve(undefined)

          let irPreActionResult: PreActionResult | null = null

          const { result, meta } = await runWithPreActionScreenshot({
            page: options.page,
            runId: options.runId,
            debug: options.debug,
            cwd: options.cwd,
            fileBaseName,
            quality: DEFAULT_JPEG_QUALITY,
            action: async () => {
              await snapshotCapturePromise
              if (ref) {
                try {
                  const locator = await resolveRefLocator(ref)
                  const count = await locator.count()
                  if (count <= 0) {
                    return {
                      ok: false as const,
                      error: {
                        code: 'ELEMENT_NOT_FOUND',
                        message: `Ref not found: ${ref}`,
                        retriable: true,
                        cause: undefined,
                      },
                    }
                  }
                  irPreActionResult = await irRecorder.prepareForAction(options.page, 'click', locator)
                  await locator.click()
                  return { ok: true as const, data: { ref, targetDescription } }
                } catch (err: unknown) {
                  return { ok: false as const, error: toToolError(err) }
                }
              }
              try {
                const locator = await resolveClickTarget(options.page, targetDescription)
                if (!locator) {
                  try {
                    const selected = await trySelectOptionByLabel(options.page, targetDescription)
                    if (selected) {
                      if (!irPreActionResult) {
                        irPreActionResult = await irRecorder.prepareForAction(options.page, 'click', selected)
                      }
                      return { ok: true as const, data: { targetDescription } }
                    }
                  } catch {
                  }
                  return {
                    ok: false as const,
                    error: {
                      code: 'ELEMENT_NOT_FOUND',
                      message: `Element not found: ${targetDescription}`,
                      retriable: true,
                      cause: undefined,
                    },
                  }
                }

                irPreActionResult = await irRecorder.prepareForAction(options.page, 'click', locator)

                try {
                  await locator.click()
                  return { ok: true as const, data: { targetDescription } }
                } catch (err: unknown) {
                  const msg = err instanceof Error ? err.message : String(err)
                  if (msg.includes('intercepts pointer events') && msg.toLowerCase().includes('select')) {
                    try {
                      const selected = await trySelectOptionByLabel(options.page, targetDescription)
                      if (selected) {
                        if (!irPreActionResult) {
                          irPreActionResult = await irRecorder.prepareForAction(options.page, 'click', selected)
                        }
                        return { ok: true as const, data: { targetDescription } }
                      }
                    } catch {
                    }
                  }
                  return { ok: false as const, error: toToolError(err) }
                }
              } catch (err: unknown) {
                return { ok: false as const, error: toToolError(err) }
              }
            },
          })

          const snapshotCapture = await snapshotCapturePromise
          const snapshotMeta = snapshotCapture
            ? await writeSnapshotsIfNeeded(
              snapshotCapture,
              { cwd: options.cwd, runId: options.runId, fileBaseName },
              shouldWriteArtifacts(options.debug, Boolean(result.ok)),
            )
            : ({ captured: false } as SnapshotMeta)

          logToolResult('click', startTime, result as any, stepIndex, { ...meta, snapshot: snapshotMeta })

          if (result.ok && irRecorder.isEnabled()) {
            await irRecorder.recordAction(
              {
                page: options.page,
                toolName: 'click' as IRToolName,
                toolInput: { targetDescription, ref },
                stepIndex,
              },
              { ok: true },
              irPreActionResult,
            )
          }

          const content: ContentBlock[] = []
          if (meta.error) content.push({ type: 'text', text: `SCREENSHOT_FAILED: ${meta.error}` })
          if (snapshotMeta.error) content.push({ type: 'text', text: `SNAPSHOT_FAILED: ${snapshotMeta.error}` })
          content.push({ type: 'text', text: safeStringify(summarizeToolResult(result as any)) })

          return { content, isError: !result.ok }
        },
      ),
      tool(
        'fill',
        'Fill an input described by targetDescription with the provided text. Captures a pre-action screenshot and returns it as an image block.',
        {
          targetDescription: z.string().optional(),
          ref: z.string().optional(),
          text: z.string(),
          stepIndex: stepIndexSchema,
        },
        async (args) => {
          const stepIndex = parseStepIndex((args as any).stepIndex)
          const contextMode = getToolContextMode()
          const targetDescription = typeof (args as any).targetDescription === 'string' ? normalizeToolStringInput((args as any).targetDescription) : ''
          const ref = typeof (args as any).ref === 'string' ? normalizeToolStringInput((args as any).ref) : ''
          const text = normalizeToolStringInput(args.text)
          const fileBaseName = nextFileBaseName('fill')
          const startTime = Date.now()
          logToolCall('fill', { targetDescription, ref, text }, stepIndex)
          writeDebug(
            options.debug,
            `mcp_tool=fill targetLength=${targetDescription.length}${ref ? ` refLength=${ref.length}` : ''} textLength=${text.length} stepIndex=${stepIndex}`,
          )

          if (ref && !isValidSnapshotRef(ref)) {
            const result = {
              ok: false as const,
              error: {
                code: 'INVALID_INPUT' as const,
                message: `Invalid ref: ${ref}. Ref must come from snapshot like e15.`,
                retriable: false,
                cause: undefined,
              },
            }

            logToolResult('fill', startTime, result as any, stepIndex, {})
            return {
              content: [{ type: 'text', text: safeStringify(summarizeToolResult(result as any)) }],
              isError: true,
            }
          }

          const snapshotCapturePromise = contextMode === 'snapshot' ? capturePreActionSnapshot() : Promise.resolve(undefined)

          let irPreActionResult: PreActionResult | null = null

          const { result, meta } = await runWithPreActionScreenshot({
            page: options.page,
            runId: options.runId,
            debug: options.debug,
            cwd: options.cwd,
            fileBaseName,
            quality: DEFAULT_JPEG_QUALITY,
            action: async () => {
              await snapshotCapturePromise
              if (ref) {
                try {
                  const locator = await resolveRefLocator(ref)
                  const count = await locator.count()
                  if (count <= 0) {
                    return {
                      ok: false as const,
                      error: {
                        code: 'ELEMENT_NOT_FOUND',
                        message: `Ref not found: ${ref}`,
                        retriable: true,
                        cause: undefined,
                      },
                    }
                  }
                  const descendant = locator.locator('input, textarea, [contenteditable="true"]').first()
                  let fillLocator: Locator = locator
                  try {
                    const dcount = await descendant.count()
                    if (dcount > 0) fillLocator = descendant
                  } catch {
                  }

                  irPreActionResult = await irRecorder.prepareForAction(options.page, 'fill', fillLocator)

                  try {
                    await fillLocator.fill(text)
                    return { ok: true as const, data: { ref, targetDescription, textLength: text.length } }
                  } catch (err: unknown) {
                    if (fillLocator === locator) {
                      try {
                        const dcount = await descendant.count()
                        if (dcount > 0) {
                          irPreActionResult = await irRecorder.prepareForAction(options.page, 'fill', descendant)
                          await descendant.fill(text)
                          return { ok: true as const, data: { ref, targetDescription, textLength: text.length } }
                        }
                      } catch {
                      }
                    }
                    return { ok: false as const, error: toToolError(err) }
                  }
                } catch (err: unknown) {
                  return { ok: false as const, error: toToolError(err) }
                }
              }
              try {
                const locator = await resolveFillTarget(options.page, targetDescription)
                if (!locator) {
                  return {
                    ok: false as const,
                    error: {
                      code: 'ELEMENT_NOT_FOUND',
                      message: `Element not found: ${targetDescription}`,
                      retriable: true,
                      cause: undefined,
                    },
                  }
                }

                const descendant = locator.locator('input, textarea, [contenteditable="true"]').first()
                let fillLocator: Locator = locator
                try {
                  const dcount = await descendant.count()
                  if (dcount > 0) fillLocator = descendant
                } catch {
                }

                irPreActionResult = await irRecorder.prepareForAction(options.page, 'fill', fillLocator)

                try {
                  await fillLocator.fill(text)
                  return { ok: true as const, data: { targetDescription, textLength: text.length } }
                } catch (err: unknown) {
                  if (fillLocator === locator) {
                    try {
                      const dcount = await descendant.count()
                      if (dcount > 0) {
                        irPreActionResult = await irRecorder.prepareForAction(options.page, 'fill', descendant)
                        await descendant.fill(text)
                        return { ok: true as const, data: { targetDescription, textLength: text.length } }
                      }
                    } catch {
                    }
                  }
                  return { ok: false as const, error: toToolError(err) }
                }
              } catch (err: unknown) {
                return { ok: false as const, error: toToolError(err) }
              }
            },
          })

          const snapshotCapture = await snapshotCapturePromise
          const snapshotMeta = snapshotCapture
            ? await writeSnapshotsIfNeeded(
              snapshotCapture,
              { cwd: options.cwd, runId: options.runId, fileBaseName },
              shouldWriteArtifacts(options.debug, Boolean(result.ok)),
            )
            : ({ captured: false } as SnapshotMeta)

          logToolResult('fill', startTime, result as any, stepIndex, { ...meta, snapshot: snapshotMeta })

          if (result.ok && irRecorder.isEnabled()) {
            const preResult = irPreActionResult as PreActionResult | null
            const fingerprint = preResult?.fingerprint ?? null
            const fillValue = computeFillValue(stepIndex, text, fingerprint, options.stepVarsMap)
            await irRecorder.recordAction(
              {
                page: options.page,
                toolName: 'fill' as IRToolName,
                toolInput: { targetDescription, ref, text, fillValue },
                stepIndex,
              },
              { ok: true },
              preResult,
            )
          }

          const content: ContentBlock[] = []
          if (meta.error) content.push({ type: 'text', text: `SCREENSHOT_FAILED: ${meta.error}` })
          if (snapshotMeta.error) content.push({ type: 'text', text: `SNAPSHOT_FAILED: ${snapshotMeta.error}` })
          content.push({ type: 'text', text: safeStringify(summarizeToolResult(result as any)) })

          return { content, isError: !result.ok }
        },
      ),
      tool(
        'select_option',
        'Select an option in a dropdown using a ref from the latest snapshot.',
        {
          ref: z.string(),
          label: z.string(),
          stepIndex: stepIndexSchema,
        },
        async (args) => {
          const stepIndex = parseStepIndex((args as any).stepIndex)
          const contextMode = getToolContextMode()
          const ref = normalizeToolStringInput(args.ref)
          const label = normalizeToolStringInput(args.label)
          const fileBaseName = nextFileBaseName('select_option')
          const startTime = Date.now()
          logToolCall('select_option', { ref, label }, stepIndex)
          writeDebug(options.debug, `mcp_tool=select_option ref=${ref} label=${label} stepIndex=${stepIndex}`)

          if (!isValidSnapshotRef(ref)) {
            const result = {
              ok: false as const,
              error: {
                code: 'INVALID_INPUT' as const,
                message: `Invalid ref: ${ref}. Ref must come from snapshot like e15.`,
                retriable: false,
                cause: undefined,
              },
            }

            logToolResult('select_option', startTime, result as any, stepIndex, {})
            return {
              content: [{ type: 'text', text: safeStringify(summarizeToolResult(result as any)) }],
              isError: true,
            }
          }

          const snapshotCapturePromise = contextMode === 'snapshot' ? capturePreActionSnapshot() : Promise.resolve(undefined)

          let irPreActionResult: PreActionResult | null = null

          const { result, meta } = await runWithPreActionScreenshot({
            page: options.page,
            runId: options.runId,
            debug: options.debug,
            cwd: options.cwd,
            fileBaseName,
            quality: DEFAULT_JPEG_QUALITY,
            action: async () => {
              await snapshotCapturePromise
              try {
                const locator = await resolveRefLocator(ref)
                const count = await locator.count()
                if (count <= 0) {
                  return {
                    ok: false as const,
                    error: {
                      code: 'ELEMENT_NOT_FOUND',
                      message: `Ref not found: ${ref}`,
                      retriable: true,
                      cause: undefined,
                    },
                  }
                }

                irPreActionResult = await irRecorder.prepareForAction(options.page, 'select_option', locator)

                await locator.selectOption({ label })
                return { ok: true as const, data: { ref, label } }
              } catch (err: unknown) {
                return { ok: false as const, error: toToolError(err) }
              }
            },
          })

          const snapshotCapture = await snapshotCapturePromise
          const snapshotMeta = snapshotCapture
            ? await writeSnapshotsIfNeeded(
              snapshotCapture,
              { cwd: options.cwd, runId: options.runId, fileBaseName },
              shouldWriteArtifacts(options.debug, Boolean(result.ok)),
            )
            : ({ captured: false } as SnapshotMeta)

          logToolResult('select_option', startTime, result as any, stepIndex, { ...meta, snapshot: snapshotMeta })

          if (result.ok && irRecorder.isEnabled()) {
            await irRecorder.recordAction(
              {
                page: options.page,
                toolName: 'select_option' as IRToolName,
                toolInput: { ref, label },
                stepIndex,
              },
              { ok: true },
              irPreActionResult,
            )
          }

          const content: ContentBlock[] = []
          if (meta.error) content.push({ type: 'text', text: `SCREENSHOT_FAILED: ${meta.error}` })
          if (snapshotMeta.error) content.push({ type: 'text', text: `SNAPSHOT_FAILED: ${snapshotMeta.error}` })
          content.push({ type: 'text', text: safeStringify(summarizeToolResult(result as any)) })

          return { content, isError: !result.ok }
        },
      ),
      tool(
        'scroll',
        'Scroll the page up or down by an amount. Captures a pre-action screenshot and returns it as an image block.',
        {
          direction: z.enum(['up', 'down']),
          amount: z.number(),
          stepIndex: stepIndexSchema,
        },
        async (args) => {
          const stepIndex = parseStepIndex((args as any).stepIndex)
          const contextMode = getToolContextMode()
          const fileBaseName = nextFileBaseName('scroll')
          const startTime = Date.now()
          logToolCall('scroll', { direction: args.direction, amount: args.amount }, stepIndex)
          writeDebug(options.debug, `mcp_tool=scroll direction=${args.direction} amount=${args.amount} stepIndex=${stepIndex}`)

          const snapshotCapturePromise = contextMode === 'snapshot' ? capturePreActionSnapshot() : Promise.resolve(undefined)

          const { result, meta } = await runWithPreActionScreenshot({
            page: options.page,
            runId: options.runId,
            debug: options.debug,
            cwd: options.cwd,
            fileBaseName,
            quality: DEFAULT_JPEG_QUALITY,
            action: async () => {
              await snapshotCapturePromise
              return scroll({ page: options.page, direction: args.direction, amount: args.amount })
            },
          })

          const snapshotCapture = await snapshotCapturePromise
          const snapshotMeta = snapshotCapture
            ? await writeSnapshotsIfNeeded(
              snapshotCapture,
              { cwd: options.cwd, runId: options.runId, fileBaseName },
              shouldWriteArtifacts(options.debug, Boolean(result.ok)),
            )
            : ({ captured: false } as SnapshotMeta)

          logToolResult('scroll', startTime, result as any, stepIndex, { ...meta, snapshot: snapshotMeta })

          const content: ContentBlock[] = []
          if (meta.error) content.push({ type: 'text', text: `SCREENSHOT_FAILED: ${meta.error}` })
          if (snapshotMeta.error) content.push({ type: 'text', text: `SNAPSHOT_FAILED: ${snapshotMeta.error}` })
          content.push({ type: 'text', text: safeStringify(summarizeToolResult(result as any)) })

          return { content, isError: !result.ok }
        },
      ),
      tool(
        'wait',
        'Wait for N seconds. Optional pre-action screenshot (kept for consistency).',
        {
          seconds: z.number(),
          stepIndex: stepIndexSchema,
        },
        async (args) => {
          const stepIndex = parseStepIndex((args as any).stepIndex)
          const contextMode = getToolContextMode()
          const fileBaseName = nextFileBaseName('wait')
          const startTime = Date.now()
          logToolCall('wait', { seconds: args.seconds }, stepIndex)
          writeDebug(options.debug, `mcp_tool=wait seconds=${args.seconds} stepIndex=${stepIndex}`)

          const snapshotCapturePromise = contextMode === 'snapshot' ? capturePreActionSnapshot() : Promise.resolve(undefined)

          const { result, meta } = await runWithPreActionScreenshot({
            page: options.page,
            runId: options.runId,
            debug: options.debug,
            cwd: options.cwd,
            fileBaseName,
            quality: DEFAULT_JPEG_QUALITY,
            action: async () => {
              await snapshotCapturePromise
              return wait({ page: options.page, seconds: args.seconds })
            },
          })

          const snapshotCapture = await snapshotCapturePromise
          const snapshotMeta = snapshotCapture
            ? await writeSnapshotsIfNeeded(
              snapshotCapture,
              { cwd: options.cwd, runId: options.runId, fileBaseName },
              shouldWriteArtifacts(options.debug, Boolean(result.ok)),
            )
            : ({ captured: false } as SnapshotMeta)

          logToolResult('wait', startTime, result as any, stepIndex, { ...meta, snapshot: snapshotMeta })

          const content: ContentBlock[] = []
          if (meta.error) content.push({ type: 'text', text: `SCREENSHOT_FAILED: ${meta.error}` })
          if (snapshotMeta.error) content.push({ type: 'text', text: `SNAPSHOT_FAILED: ${snapshotMeta.error}` })
          content.push({ type: 'text', text: safeStringify(summarizeToolResult(result as any)) })

          return { content, isError: !result.ok }
        },
      ),
      tool(
        'assertTextPresent',
        'Assert that the page contains the specified text. Returns ok=true if found, ok=false with ASSERTION_FAILED if not found.',
        {
          text: z.string(),
          stepIndex: stepIndexSchema,
        },
        async (args) => {
          const stepIndex = parseStepIndex((args as any).stepIndex)
          const contextMode = getToolContextMode()
          const text = normalizeToolStringInput(args.text)
          const fileBaseName = nextFileBaseName('assertTextPresent')
          const startTime = Date.now()
          logToolCall('assertTextPresent', { text }, stepIndex)
          writeDebug(options.debug, `mcp_tool=assertTextPresent textLength=${text.length} stepIndex=${stepIndex}`)

          const snapshotCapturePromise = contextMode === 'snapshot' ? capturePreActionSnapshot() : Promise.resolve(undefined)

          const { result, meta } = await runWithPreActionScreenshot({
            page: options.page,
            runId: options.runId,
            debug: options.debug,
            cwd: options.cwd,
            fileBaseName,
            quality: DEFAULT_JPEG_QUALITY,
            action: async () => {
              await snapshotCapturePromise
              return assertTextPresent({ page: options.page, text })
            },
          })

          const snapshotCapture = await snapshotCapturePromise
          const snapshotMeta = snapshotCapture
            ? await writeSnapshotsIfNeeded(
              snapshotCapture,
              { cwd: options.cwd, runId: options.runId, fileBaseName },
              shouldWriteArtifacts(options.debug, Boolean(result.ok)),
            )
            : ({ captured: false } as SnapshotMeta)

          logToolResult('assertTextPresent', startTime, result as any, stepIndex, { ...meta, snapshot: snapshotMeta })

          if (result.ok && irRecorder.isEnabled()) {
            let visibleNth: number | undefined
            try {
              const locator = options.page.getByText(text)
              const count = await locator.count()
              const limit = Math.min(count, 5)
              for (let i = 0; i < limit; i++) {
                const candidate = locator.nth(i)
                if (await candidate.isVisible()) {
                  visibleNth = i
                  break
                }
              }
            } catch {
              visibleNth = undefined
            }

            await irRecorder.recordAction(
              {
                page: options.page,
                toolName: 'assertTextPresent' as IRToolName,
                toolInput: { text, ...(typeof visibleNth === 'number' ? { visibleNth } : {}) },
                stepIndex,
              },
              { ok: true },
              null,
            )
          }

          const content: ContentBlock[] = []
          if (meta.error) content.push({ type: 'text', text: `SCREENSHOT_FAILED: ${meta.error}` })
          if (snapshotMeta.error) content.push({ type: 'text', text: `SNAPSHOT_FAILED: ${snapshotMeta.error}` })
          content.push({ type: 'text', text: safeStringify(summarizeToolResult(result as any)) })

          return { content, isError: !result.ok }
        },
      ),
      tool(
        'assertElementVisible',
        'Assert that an element described by targetDescription or ref is visible on the page. Returns ok=true if visible, ok=false with ASSERTION_FAILED if not visible.',
        {
          targetDescription: z.string().optional(),
          ref: z.string().optional(),
          stepIndex: stepIndexSchema,
        },
        async (args) => {
          const stepIndex = parseStepIndex((args as any).stepIndex)
          const contextMode = getToolContextMode()
          const targetDescription = typeof (args as any).targetDescription === 'string' ? normalizeToolStringInput((args as any).targetDescription) : ''
          const ref = typeof (args as any).ref === 'string' ? normalizeToolStringInput((args as any).ref) : ''
          const fileBaseName = nextFileBaseName('assertElementVisible')
          const startTime = Date.now()
          logToolCall('assertElementVisible', { targetDescription, ref }, stepIndex)
          writeDebug(
            options.debug,
            `mcp_tool=assertElementVisible targetLength=${targetDescription.length}${ref ? ` refLength=${ref.length}` : ''} stepIndex=${stepIndex}`,
          )

          if (ref && !isValidSnapshotRef(ref)) {
            const result = {
              ok: false as const,
              error: {
                code: 'INVALID_INPUT' as const,
                message: `Invalid ref: ${ref}. Ref must come from snapshot like e15.`,
                retriable: false,
                cause: undefined,
              },
            }

            logToolResult('assertElementVisible', startTime, result as any, stepIndex, {})
            return {
              content: [{ type: 'text', text: safeStringify(summarizeToolResult(result as any)) }],
              isError: true,
            }
          }

          const snapshotCapturePromise = contextMode === 'snapshot' ? capturePreActionSnapshot() : Promise.resolve(undefined)

          let irPreActionResult: PreActionResult | null = null

          const { result, meta } = await runWithPreActionScreenshot({
            page: options.page,
            runId: options.runId,
            debug: options.debug,
            cwd: options.cwd,
            fileBaseName,
            quality: DEFAULT_JPEG_QUALITY,
            action: async () => {
              await snapshotCapturePromise
              if (!ref && !targetDescription) {
                return {
                  ok: false as const,
                  error: {
                    code: 'INVALID_INPUT' as const,
                    message: 'Either ref or targetDescription is required',
                    retriable: false,
                    cause: undefined,
                  },
                }
              }
              if (ref) {
                try {
                  const locator = await resolveRefLocator(ref)
                  const count = await locator.count()
                  if (count <= 0) {
                    return {
                      ok: false as const,
                      error: {
                        code: 'ASSERTION_FAILED' as const,
                        message: `Ref not found or not visible: ${ref}`,
                        retriable: true,
                        cause: undefined,
                      },
                    }
                  }

                  if (irRecorder.isEnabled()) {
                    irPreActionResult = await irRecorder.prepareForAction(options.page, 'assertElementVisible', locator)
                  }

                  const isVisible = await locator.isVisible()
                  if (isVisible) {
                    if (targetDescription) {
                      let fp: ElementFingerprint | null | undefined = irPreActionResult?.fingerprint
                      if (!fp) {
                        try {
                          const handle = await locator.elementHandle({ timeout: 2000 })
                          if (handle) {
                            fp = await extractFingerprint(handle)
                            await handle.dispose()
                          }
                        } catch {
                          fp = undefined
                        }
                      }

                      if (!fingerprintMatchesTargetDescription(fp, targetDescription)) {
                        try {
                          const fallbackLocator = await resolveVisibleElement(options.page, targetDescription)
                          if (fallbackLocator) {
                            if (irRecorder.isEnabled()) {
                              irPreActionResult = await irRecorder.prepareForAction(
                                options.page,
                                'assertElementVisible',
                                fallbackLocator,
                              )
                            }

                            return { ok: true as const, data: { ref, targetDescription } }
                          }
                        } catch {
                        }

                        const fpText = fingerprintToSearchText(fp)
                        return {
                          ok: false as const,
                          error: {
                            code: 'ASSERTION_FAILED' as const,
                            message: `Ref resolved but does not match targetDescription: ref=${ref} targetDescription="${targetDescription}" fingerprint="${fpText.slice(0, 80)}"`,
                            retriable: true,
                            cause: undefined,
                          },
                        }
                      }
                    }
                    return { ok: true as const, data: { ref, targetDescription } }
                  }
                  return {
                    ok: false as const,
                    error: {
                      code: 'ASSERTION_FAILED' as const,
                      message: `Element with ref not visible: ${ref}`,
                      retriable: true,
                      cause: undefined,
                    },
                  }
                } catch (err: unknown) {
                  return { ok: false as const, error: toToolError(err, { defaultCode: 'ASSERTION_FAILED' }) }
                }
              }

              try {
                const locator = await resolveVisibleElement(options.page, targetDescription)
                if (locator) {
                  if (irRecorder.isEnabled()) {
                    irPreActionResult = await irRecorder.prepareForAction(options.page, 'assertElementVisible', locator)
                  }
                  return { ok: true as const, data: { targetDescription } }
                }
                return {
                  ok: false as const,
                  error: {
                    code: 'ASSERTION_FAILED' as const,
                    message: `Element not visible: "${targetDescription}"`,
                    retriable: true,
                    cause: undefined,
                  },
                }
              } catch (err: unknown) {
                return { ok: false as const, error: toToolError(err, { defaultCode: 'ASSERTION_FAILED' }) }
              }
            },
          })

          const snapshotCapture = await snapshotCapturePromise
          const snapshotMeta = snapshotCapture
            ? await writeSnapshotsIfNeeded(
              snapshotCapture,
              { cwd: options.cwd, runId: options.runId, fileBaseName },
              shouldWriteArtifacts(options.debug, Boolean(result.ok)),
            )
            : ({ captured: false } as SnapshotMeta)

          logToolResult('assertElementVisible', startTime, result as any, stepIndex, { ...meta, snapshot: snapshotMeta })

          if (result.ok && irRecorder.isEnabled()) {
            await irRecorder.recordAction(
              {
                page: options.page,
                toolName: 'assertElementVisible' as IRToolName,
                toolInput: { targetDescription, ref },
                stepIndex,
              },
              { ok: true },
              irPreActionResult,
            )
          }

          const content: ContentBlock[] = []
          if (meta.error) content.push({ type: 'text', text: `SCREENSHOT_FAILED: ${meta.error}` })
          if (snapshotMeta.error) content.push({ type: 'text', text: `SNAPSHOT_FAILED: ${snapshotMeta.error}` })
          content.push({ type: 'text', text: safeStringify(summarizeToolResult(result as any)) })

          return { content, isError: !result.ok }
        },
      ),
    ],
  })
}
