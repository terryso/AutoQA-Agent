export type LogEventBase = {
  runId: string
  timestamp?: string
}

export type RunStartedEvent = LogEventBase & {
  event: 'autoqa.run.started'
  baseUrl: string
  headless: boolean
  debug: boolean
  artifactRoot: string
  specCount: number
}

export type RunFinishedEvent = LogEventBase & {
  event: 'autoqa.run.finished'
  exitCode: number
  durationMs: number
  specsPassed: number
  specsFailed: number
  failureSummary?: string
}

export type SpecStartedEvent = LogEventBase & {
  event: 'autoqa.spec.started'
  specPath: string
}

export type SpecFinishedEvent = LogEventBase & {
  event: 'autoqa.spec.finished'
  specPath: string
  durationMs: number
  ok: boolean
  failureReason?: string
}

export type ToolCalledEvent = LogEventBase & {
  event: 'autoqa.tool.called'
  specPath: string
  toolName: string
  stepIndex: number | null
  toolInput: Record<string, unknown>
}

export type ToolResultEvent = LogEventBase & {
  event: 'autoqa.tool.result'
  specPath: string
  toolName: string
  stepIndex: number | null
  toolDurationMs: number
  ok: boolean
  error?: {
    code?: string
    message?: string
    retriable?: boolean
  }
  screenshot?: {
    mimeType?: string
    width?: number
    height?: number
    relativePath?: string
  }
  screenshotError?: string
}

export type LogEvent =
  | RunStartedEvent
  | RunFinishedEvent
  | SpecStartedEvent
  | SpecFinishedEvent
  | ToolCalledEvent
  | ToolResultEvent
