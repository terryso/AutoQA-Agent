/**
 * Core Engine API
 *
 * 为 CLI 使用和未来 GUI 集成提供的核心接口
 * 设计原则：
 * 1. CLI 和 GUI 共享同一套核心逻辑
 * 2. 所有操作通过事件报告进度
 * 3. 支持 pause/resume/stop 控制
 * 4. 类型完整，便于 TypeScript 集成
 */

import type { Page, Browser } from 'playwright'
import type { MarkdownSpec } from '../markdown/spec-types.js'
import type { ActionRecord } from '../ir/types.js'

// ============================================================================
// Public API - Options
// ============================================================================

/**
 * 运行选项
 */
export type RunOptions = {
  /** 目标 URL */
  baseUrl: string
  /** 登录页 URL (可选) */
  loginBaseUrl?: string
  /** 无头模式 (默认: true) */
  headless?: boolean
  /** 调试模式 (默认: false) */
  debug?: boolean
  /** 导出目录 (默认: 'tests/autoqa') */
  exportDir?: string
  /** 运行模式 (默认: 'auto') */
  mode?: 'auto' | 'repair'
}

/**
 * 导出选项
 */
export type ExportOptions = {
  /** 工作目录 */
  cwd: string
  /** 运行 ID */
  runId: string
  /** Spec 路径 */
  specPath: string
  /** Spec 内容 */
  spec: MarkdownSpec
  /** Base URL */
  baseUrl: string
  /** 登录 Base URL (可选) */
  loginBaseUrl?: string
  /** 原始 Spec 内容 (用于提取模板变量) */
  rawSpecContent?: string
  /** 导出目录 */
  exportDir?: string
}

/**
 * 修复选项
 */
export type RepairOptions = {
  /** 工作目录 */
  cwd: string
  /** 运行 ID */
  runId: string
  /** Spec 路径 (可选，默认修复所有失败的 spec) */
  specPath?: string
  /** 步骤索引 (可选，默认修复所有失败的步骤) */
  stepIndex?: number
  /** 是否重放 (默认: true) */
  replay?: boolean
  /** 是否手动模式 (默认: false) */
  manual?: boolean
  /** 重放时的超时时间 (毫秒) */
  replayTimeout?: number
}

// ============================================================================
// Public API - Results
// ============================================================================

/**
 * 运行结果
 */
export type RunResult =
  | { ok: true; passed: number; failed: number; exports: ExportInfo[] }
  | { ok: false; code: string; message: string; passed?: number; failed?: number; exports?: ExportInfo[] }

/**
 * 导出结果
 */
export type ExportResult =
  | { ok: true; exportPath: string; relativePath: string }
  | {
      ok: false
      reason: string
      missingLocators?: MissingLocatorInfo[]
      suggestRepairMode?: boolean  // 新增：提示可启动修复模式
    }

/**
 * 修复结果
 */
export type RepairResult =
  | { ok: true; repairedCount: number; exportPath: string }
  | { ok: false; code: string; message: string }

/**
 * 缺失 locator 信息
 */
export type MissingLocatorInfo = {
  stepIndex: number
  stepText: string
  toolName: string
}

/**
 * 导出信息
 */
export type ExportInfo = {
  specPath: string
  exportPath: string
  ok: boolean
  reason?: string
}

// ============================================================================
// Public API - State
// ============================================================================

/**
 * 引擎状态
 */
export type EngineState = {
  /** 当前阶段 */
  phase: 'idle' | 'running' | 'paused' | 'repairing' | 'stopped'
  /** 当前运行 ID */
  runId?: string
  /** 当前 Spec 路径 */
  currentSpec?: string
  /** 当前步骤索引 (1-based) */
  currentStep?: number
  /** 总步骤数 */
  totalSteps?: number
  /** 是否有头模式 */
  debug: boolean
  /** 开始时间 */
  startedAt?: number
}

/**
 * 步骤状态
 */
export type StepState = {
  /** 步骤索引 (1-based) */
  index: number
  /** 步骤文本 */
  text: string
  /** 状态 */
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'repaired'
  /** 错误信息 */
  error?: string
  /** 截图路径 */
  screenshot?: string
}

// ============================================================================
// Public API - Events
// ============================================================================

/**
 * 事件类型
 */
export type EngineEventType =
  | 'engine:state'
  | 'run:started'
  | 'run:finished'
  | 'spec:started'
  | 'spec:finished'
  | 'spec:step'
  | 'spec:screenshot'
  | 'export:started'
  | 'export:finished'
  | 'repair:started'
  | 'repair:finished'
  | 'repair:step:selected'
  | 'repair:step:replaying'
  | 'repair:manual:continuing'

/**
 * 事件数据
 */
export type EngineEventData = {
  'engine:state': { state: EngineState }
  'run:started': { runId: string; specCount: number }
  'run:finished': RunResult
  'spec:started': { runId: string; specPath: string }
  'spec:finished': { runId: string; specPath: string; ok: boolean; durationMs: number }
  'spec:step': { runId: string; specPath: string; step: StepState }
  'spec:screenshot': { runId: string; specPath: string; screenshotPath: string }
  'export:started': { runId: string; specPath: string }
  'export:finished': { runId: string; specPath: string; result: ExportResult }
  'repair:started': { runId: string; specPath?: string }
  'repair:finished': { runId: string; result: RepairResult }
  'repair:step:selected': { runId: string; specPath: string; stepIndex: number; locator: string }
  'repair:step:replaying': { runId: string; specPath: string; stepIndex: number }
  'repair:manual:continuing': { runId: string; specPath?: string }
}

