# Story 9.1: 导出失败时自动启动交互式修复模式

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a QA 工程师,
I want 当 `autoqa run` 导出失败时，系统自动启动交互式修复模式而不是直接报错退出,
So that 我可以在不重启的情况下直接修复失败的 locator，而不是手动修改代码或重新运行整个测试。

## Acceptance Criteria

**Given** `autoqa run` 执行完成但导出失败（由于某些步骤缺少 `chosenLocator`）
**When** 系统检测到导出失败
**Then** 应自动启动交互式修复模式（而非直接报错退出）
**And** 应输出清晰的提示说明进入修复模式

**Given** 进入交互式修复模式
**When** 用户确认启动修复
**Then** 系统应启动一个有头浏览器（`headless: false`）
**And** 应读取 IR 文件中失败的步骤信息

## Tasks / Subtasks

- [x] Task 1: 在导出失败检测逻辑中添加交互式修复模式触发 (AC: #1, #2)
  - [x] Subtask 1.1: 修改 `export-from-ir.ts` 的 `ExportResult` 类型，添加 `suggestRepairMode: boolean` 字段
  - [x] Subtask 1.2: 在 `run-specs.ts` 中检测导出失败并判断是否需要进入修复模式
  - [x] Subtask 1.3: 添加用户确认提示逻辑（是否启动修复模式）
- [x] Task 2: 实现 `RepairCoordinator` 核心类 (AC: #3, #4)
  - [x] Subtask 2.1: 创建 `src/repair/coordinator.ts` 文件
  - [x] Subtask 2.2: 实现 `startRepairMode()` 方法，启动有头浏览器
  - [x] Subtask 2.3: 实现读取失败步骤信息的逻辑（从 IR 读取）
- [x] Task 3: 添加 CLI 命令集成 (AC: #2)
  - [x] Subtask 3.1: 修改 `src/cli/commands/run.ts` 调用 RepairCoordinator
  - [x] Subtask 3.2: 添加修复模式启动的日志输出
- [x] Task 4: 添加修复模式基础数据结构
  - [x] Subtask 4.1: 创建 `src/repair/types.ts` 定义修复相关类型
  - [x] Subtask 4.2: 添加 `repairs.json` 文件结构定义

## Dev Notes

### 架构上下文

本故事是 Epic 9 的第一个故事，负责建立交互式修复模式的基础框架。核心是在导出失败时自动触发修复流程，而不是让用户手动修改代码或重新运行。

**关键集成点：**
- `src/runner/export-from-ir.ts`: 导出失败检测点，需要返回 `suggestRepairMode` 标志
- `src/runner/run-specs.ts`: 主流程控制，需要处理导出失败并触发修复模式
- `src/ir/types.ts`: IR 类型定义（已有 `ActionRecord`, `LocatorCandidate`）
- `src/browser/create-browser.ts`: 浏览器创建（需要支持有头模式）

### 现有代码分析

**导出流程（`src/runner/export-from-ir.ts`）：**
- `exportFromIR()` 函数在缺少 `chosenLocator` 时返回 `ExportFailure`
- 当前返回 `{ ok: false, reason: "...", missingLocators: [...] }`
- 需要添加 `suggestRepairMode: true` 字段

**IR 读取（`src/runner/ir-reader.ts`）：**
- `getSpecActionRecords()` 读取 IR 记录
- `getMissingLocatorActions()` 检测缺少 locator 的操作
- 这些可以直接用于修复模式

**浏览器创建（`src/browser/create-browser.ts`）：**
- 当前支持 `headless` 参数
- 修复模式需要强制 `headless: false`

### 实现约束

1. **分层边界**：
   - `src/repair/` 新建目录，负责修复模式核心逻辑
   - CLI 层（`src/cli/commands/run.ts`）负责触发和用户交互
   - 不在 `export-from-ir.ts` 中直接实现修复逻辑（违反单一职责）

2. **错误处理**：
   - 遵循 `ToolResult` 契约，失败不 throw
   - 修复模式启动失败应给出清晰错误信息

3. **可观测性**：
   - 使用 pino 日志记录修复模式事件
   - 日志字段包含：`runId`, `specPath`, `repairMode`

### 项目结构说明

**新增文件：**
```
src/repair/
├── coordinator.ts      # 修复模式协调器
├── types.ts            # 修复相关类型定义
└── index.ts            # 导出
```

**修改文件：**
```
src/runner/
├── export-from-ir.ts   # 添加 suggestRepairMode 字段
└── run-specs.ts        # 添加修复模式触发逻辑

src/cli/commands/
└── run.ts              # 添加修复模式用户交互
```

### 技术栈

- TypeScript 5.9.3
- Playwright 1.57.0（浏览器自动化）
- Pino 10.1.0（日志）
- Zod 3.24.1（类型校验）

### 测试标准

- 单元测试：`tests/unit/repair/` 目录
- 测试修复模式触发条件判断
- 测试 ExportResult 类型扩展
- Mock 浏览器创建和用户交互

### 参考

- Tech Spec: [Source: docs/sprint-artifacts/epic-9-interactive-repair-mode.md]
- 导出流程: [Source: src/runner/export-from-ir.ts]
- IR 类型: [Source: src/ir/types.ts]
- Epic 9 故事定义: [Source: docs/epics.md#Epic 9]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

### Completion Notes List

- 实现了 ExportResult 类型扩展，添加 `suggestRepairMode` 字段
- 创建了 RepairCoordinator 协调器类，实现了有头浏览器启动和从 IR 读取失败步骤
- 在 CLI 中添加了导出失败时的修复模式提示
- 修复了代码审查中发现的 HIGH 和 MEDIUM 问题：
  - 实现了实际的浏览器启动（HIGH-1）
  - 修改了无效的命令提示（HIGH-3）
  - 添加了 coordinator 的单元测试（MEDIUM-2）
- 所有测试通过（693 tests passed）
- 构建成功，无 TypeScript 错误

### File List
- src/repair/coordinator.ts (new)
- src/repair/types.ts (new)
- src/repair/index.ts (new)
- src/runner/export-from-ir.ts (modified: added suggestRepairMode field)
- src/runner/run-specs.ts (modified: added suggestRepairMode to SpecExportInfo)
- src/cli/commands/run.ts (modified: added repair mode prompt)
- tests/unit/repair/types.test.ts (new)

## Senior Developer Review (AI)

### Review Findings
- **HIGH-1** ✅ FIXED: 实现了实际的有头浏览器启动逻辑
- **HIGH-2** ✅ FIXED: AC #3 和 AC #4 现已完全实现
- **HIGH-3** ✅ FIXED: 移除了无效的 `autoqa repair` 命令提示，改为通用提示
- **MEDIUM-2** ✅ FIXED: 添加了 coordinator 相关函数的单元测试（16 tests passed）
