# Story 9.2: 自动重放 IR 到失败步骤

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a QA 工程师,
I want 修复模式自动重放 IR 中成功的步骤到失败点,
So that 我可以在正确的页面状态下进行修复，而不需要手动登录或导航到目标页面。

## Acceptance Criteria

**Given** IR 中有步骤 1-5 成功（有 `chosenLocator`），步骤 6 失败（缺少 `chosenLocator`）
**When** 启动修复模式
**Then** 系统应自动执行步骤 1-5 到达步骤 6 的前置状态
**And** 执行应使用 IR 中记录的 `chosenLocator` 或 `toolInput`

**Given** 某个步骤在重放时失败（例如页面结构变化导致 locator 失效）
**When** 重放无法继续
**Then** 系统应暂停并提示用户手动操作到目标状态
**And** 应显示失败的步骤信息和建议

**Given** IR 中从第一个步骤就缺少 `chosenLocator`
**When** 启动修复模式
**Then** 系统应尝试使用 IR 中记录的 `pageUrl` 直接导航到失败页面
**And** 应提示用户可能需要手动登录或准备状态

## Tasks / Subtasks

- [x] Task 1: 实现 `IRReplayer` 核心类 (AC: #1, #3)
  - [x] Subtask 1.1: 创建 `src/repair/replayer.ts` 文件
  - [x] Subtask 1.2: 实现 `replayToStep()` 方法，重放到目标步骤
  - [x] Subtask 1.3: 实现按工具类型分发重放逻辑（navigate/click/fill/wait）
  - [x] Subtask 1.4: 实现首个步骤失败时的 pageUrl 回退导航

- [x] Task 2: 实现重放失败处理 (AC: #2)
  - [x] Subtask 2.1: 添加重放失败检测逻辑
  - [x] Subtask 2.2: 实现失败后的用户提示逻辑
  - [x] Subtask 2.3: 返回可继续手动操作的标志

- [x] Task 3: 集成到 RepairCoordinator (AC: #1)
  - [x] Subtask 3.1: 修改 `RepairCoordinator` 在启动修复模式后调用 replayer
  - [x] Subtask 3.2: 传递失败步骤索引到 replayer

- [x] Task 4: 添加重放相关类型定义
  - [x] Subtask 4.1: 在 `src/repair/types.ts` 中添加 `ReplayResult` 类型
  - [x] Subtask 4.2: 添加 `ReplayFailureReason` 枚举

## Dev Notes

### 架构上下文

本故事是 Epic 9 的第二个故事，负责实现 IR 重放功能。Story 9.1 已建立了 `RepairCoordinator` 基础，本故事在此基础上添加重放能力，使用户能在正确的页面状态下进行修复。

**关键集成点：**
- `src/repair/coordinator.ts`: 需要调用 IRReplayer 完成重放
- `src/runner/ir-reader.ts`: 读取 IR 记录的现有功能
- `src/ir/types.ts`: IR 类型定义（`ActionRecord`, `chosenLocator`）
- `src/browser/create-browser.ts`: 浏览器创建（已有）

### 现有代码分析

**IR 读取（`src/runner/ir-reader.ts`）：**
- `getSpecActionRecords()` 读取 IR 记录
- `hasValidChosenLocator()` 检测是否有有效 locator
- 这些可用于判断哪些步骤可以重放

**IR 类型（`src/ir/types.ts`）：**
- `ActionRecord`: 包含 `toolName`, `toolInput`, `outcome`, `pageUrl`, `element`, `chosenLocator`
- `IRToolName`: navigate, click, fill, select_option, scroll, wait, assertTextPresent, assertElementVisible
- `chosenLocator`: 已验证的 locator 候选

**RepairCoordinator（`src/repair/coordinator.ts`）：**
- `startRepairMode()`: 启动有头浏览器
- `getFailedSteps()`: 获取失败步骤列表
- 需要在启动浏览器后调用 replayer

### 实现约束

1. **分层边界**：
   - `src/repair/replayer.ts` 新建文件，负责重放逻辑
   - `RepairCoordinator` 负责编排，不直接实现重放细节
   - 重放失败不应 throw，应返回错误结果

2. **重放规则**（来自 Epic 9 Tech Spec）：

   | 条件 | 行为 |
   |------|------|
   | 步骤有 `chosenLocator` | 使用 locator 重放 |
   | 步骤是 `navigate` | 使用 IR 中的 url 重放 |
   | 步骤是 `wait` | 使用 IR 中的 seconds 重放 |
   | 步骤缺少 `chosenLocator` 且 < targetStep | 尝试自动重放，失败则停止 |
   | 步骤缺少 `chosenLocator` 且 >= targetStep | 停止，这是需要修复的步骤 |

3. **错误处理**：
   - 遵循 `ToolResult` 契约，失败不 throw
   - 重放失败应返回 `ReplayResult` 包含失败原因和建议

4. **可观测性**：
   - 使用 pino 日志记录重放事件
   - 日志字段包含：`runId`, `specPath`, `replayedCount`, `failedAtStep`

### 项目结构说明

**新增文件：**
```
src/repair/
├── replayer.ts          # IR 重放器 (新建)
├── coordinator.ts       # 修复模式协调器 (修改: 集成 replayer)
├── types.ts             # 修复相关类型定义 (修改: 添加 ReplayResult)
└── index.ts             # 导出 (修改: 导出 replayer)
```

**类型定义（`src/repair/types.ts` 新增）：**
```typescript
/**
 * Result of replaying IR to a target step.
 */
export type ReplayResult =
  | {
      ok: true
      replayedCount: number
      currentStepIndex: number
    }
  | {
      ok: false
      replayedCount: number
      failedAtStep: number
      error: string
      canContinueManually: boolean
      reason: ReplayFailureReason
    }

/**
 * Reasons for replay failure.
 */
export type ReplayFailureReason =
  | 'locator_not_found'
  | 'locator_not_unique'
  | 'navigation_failed'
  | 'timeout'
  | 'unexpected_page_state'
  | 'no_chosen_locator'
```

### 技术栈

- TypeScript 5.9.3
- Playwright 1.57.0（浏览器自动化）
- Pino 10.1.0（日志）

### 测试标准

- 单元测试：`tests/unit/repair/replayer.test.ts` 目录
- 测试重放逻辑的各种场景
- Mock 浏览器和 page 对象
- 测试首个步骤失败时的回退逻辑

### 参考

- Tech Spec: [Source: docs/sprint-artifacts/epic-9-interactive-repair-mode.md]
- Story 9.1: [Source: docs/sprint-artifacts/9-1-export-failure-auto-start-repair-mode.md]
- IR 类型: [Source: src/ir/types.ts]
- Epic 9 故事定义: [Source: docs/epics.md#Epic 9]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

### Completion Notes List

- 实现了 `IRReplayer` 核心类 `replayToStep()` 函数，支持重放 IR 到目标步骤
- 支持重放所有工具类型：navigate, click, fill, select_option, scroll, wait, assertElementVisible
- 实现了首个步骤失败时的 pageUrl 回退导航
- 实现了重放失败检测和用户提示逻辑，返回可继续手动操作的标志
- 在 `RepairCoordinator` 中集成 replayer，在启动修复模式后自动调用
- 添加了 `ReplayResult` 和 `ReplayFailureReason` 类型定义
- 实现了智能 locator 代码解析，支持 locator(), getByRole(), getByTestId(), getByPlaceholder(), getByLabel(), getByText()
- 所有测试通过（708 tests passed）

### File List
- src/repair/replayer.ts (new)
- src/repair/coordinator.ts (modified: integrated replayer)
- src/repair/types.ts (modified: added ReplayResult, ReplayFailureReason, ReplayOptions)
- src/repair/index.ts (modified: export replayer)
- tests/unit/repair/replayer.test.ts (new)