/**
 * 事件监听器
 */
export type EngineEventListener<T extends EngineEventType = EngineEventType> = (
  data: EngineEventData[T]
) => void | Promise<void>

// ============================================================================
// Public API - Core Engine
// ============================================================================

/**
 * AutoQA 核心引擎
 *
 * 提供可编程的测试自动化能力，支持：
 * - 运行 Markdown spec
 * - 导出 Playwright Test
 * - 修复模式 (Interactive Repair)
 * - 事件监听
 * - 状态控制
 */
export interface IAutoQAEngine {
  // ========================================================================
  // 信息查询
  // ========================================================================

  /**
   * 获取当前引擎状态
   */
  getState(): EngineState

  /**
   * 检查是否正在运行
   */
  isRunning(): boolean

  /**
   * 检查是否正在修复
   */
  isRepairing(): boolean

  // ========================================================================
  // 运行控制
  // ========================================================================

  /**
   * 运行单个或多个 Specs
   *
   * @param specPaths Spec 文件路径或目录
   * @param options 运行选项
   * @returns 运行结果
   */
  run(specPaths: string | string[], options: RunOptions): Promise<RunResult>

  /**
   * 导出 Playwright Test (使用已有的 IR)
   *
   * @param options 导出选项
   * @returns 导出结果
   */
  export(options: ExportOptions): Promise<ExportResult>

  /**
   * 进入修复模式
   *
   * @param options 修复选项
   * @returns 修复结果
   */
  repair(options: RepairOptions): Promise<RepairResult>

  // ========================================================================
  // 事件监听
  // ========================================================================

  /**
   * 注册事件监听器
   *
   * @param event 事件类型
   * @param listener 监听器
   */
  on<T extends EngineEventType>(
    event: T,
    listener: EngineEventListener<T>
  ): this

  /**
   * 移除事件监听器
   *
   * @param event 事件类型
   * @param listener 监听器
   */
  off<T extends EngineEventType>(
    event: T,
    listener: EngineEventListener<T>
  ): this

  /**
   * 移除所有监听器
   */
  removeAllListeners(): this

  // ========================================================================
  // 状态控制
  // ========================================================================

  /**
   * 暂停执行 (仅在 running 状态下有效)
   */
  pause(): void

  /**
   * 恢复执行
   */
  resume(): void

  /**
   * 停止执行
   */
  stop(): void

  // ========================================================================
  // 浏览器访问 (供 GUI 集成)
  // ========================================================================

  /**
   * 获取当前浏览器实例 (仅供特殊场景使用)
   * 警告: 直接操作浏览器可能影响执行状态
   */
  getBrowser(): Browser | null

  /**
   * 获取当前页面实例 (仅供特殊场景使用)
   * 警告: 直接操作页面可能影响执行状态
   */
  getPage(): Page | null

  // ========================================================================
  // 资源清理
  // ========================================================================

  /**
   * 关闭引擎并释放资源
   */
  close(): Promise<void>
}

// ============================================================================
// Implementation Helper Types
// ============================================================================

/**
 * 步骤执行上下文 (传递给 Agent)
 */
export type StepContext = {
  runId: string
  specPath: string
  stepIndex: number
  stepText: string
  baseUrl: string
  loginBaseUrl?: string
  page: Page
  logger: any // Logger 类型
}

/**
 * IR 重放结果
 */
export type ReplayResult =
  | { ok: true; replayedCount: number; currentStepIndex: number }
  | {
      ok: false
      failedAtStep: number
      error: string
      canContinueManually: boolean
      pageUrl?: string  // 可选：直接导航的 URL
    }

/**
 * 元素选择结果
 */
export type ElementSelection = {
  /** 元素指纹 */
  fingerprint: {
    tagName: string
    id?: string
    className?: string
    text?: string
    role?: string
    name?: string
    type?: string
    placeholder?: string
    ariaLabel?: string
    testId?: string
  }
  /** 生成的 Locator 候选 (按优先级排序) */
  locatorCandidates: Array<{
    priority: number
    code: string
    isUnique: boolean
    matchCount: number
    kind: string
  }>
  /** 推荐的 Locator */
  recommendedLocator?: string
}

/**
 * 修复记录
 */
export type RepairRecord = {
  runId: string
  specPath: string
  stepIndex: number
  stepText: string
  timestamp: number
  repairedAt: string // ISO timestamp
  chosenLocator: {
    kind: string
    value: string
    code: string
    validation: {
      unique: boolean
      visible?: boolean
      enabled?: boolean
    }
    source: 'user_picker' | 'user_manual' | 'manual_entry'
  }
  userConfirmed: boolean
}

/**
 * 修复文件
 */
export type RepairFile = {
  runId: string
  createdAt: string
  updatedAt: string
  repairs: RepairRecord[]
}
