import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

import { createLogger, getArtifactRootPath, ensureArtifactDir } from '../../src/logging/logger.js'

describe('getArtifactRootPath', () => {
  it('returns correct artifact root path', () => {
    const result = getArtifactRootPath('/home/user/project', 'abc-123')
    expect(result).toBe('.autoqa/runs/abc-123')
  })
})

describe('ensureArtifactDir', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = resolve(tmpdir(), `autoqa-test-${randomUUID()}`)
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  })

  it('creates artifact directory and returns relative path', async () => {
    const runId = 'test-run-123'
    const result = await ensureArtifactDir(testDir, runId)

    expect(result).toBe('.autoqa/runs/test-run-123')

    const absPath = resolve(testDir, result)
    const stat = await import('node:fs/promises').then((m) => m.stat(absPath))
    expect(stat.isDirectory()).toBe(true)
  })
})

describe('createLogger', () => {
  let testDir: string
  let runId: string

  beforeEach(async () => {
    testDir = resolve(tmpdir(), `autoqa-test-${randomUUID()}`)
    runId = randomUUID()
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  })

  it('logs events to file as JSON lines', async () => {
    const logger = createLogger({ runId, cwd: testDir })

    logger.log({
      event: 'autoqa.run.started',
      runId,
      baseUrl: 'http://localhost:3000',
      headless: true,
      debug: false,
      artifactRoot: '.autoqa/runs/' + runId,
      specCount: 1,
    })

    await logger.flush()

    const logPath = resolve(testDir, '.autoqa', 'runs', runId, 'run.log.jsonl')
    const content = await readFile(logPath, 'utf8')
    const lines = content.trim().split('\n')

    expect(lines.length).toBe(1)

    const parsed = JSON.parse(lines[0])
    expect(parsed.event).toBe('autoqa.run.started')
    expect(parsed.runId).toBe(runId)
    expect(parsed.baseUrl).toBe('http://localhost:3000')
    expect(parsed.timestamp).toBeDefined()
  })

  it('logs multiple events', async () => {
    const logger = createLogger({ runId, cwd: testDir })

    logger.log({
      event: 'autoqa.run.started',
      runId,
      baseUrl: 'http://localhost:3000',
      headless: true,
      debug: false,
      artifactRoot: '.autoqa/runs/' + runId,
      specCount: 2,
    })

    logger.log({
      event: 'autoqa.spec.started',
      runId,
      specPath: '/path/to/spec.md',
    })

    logger.log({
      event: 'autoqa.spec.finished',
      runId,
      specPath: '/path/to/spec.md',
      durationMs: 1000,
      ok: true,
    })

    await logger.flush()

    const logPath = resolve(testDir, '.autoqa', 'runs', runId, 'run.log.jsonl')
    const content = await readFile(logPath, 'utf8')
    const lines = content.trim().split('\n')

    expect(lines.length).toBe(3)

    const events = lines.map((line) => JSON.parse(line))
    const eventTypes = events.map((e) => e.event).sort()
    expect(eventTypes).toContain('autoqa.run.started')
    expect(eventTypes).toContain('autoqa.spec.started')
    expect(eventTypes).toContain('autoqa.spec.finished')
  })

  it('logs tool events with required fields', async () => {
    const logger = createLogger({ runId, cwd: testDir })

    logger.log({
      event: 'autoqa.tool.called',
      runId,
      specPath: '/path/to/spec.md',
      toolName: 'navigate',
      stepIndex: null,
      toolInput: { url: '/home' },
    })

    logger.log({
      event: 'autoqa.tool.result',
      runId,
      specPath: '/path/to/spec.md',
      toolName: 'navigate',
      stepIndex: null,
      toolDurationMs: 150,
      ok: true,
      screenshot: {
        mimeType: 'image/jpeg',
        width: 1024,
        height: 768,
        relativePath: '.autoqa/runs/' + runId + '/screenshots/navigate-1.jpg',
      },
    })

    await logger.flush()

    const logPath = resolve(testDir, '.autoqa', 'runs', runId, 'run.log.jsonl')
    const content = await readFile(logPath, 'utf8')
    const lines = content.trim().split('\n')

    expect(lines.length).toBe(2)

    const events = lines.map((line) => JSON.parse(line))
    const toolCalled = events.find((e) => e.event === 'autoqa.tool.called')
    const toolResult = events.find((e) => e.event === 'autoqa.tool.result')

    expect(toolCalled).toBeDefined()
    expect(toolCalled.toolName).toBe('navigate')
    expect(toolCalled.toolInput).toEqual({ url: '/home' })

    expect(toolResult).toBeDefined()
    expect(toolResult.toolDurationMs).toBe(150)
    expect(toolResult.ok).toBe(true)
    expect(toolResult.screenshot.relativePath).toContain('.autoqa/runs/')
  })

  it('logs tool error with error fields', async () => {
    const logger = createLogger({ runId, cwd: testDir })

    logger.log({
      event: 'autoqa.tool.result',
      runId,
      specPath: '/path/to/spec.md',
      toolName: 'click',
      stepIndex: null,
      toolDurationMs: 500,
      ok: false,
      error: {
        code: 'ELEMENT_NOT_FOUND',
        message: 'Could not find element',
        retriable: true,
      },
    })

    await logger.flush()

    const logPath = resolve(testDir, '.autoqa', 'runs', runId, 'run.log.jsonl')
    const content = await readFile(logPath, 'utf8')
    const parsed = JSON.parse(content.trim())

    expect(parsed.ok).toBe(false)
    expect(parsed.error.code).toBe('ELEMENT_NOT_FOUND')
    expect(parsed.error.message).toBe('Could not find element')
    expect(parsed.error.retriable).toBe(true)
  })

  it('logs run.finished with exit code and summary', async () => {
    const logger = createLogger({ runId, cwd: testDir })

    logger.log({
      event: 'autoqa.run.finished',
      runId,
      exitCode: 1,
      durationMs: 5000,
      specsPassed: 1,
      specsFailed: 1,
      failureSummary: 'Spec failed: /path/to/spec.md',
    })

    await logger.flush()

    const logPath = resolve(testDir, '.autoqa', 'runs', runId, 'run.log.jsonl')
    const content = await readFile(logPath, 'utf8')
    const parsed = JSON.parse(content.trim())

    expect(parsed.event).toBe('autoqa.run.finished')
    expect(parsed.exitCode).toBe(1)
    expect(parsed.specsPassed).toBe(1)
    expect(parsed.specsFailed).toBe(1)
    expect(parsed.failureSummary).toContain('Spec failed')
  })
})
