/**
 * Guardrail configuration for exploration sessions
 * Based on Tech Spec: ts-7-agent-based-intelligent-planner.md
 */
export type GuardrailConfig = {
  maxAgentTurnsPerRun?: number
  maxSnapshotsPerRun?: number
  maxPagesPerRun?: number
  maxTokenPerRun?: number
}

/**
 * Authentication configuration
 * Based on Tech Spec: ts-7-agent-based-intelligent-planner.md
 */
export type AuthConfig = {
  loginUrl?: string
  usernameVar?: string
  passwordVar?: string
  username?: string
  password?: string
  extra?: Record<string, unknown>
}

/**
 * Plan configuration following Tech Spec structure
 * Based on Tech Spec: ts-7-agent-based-intelligent-planner.md#PlanConfig
 */
export type PlanConfig = {
  baseUrl: string
  maxDepth: number
  maxPages?: number
  includePatterns?: string[]
  excludePatterns?: string[]
  testTypes?: ('functional' | 'form' | 'navigation' | 'responsive' | 'boundary' | 'security')[]
  guardrails?: GuardrailConfig
  auth?: AuthConfig
}

/**
 * Locator candidate for element identification
 */
export type LocatorCandidate = {
  strategy: 'role' | 'testId' | 'label' | 'text' | 'placeholder' | 'css'
  value: string
  priority: number
}

/**
 * Element summary following Tech Spec structure
 * Based on Tech Spec: ts-7-agent-based-intelligent-planner.md#ElementSummary
 */
export type ElementSummary = {
  id: string
  kind: 'button' | 'link' | 'input' | 'textarea' | 'select' | 'form' | 'other'
  text?: string
  role?: string
  locatorCandidates?: LocatorCandidate[]
  ariaLabel?: string
  href?: string
  inputType?: string
  name?: string
  placeholder?: string
  required?: boolean
}

/**
 * Form information with fields and submit button
 */
export type FormInfo = {
  id: string
  locatorCandidates: LocatorCandidate[]
  fields: ElementSummary[]
  submitButton?: ElementSummary
}

/**
 * Page node following Tech Spec structure
 * Based on Tech Spec: ts-7-agent-based-intelligent-planner.md#PageNode
 */
export type PageNode = {
  id: string
  url: string
  title?: string
  depth: number
  visitedAt: string
  snapshotRef?: string
  elementSummary: ElementSummary[]
  forms: FormInfo[]
  links: Array<{ text: string; href: string; external: boolean }>
}

/**
 * Navigation edge representing page transitions
 */
export type NavigationEdge = {
  from: string
  to: string
  action: 'navigate' | 'click' | 'form_submit'
  trigger?: string
}

/**
 * Exploration graph following Tech Spec structure
 * Based on Tech Spec: ts-7-agent-based-intelligent-planner.md#ExplorationGraph
 */
export type ExplorationGraph = {
  pages: PageNode[]
  edges: NavigationEdge[]
}

/**
 * Exploration statistics with actual max depth reached
 */
export type ExplorationStats = {
  pagesVisited: number
  elementsFound: number
  formsFound: number
  linksFound: number
  maxDepthReached: number
  configuredDepth: number
}

/**
 * Guardrail trigger information
 */
export type GuardrailTrigger = {
  code: 'MAX_AGENT_TURNS' | 'MAX_SNAPSHOTS' | 'MAX_PAGES' | 'MAX_TOKENS'
  limit: number
  actual: number
  triggeredAt: string
}

/**
 * Login status for exploration result
 */
export type LoginStatus = {
  attempted: boolean
  ok: boolean
  error?: string
  stage?: 'navigation' | 'fill_username' | 'fill_password' | 'submit' | 'verification'
  snapshotRef?: string
}

/**
 * Transcript entry for Agent exploration process
 */
export type TranscriptEntry = {
  timestamp: string
  runId: string
  type: 'agent_prompt' | 'tool_call' | 'tool_result' | 'agent_thinking' | 'page_visited' | 'element_found' | 'login_attempt' | 'guardrail_triggered' | 'error'
  prompt?: string
  toolName?: string
  toolInput?: Record<string, unknown>
  toolResult?: { ok: boolean; error?: string; data?: unknown }
  result?: string
  isError?: boolean
  pageUrl?: string
  elementCount?: number
  thinking?: string
  error?: string
  guardrail?: GuardrailTrigger
}

/**
 * Exploration result with all required artifacts
 */
export type ExplorationResult = {
  runId: string
  startUrl: string
  startedAt: string
  finishedAt: string
  stats: ExplorationStats
  login?: LoginStatus
  guardrailTriggered?: GuardrailTrigger
  error?: {
    message: string
    stage: 'login' | 'navigation' | 'exploration' | 'unknown'
    pageUrl?: string
  }
  graph: ExplorationGraph
  transcript: TranscriptEntry[]
}

/**
 * Elements output structure for explore-elements.json
 */
export type ExplorationElements = {
  runId: string
  generatedAt: string
  pages: Array<{
    pageId: string
    pageUrl: string
    elements: ElementSummary[]
    forms: FormInfo[]
  }>
}
