# Story 9.4: 保存修复结果并重新导出

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a QA 工程师,
I want 在修复完成后保存修复结果并自动重新导出测试代码,
So that 修复可以被持久化，且不需要手动重新运行整个测试。

## Acceptance Criteria

**Given** 用户在修复模式下成功选择了 locator
**When** 用户确认选择
**Then** 系统应将修复记录保存到 `.autoqa/runs/<runId>/repairs.json`

**Given** repairs.json 已存在且包含修复记录
**When** 重新运行导出流程
**Then** 系统应自动应用 repairs.json 中的修复到 IR 记录
**And** 导出应成功生成 Playwright 测试代码

**Given** 用户选择了 locator 但尚未保存
**When** 用户中断修复模式（Ctrl+C）
**Then** 系统应自动保存已完成的修复记录

**Given** repairs.json 中的修复与 IR 记录合并后
**When** 所有元素操作都有有效的 chosenLocator
**Then** 导出应成功并生成完整的测试文件

**Given** 应用修复后仍有步骤缺少 locator
**When** 运行导出
**Then** 系统应返回失败并建议继续修复模式

## Tasks / Subtasks

- [x] Task 1: 实现 RepairStorage 类 (AC: #1, #3)
  - [x] Subtask 1.1: 创建 `src/repair/storage.ts` 文件
  - [x] Subtask 1.2: 实现 `saveRepair()` 方法，保存单个修复记录
  - [x] Subtask 1.3: 实现 `loadRepairs()` 方法，加载 repairs.json
  - [x] Subtask 1.4: 实现 `getRepair()` 方法，获取特定步骤的修复
  - [x] Subtask 1.5: 实现文件创建和追加逻辑（原子写入）

- [x] Task 2: 实现修复应用逻辑 (AC: #2, #4, #5)
  - [x] Subtask 2.1: 实现 `applyRepairs()` 函数，合并 repairs 到 IR 记录
  - [x] Subtask 2.2: 修改 `exportFromIR()` 调用 `applyRepairs()`
  - [x] Subtask 2.3: 实现应用修复后的重新验证逻辑

- [x] Task 3: 集成到 RepairCoordinator (AC: #1)
  - [x] Subtask 3.1: 在 `RepairCoordinator` 中集成 `RepairStorage`
  - [x] Subtask 3.2: 在用户确认 locator 后调用 `saveRepair()`
  - [x] Subtask 3.3: 实现退出时的自动保存（Ctrl+C 处理）

- [x] Task 4: 实现重新导出触发 (AC: #2, #4)
  - [x] Subtask 4.1: 修复完成后自动触发导出
  - [x] Subtask 4.2: 返回导出结果给用户

- [x] Task 5: 添加类型定义和导出
  - [x] Subtask 5.1: 确认 `src/repair/types.ts` 中 `RepairRecord` 和 `RepairFile` 类型完整
  - [x] Subtask 5.2: 更新 `src/repair/index.ts` 导出 `RepairStorage`

- [x] Task 6: 单元测试
  - [x] Subtask 6.1: 测试 `RepairStorage` 的保存和加载
  - [x] Subtask 6.2: 测试 `applyRepairs()` 函数
  - [x] Subtask 6.3: 测试导出流程集成

## Dev Notes

### 架构上下文

本故事是 Epic 9 的第四个故事，负责实现修复结果的持久化和重新导出功能。前面的故事已建立了：
- Story 9.1: `RepairCoordinator` 协调器框架
- Story 9.2: `IRReplayer` 重放器
- Story 9.3: `ElementPicker` 元素选择器

本故事将完成修复模式的最后一个关键环节：保存修复并重新导出。

**关键集成点：**
- `src/repair/storage.ts`: 新建，负责修复记录的持久化
- `src/repair/coordinator.ts`: 需要集成 `RepairStorage` 保存修复
- `src/runner/export-from-ir.ts`: 需要修改以应用 repairs
- `src/repair/types.ts`: 类型定义（已有 `RepairRecord`, `RepairFile`）

### 现有代码分析

**RepairCoordinator（`src/repair/coordinator.ts`）：**
- `startRepairMode()`: 启动修复模式
- `promptLocatorChoice()`: 获取用户选择
- 需要在用户确认后调用 storage 保存修复

**ExportFromIR（`src/runner/export-from-ir.ts`）：**
- `exportFromIR()`: 当前直接检查 IR 记录
- 需要在检查前先应用 repairs
- 行 906-927: 检查缺失 locator 的逻辑

**类型定义（`src/repair/types.ts` 已有）：**
```typescript
export type RepairRecord = {
  runId: string
  specPath: string
  stepIndex: number
  stepText: string
  timestamp: number
  chosenLocator: LocatorCandidate
  repairedAt: string
  userConfirmed: boolean
}

export type RepairFile = {
  runId: string
  createdAt: string
  updatedAt: string
  repairs: RepairRecord[]
}
```

### 实现约束

1. **分层边界**：
   - `src/repair/storage.ts` 新建文件，负责文件 I/O
   - `exportFromIR` 中新建 `applyRepairs()` 函数处理合并逻辑
   - `RepairCoordinator` 调用 storage 保存修复，不直接操作文件

2. **文件操作规则**：
   - 使用原子写入（先写临时文件再重命名）
   - repairs.json 路径：`.autoqa/runs/<runId>/repairs.json`
   - 文件不存在时自动创建
   - 追加修复时保持原有记录

3. **合并逻辑**：

   | 条件 | 行为 |
   |------|------|
   | repairs.json 中有对应 stepIndex 的修复 | 使用修复中的 chosenLocator |
   | IR 中已有 chosenLocator | 优先使用 IR 中的（修复覆盖 IR） |
   | 两者都没有 | 标记为缺失，建议修复 |

4. **错误处理**：
   - 遵循 `ToolResult` 契约，失败不 throw
   - 文件写入失败应记录错误但不中断流程
   - 无效的 repairs.json 应被忽略（返回空列表）

5. **可观测性**：
   - 使用 pino 日志记录修复保存和应用事件
   - 日志字段包含：`runId`, `specPath`, `stepIndex`, `repairsSaved`, `repairsApplied`

### 项目结构说明

**新增文件：**
```
src/repair/
├── storage.ts           # 修复存储 (新建)
├── coordinator.ts       # 修复模式协调器 (修改: 集成 storage)
├── types.ts             # 修复相关类型定义 (确认完整)
└── index.ts             # 导出 (修改: 导出 storage)

src/runner/
├── apply-repairs.ts     # 修复应用逻辑 (新建)
└── export-from-ir.ts    # 导出逻辑 (修改: 应用 repairs)
```

**修复存储 API（`src/repair/storage.ts` 新建）：**
```typescript
export class RepairStorage {
  constructor(cwd: string, runId: string, logger?: Logger)

  async saveRepair(
    specPath: string,
    stepIndex: number,
    stepText: string,
    chosenLocator: LocatorCandidate
  ): Promise<void>

  async loadRepairs(specPath?: string): Promise<RepairRecord[]>

  async getRepair(
    specPath: string,
    stepIndex: number
  ): Promise<RepairRecord | null>
}
```

**导出集成（`src/runner/export-from-ir.ts` 修改）：**
```typescript
// 新增函数
function applyRepairs(
  records: ActionRecord[],
  repairs: RepairRecord[]
): ActionRecord[]

async function loadRepairsForSpec(
  cwd: string,
  runId: string,
  specPath: string
): Promise<RepairRecord[]>

// 修改 exportFromIR 函数
export async function exportFromIR(options: ExportOptions): Promise<ExportResult> {
  // ... 现有代码 ...

  // 新增：加载 repairs
  const repairs = await loadRepairsForSpec(cwd, runId, specPath)

  // 新增：应用 repairs
  const repairedRecords = applyRepairs(records, repairs)

  // 检查缺失 locator（使用 repairedRecords）
  const missingLocatorActions = repairedRecords.filter(/* ... */)

  // ...
}
```

### 技术栈

- TypeScript 5.9.3
- Node.js fs/promises（文件操作）
- Pino 10.1.0（日志）

### 测试标准

- 单元测试：`tests/unit/repair/storage.test.ts`（新建）
- 测试保存、加载修复记录
- 测试原子写入
- 测试文件不存在时的创建
- 测试 `applyRepairs()` 函数的各种场景
- Mock fs 操作

### 参考

- Tech Spec: [Source: docs/sprint-artifacts/epic-9-interactive-repair-mode.md]
- Story 9.1: [Source: docs/sprint-artifacts/9-1-export-failure-auto-start-repair-mode.md]
- Story 9.2: [Source: docs/sprint-artifacts/9-2-ir-replay-to-failed-step.md]
- Story 9.3: [Source: docs/sprint-artifacts/9-3-interactive-element-picker.md]
- IR 类型: [Source: src/ir/types.ts]
- 修复类型: [Source: src/repair/types.ts]
- 导出逻辑: [Source: src/runner/export-from-ir.ts]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

### Completion Notes List

- ✅ 实现了 `RepairStorage` 类，包含 `saveRepair()`, `loadRepairs()`, `getRepair()` 方法
- ✅ 使用原子写入（临时文件 + 重命名）确保数据完整性，失败时自动清理临时文件
- ✅ 实现了 `applyRepairs()` 函数，将 repairs 合并到 IR 记录
- ✅ 在 `exportFromIR()` 中集成了 repairs 加载和应用逻辑
- ✅ 在 `RepairCoordinator` 中集成了 `RepairStorage`，添加了 `saveRepair()` 和 `getRepairsSavedCount()` 方法
- ✅ 实现了 `setupSignalHandler()` 方法处理 SIGINT/SIGTERM 信号（Ctrl+C）
- ✅ 实现了 `finishRepairMode()` 方法自动触发导出并返回结果
- ✅ 扩展了 `RepairModeResult` 类型，包含 `exportResult` 字段
- ✅ 添加了 `loadRepairsForSpec()` 辅助函数用于导出流程
- ✅ 完整的单元测试覆盖（22 个测试全部通过）
- ✅ 所有 766 个测试通过，无回归

### File List
**本故事核心文件：**
- src/repair/storage.ts (new)
- src/runner/apply-repairs.ts (new)
- src/repair/coordinator.ts (modified: added RepairStorage integration, saveRepair method, getRepairsSavedCount method, setupSignalHandler, finishRepairMode)
- src/repair/types.ts (modified: added ExportAfterRepairResult type, updated RepairModeResult)
- src/repair/index.ts (modified: export storage)
- src/runner/export-from-ir.ts (modified: integrate applyRepairs)
- tests/unit/repair/storage.test.ts (new)
- tests/unit/repair/apply-repairs.test.ts (new)

**辅助文件（支持 repair mode 建议）：**
- src/cli/commands/run.ts (modified: added repair mode suggestion output)
- src/logging/types.ts (modified: added repair event types: repairModeStarted, repairModeStopped, repairRecordSaved, repairsApplied, exportAfterRepairFailed, exportAfterRepairSuccess)
- src/logging/index.ts (modified: export 14 new repair event types)
- src/runner/run-specs.ts (modified: added suggestRepairMode field to SpecResult)

**Epic 9 前序故事文件（参考）：**
- docs/sprint-artifacts/9-1-export-failure-auto-start-repair-mode.md (reference)
- docs/sprint-artifacts/9-2-ir-replay-to-failed-step.md (reference)
- docs/sprint-artifacts/9-3-interactive-element-picker.md (reference)
