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
 * Extended in Tech Spec: ts-8-1-8-3-plan-scope-and-executable-specs.md#PlanConfig
 */
export type PlanConfig = {
  baseUrl: string
  maxDepth: number
  maxPages?: number
  includePatterns?: string[]
  excludePatterns?: string[]
  /**
   * Exploration scope mode controlling URL filtering behavior
   * Based on Tech Spec: ts-8-1-8-3-plan-scope-and-executable-specs.md#3.1
   * 
   * - 'site': Default behavior, only domain and maxDepth constraints
   * - 'focused': Only URLs matching includePatterns (and not excludePatterns) are in-scope
   * - 'single_page': Explore current page interactions, limited URL changes (hash routes or includePatterns)
   * 
   * URL matching applies to relative URL (pathname + hash), e.g., "/live/index.html#/channel"
   */
  exploreScope?: 'site' | 'focused' | 'single_page'
  testTypes?: ('functional' | 'form' | 'navigation' | 'responsive' | 'boundary' | 'security')[]
  guardrails?: GuardrailConfig
  auth?: AuthConfig
  /**
   * Logical name or relative path for the login steps spec used by Planner-generated cases
   * that require authentication. This value is emitted verbatim in `include: <name>` steps,
   * and resolved by the runner against the shared steps library root.
   *
   * Examples:
   * - "login" → `include: login` → steps/login.md
   * - "polyv/login.md" → `include: polyv/login.md` → steps/polyv/login.md
   */
  loginStepsSpec?: string
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

/**
 * Test flow grouping for related test cases
 * Based on Tech Spec: ts-7-agent-based-intelligent-planner.md#TestPlan
 */
export type FlowPlan = {
  id: string
  name: string
  description?: string
  /** Page ids that represent the main path of this flow */
  pagePath?: string[]
}

/**
 * Single test case definition for planning output
 * Based on Tech Spec: ts-7-agent-based-intelligent-planner.md#TestCasePlan
 */
export type TestCasePlan = {
  id: string
  name: string
  type: 'functional' | 'form' | 'navigation' | 'responsive' | 'boundary' | 'security'
  priority: 'p0' | 'p1' | 'p2'
  /** Related page ids from ExplorationGraph */
  relatedPageIds: string[]
  /** Markdown relative path under .autoqa/runs/<runId>/plan/specs/ */
  markdownPath: string
  /** High-level preconditions for this test case */
  preconditions?: string[]
  /** Ordered steps with explicit expected results */
  steps?: Array<{
    description: string
    expectedResult: string
  }>
  /**
   * Explicit flag indicating whether this test case requires login.
   * When true, the markdown generator will prepend `include: <loginStepsSpec>`.
   * When false, no login include is added.
   * When undefined, falls back to heuristic detection based on preconditions and steps.
   * 
   * Based on Tech Spec: ts-8-1-8-3-plan-scope-and-executable-specs.md#6.3.4
   */
  requiresLogin?: boolean
}

/**
 * Structured test plan produced by Planner Agent
 * Based on Tech Spec: ts-7-agent-based-intelligent-planner.md#TestPlan
 */
export type TestPlan = {
  runId: string
  generatedAt: string
  /** Effective configuration used for this plan */
  configSnapshot: PlanConfig
  flows: FlowPlan[]
  cases: TestCasePlan[]
}
