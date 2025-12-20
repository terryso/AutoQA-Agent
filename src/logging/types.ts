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
  tracePath?: string
  tracingError?: string
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
  snapshot?: {
    ariaRelativePath?: string
    axRelativePath?: string
  }
  snapshotError?: string
}

export type GuardrailTriggeredEvent = LogEventBase & {
  event: 'autoqa.guardrail.triggered'
  specPath: string
  stepIndex: number | null
  code: string
  limit: number
  actual: number
}

export type SpecFailureScreenshotEvent = LogEventBase & {
  event: 'autoqa.spec.failure_screenshot'
  specPath: string
  screenshotPath: string
}

export type PlanExploreStartedEvent = LogEventBase & {
  event: 'autoqa.plan.explore.started'
  url: string
  depth: number
}

export type PlanExploreFinishedEvent = LogEventBase & {
  event: 'autoqa.plan.explore.finished'
  stats: {
    pagesVisited: number
    elementsFound: number
    formsFound: number
    linksFound: number
    maxDepthReached: number
    configuredDepth: number
  }
}

export type PlanExploreFailedEvent = LogEventBase & {
  event: 'autoqa.plan.explore.failed'
  error: string
}

export type PlanExploreLoginStartedEvent = LogEventBase & {
  event: 'autoqa.plan.explore.login.started'
  loginUrl: string
}

export type PlanExploreLoginFinishedEvent = LogEventBase & {
  event: 'autoqa.plan.explore.login.finished'
  ok: boolean
}

export type PlanExploreLoginFailedEvent = LogEventBase & {
  event: 'autoqa.plan.explore.login.failed'
  error: string
}

export type PlanExplorePageStartedEvent = LogEventBase & {
  event: 'autoqa.plan.explore.page.started'
  url: string
  depth: number
}

export type PlanExplorePageFinishedEvent = LogEventBase & {
  event: 'autoqa.plan.explore.page.finished'
  url: string
  elementsFound: number
  formsFound: number
  linksFound: number
}

export type PlanExplorePageFailedEvent = LogEventBase & {
  event: 'autoqa.plan.explore.page.failed'
  url: string
  error: string
}

export type LogEvent =
  | RunStartedEvent
  | RunFinishedEvent
  | SpecStartedEvent
  | SpecFinishedEvent
  | ToolCalledEvent
  | ToolResultEvent
  | GuardrailTriggeredEvent
  | SpecFailureScreenshotEvent
  | PlanExploreStartedEvent
  | PlanExploreFinishedEvent
  | PlanExploreFailedEvent
  | PlanExploreLoginStartedEvent
  | PlanExploreLoginFinishedEvent
  | PlanExploreLoginFailedEvent
  | PlanExplorePageStartedEvent
  | PlanExplorePageFinishedEvent
  | PlanExplorePageFailedEvent
