/**
 * Exploration Output Module
 * Writes three artifact files as required by AC2:
 * - explore-graph.json: Page nodes + navigation edges
 * - explore-elements.json: Interactive elements per page
 * - explore-transcript.jsonl: Agent tool calls and thinking
 */
import { mkdir, writeFile, appendFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type {
  ExplorationResult,
  ExplorationGraph,
  ExplorationElements,
  TranscriptEntry,
} from './types.js'

export type WriteExplorationResultOptions = {
  cwd?: string
  runId: string
}

export type WriteExplorationOutput = {
  graphPath?: string
  elementsPath?: string
  transcriptPath?: string
  errors: string[]
}

function sanitizePathSegment(value: string): string {
  const cleaned = (value ?? '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
  if (cleaned === '.' || cleaned === '..') return 'unknown'
  return cleaned.length > 0 ? cleaned : 'unknown'
}

/**
 * Write explore-graph.json
 * Contains page nodes and navigation edges
 */
async function writeExplorationGraph(
  graph: ExplorationGraph,
  dir: string,
  runId: string,
): Promise<{ path?: string; error?: string }> {
  const fileName = 'explore-graph.json'
  const absPath = resolve(dir, fileName)
  const relPath = `.autoqa/runs/${runId}/plan-explore/${fileName}`

  try {
    const content = JSON.stringify(graph, null, 2)
    await writeFile(absPath, content, { encoding: 'utf-8', mode: 0o600 })
    return { path: relPath }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { error: `Failed to write explore-graph.json: ${msg}` }
  }
}

/**
 * Write explore-elements.json
 * Contains interactive elements per page
 */
async function writeExplorationElements(
  result: ExplorationResult,
  dir: string,
  runId: string,
): Promise<{ path?: string; error?: string }> {
  const fileName = 'explore-elements.json'
  const absPath = resolve(dir, fileName)
  const relPath = `.autoqa/runs/${runId}/plan-explore/${fileName}`

  const elements: ExplorationElements = {
    runId: result.runId,
    generatedAt: new Date().toISOString(),
    pages: result.graph.pages.map((page) => ({
      pageId: page.id,
      pageUrl: page.url,
      elements: page.elementSummary,
      forms: page.forms,
    })),
  }

  try {
    const content = JSON.stringify(elements, null, 2)
    await writeFile(absPath, content, { encoding: 'utf-8', mode: 0o600 })
    return { path: relPath }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { error: `Failed to write explore-elements.json: ${msg}` }
  }
}

/**
 * Write explore-transcript.jsonl
 * Contains Agent tool calls and thinking (one JSON per line)
 */
async function writeExplorationTranscript(
  transcript: TranscriptEntry[],
  dir: string,
  runId: string,
): Promise<{ path?: string; error?: string }> {
  const fileName = 'explore-transcript.jsonl'
  const absPath = resolve(dir, fileName)
  const relPath = `.autoqa/runs/${runId}/plan-explore/${fileName}`

  try {
    const lines = transcript.map((entry) => JSON.stringify(entry)).join('\n')
    await writeFile(absPath, lines + '\n', { encoding: 'utf-8', mode: 0o600 })
    return { path: relPath }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { error: `Failed to write explore-transcript.jsonl: ${msg}` }
  }
}

/**
 * Write all exploration artifacts
 * Creates three files as required by Story 7.1 AC2
 */
export async function writeExplorationResult(
  result: ExplorationResult,
  options: WriteExplorationResultOptions,
): Promise<WriteExplorationOutput> {
  const cwd = options.cwd ?? process.cwd()
  const runId = sanitizePathSegment(options.runId)
  const dir = resolve(cwd, '.autoqa', 'runs', runId, 'plan-explore')
  const errors: string[] = []
  const output: WriteExplorationOutput = { errors }

  try {
    await mkdir(dir, { recursive: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(`Failed to create output directory: ${msg}`)
    return output
  }

  // Write explore-graph.json
  const graphResult = await writeExplorationGraph(result.graph, dir, runId)
  if (graphResult.path) {
    output.graphPath = graphResult.path
  } else if (graphResult.error) {
    errors.push(graphResult.error)
  }

  // Write explore-elements.json
  const elementsResult = await writeExplorationElements(result, dir, runId)
  if (elementsResult.path) {
    output.elementsPath = elementsResult.path
  } else if (elementsResult.error) {
    errors.push(elementsResult.error)
  }

  // Write explore-transcript.jsonl
  const transcriptResult = await writeExplorationTranscript(result.transcript, dir, runId)
  if (transcriptResult.path) {
    output.transcriptPath = transcriptResult.path
  } else if (transcriptResult.error) {
    errors.push(transcriptResult.error)
  }

  return output
}
