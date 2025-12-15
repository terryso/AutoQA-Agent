import { mkdir } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { Writable } from 'node:stream'

import pino from 'pino'

import type { LogEvent } from './types.js'

export type LoggerOptions = {
  runId: string
  cwd?: string
  debug?: boolean
}

export type Logger = {
  log: (event: LogEvent) => void
  flush: () => Promise<void>
}

function getArtifactRoot(cwd: string, runId: string): string {
  return `.autoqa/runs/${runId}`
}

function getLogFilePath(cwd: string, runId: string): string {
  return resolve(cwd, '.autoqa', 'runs', runId, 'run.log.jsonl')
}

function ensureLogDir(cwd: string, runId: string): void {
  const dir = resolve(cwd, '.autoqa', 'runs', runId)
  mkdirSync(dir, { recursive: true })
}

export function createLogger(options: LoggerOptions): Logger {
  const cwd = options.cwd ?? process.cwd()
  const runId = options.runId
  const debug = options.debug ?? false

  let fileDestination: any | undefined
  let closed = false

  try {
    ensureLogDir(cwd, runId)
    const logPath = getLogFilePath(cwd, runId)
    fileDestination = pino.destination({ dest: logPath, sync: false })
  } catch {
    fileDestination = undefined
  }

  const streams: Array<{ stream: any }> = []
  if (fileDestination) streams.push({ stream: fileDestination })
  if (debug) streams.push({ stream: pino.destination({ dest: 2, sync: true }) })

  const destination =
    streams.length === 0
      ? new Writable({
          write(_chunk, _encoding, callback) {
            callback()
          },
        })
      : streams.length === 1
        ? streams[0].stream
        : pino.multistream(streams)

  const pinoLogger = pino(
    {
      base: undefined,
      timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    },
    destination,
  )

  const log = (event: LogEvent): void => {
    try {
      pinoLogger.info(event)
    } catch {
      // ignore logging errors - logging should not break the run
    }
  }

  const flush = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      try {
        pinoLogger.flush(() => resolve())
      } catch {
        resolve()
      }
    })

    if (!closed && fileDestination?.end) {
      closed = true
      try {
        fileDestination.end()
      } catch {
        // ignore close errors
      }
    }
  }

  return { log, flush }
}

export function getArtifactRootPath(cwd: string, runId: string): string {
  return getArtifactRoot(cwd, runId)
}

export async function ensureArtifactDir(cwd: string, runId: string): Promise<string> {
  const artifactRoot = getArtifactRoot(cwd, runId)
  const absPath = resolve(cwd, artifactRoot)
  await mkdir(absPath, { recursive: true })
  return artifactRoot
}
