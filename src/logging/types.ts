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

export type PlanGenerateStartedEvent = LogEventBase & {
  event: 'autoqa.plan.generate.started'
  baseUrl: string
  pageCount: number
}

export type PlanGenerateFinishedEvent = LogEventBase & {
  event: 'autoqa.plan.generate.finished'
  caseCount: number
}

export type PlanGenerateOrchestratorStartedEvent = LogEventBase & {
  event: 'autoqa.plan.generate.orchestrator.started'
  pageCount: number
}

export type PlanGenerateOrchestratorOutputErrorsEvent = LogEventBase & {
  event: 'autoqa.plan.generate.orchestrator.output_errors'
  errors: string[]
}

export type PlanGenerateOrchestratorFinishedEvent = LogEventBase & {
  event: 'autoqa.plan.generate.orchestrator.finished'
  caseCount: number
  specCount: number
}

export type PlanGenerateUrlScopeFilteredEvent = LogEventBase & {
  event: 'autoqa.plan.generate.url_scope_filtered'
  originalPageCount: number
  filteredPageCount: number
  exploreScope: string
}

export type PlanGenerateFailedEvent = LogEventBase & {
  event: 'autoqa.plan.generate.failed'
  error: string
}

export type PlanStartedEvent = LogEventBase & {
  event: 'autoqa.plan.started'
  baseUrl: string
}

export type PlanFinishedEvent = LogEventBase & {
  event: 'autoqa.plan.finished'
  pagesVisited: number
  caseCount: number
  specCount: number
}

export type PlanFailedEvent = LogEventBase & {
  event: 'autoqa.plan.failed'
  error: string
}

// Repair mode events
export type RepairStartedEvent = LogEventBase & {
  event: 'autoqa.repair.started'
  specPath: string
  repairMode: true
}

export type RepairBrowserLaunchedEvent = LogEventBase & {
  event: 'autoqa.repair.browser_launched'
  specPath: string
  headless: false
}

export type RepairContextFailedEvent = LogEventBase & {
  event: 'autoqa.repair.context_failed'
  error: string
}

export type RepairStepsIdentifiedEvent = LogEventBase & {
  event: 'autoqa.repair.steps_identified'
  specPath: string
  failedStepCount: number
  firstFailedStepIndex: number
  failedSteps: Array<{ stepIndex: number; toolName: string }>
}

export type RepairReplayFailedEvent = LogEventBase & {
  event: 'autoqa.repair.replay.failed'
  failedAtStep?: number
  reason?: string
  error?: string
}

export type RepairReplaySucceededEvent = LogEventBase & {
  event: 'autoqa.repair.replay.succeeded'
  replayedCount: number
  currentStepIndex: number
}

export type RepairElementPickerAlreadyEnabledEvent = LogEventBase & {
  event: 'autoqa.repair.element_picker.already_enabled'
  specPath: string
}

export type RepairElementPickerEnabledEvent = LogEventBase & {
  event: 'autoqa.repair.element_picker.enabled'
  specPath: string
}

export type RepairElementPickerDisabledEvent = LogEventBase & {
  event: 'autoqa.repair.element_picker.disabled'
  specPath: string
}

export type RepairElementPickerDisableFailedEvent = LogEventBase & {
  event: 'autoqa.repair.element_picker.disable_failed'
  specPath: string
  error: string
}

export type RepairElementSelectionWaitingEvent = LogEventBase & {
  event: 'autoqa.repair.element_selection.waiting'
  specPath: string
}

export type RepairElementSelectionReceivedEvent = LogEventBase & {
  event: 'autoqa.repair.element_selection.received'
  specPath: string
  tagName: string
  hasTestId: boolean
  hasId: boolean
}

export type RepairElementSelectionFailedEvent = LogEventBase & {
  event: 'autoqa.repair.element_selection.failed'
  specPath: string
  error: string
}

export type RepairLocatorValidatedEvent = LogEventBase & {
  event: 'autoqa.repair.locator_validated'
  specPath: string
  locatorKind: string
  locatorCode: string
  isUnique: boolean
  matchCount: number
}

export type RepairLocatorCandidatesGeneratedEvent = LogEventBase & {
  event: 'autoqa.repair.locator_candidates.generated'
  specPath: string
  candidateCount: number
  recommendedUnique: boolean
}

export type RepairLocatorPromptDisplayedEvent = LogEventBase & {
  event: 'autoqa.repair.locator_prompt.displayed'
  specPath: string
  candidateCount: number
  hasUnique: boolean
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
  | PlanGenerateStartedEvent
  | PlanGenerateFinishedEvent
  | PlanGenerateFailedEvent
  | PlanGenerateOrchestratorStartedEvent
  | PlanGenerateOrchestratorOutputErrorsEvent
  | PlanGenerateOrchestratorFinishedEvent
  | PlanGenerateUrlScopeFilteredEvent
  | PlanStartedEvent
  | PlanFinishedEvent
  | PlanFailedEvent
  | RepairStartedEvent
  | RepairBrowserLaunchedEvent
  | RepairContextFailedEvent
  | RepairStepsIdentifiedEvent
  | RepairReplayFailedEvent
  | RepairReplaySucceededEvent
  | RepairElementPickerAlreadyEnabledEvent
  | RepairElementPickerEnabledEvent
  | RepairElementPickerDisabledEvent
  | RepairElementPickerDisableFailedEvent
  | RepairElementSelectionWaitingEvent
  | RepairElementSelectionReceivedEvent
  | RepairElementSelectionFailedEvent
  | RepairLocatorValidatedEvent
  | RepairLocatorCandidatesGeneratedEvent
  | RepairLocatorPromptDisplayedEvent
