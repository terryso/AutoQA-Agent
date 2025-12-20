# Story 7.3: `autoqa plan` 命令编排（探索 + 规划 + 用例生成）

Status: review

## Story

As a QA 工程师,
I want 使用 `autoqa plan` 命令一键完成“探索 + 规划 + 用例生成”,
so that 我可以在不同项目上快速得到可直接执行的测试计划。

## Acceptance Criteria

1. **Given** 需要为应用生成测试计划  
   **When** 运行 `autoqa plan -u https://example.com`  
   **Then** CLI 应按顺序触发：  
   - Story 7.1 定义的 Agent 探索 Session  
   - Story 7.2 定义的用例生成流程  
   **And** 运行结束后在 `.autoqa/runs/<runId>/plan/` 下产生探索产物、规划产物与生成的 Markdown specs

2. **Given** 存在 `autoqa.config.json` 中的 `plan` 配置段  
   **When** 运行 `autoqa plan`  
   **Then** CLI 应从配置中读取基础参数（如 `baseUrl`、`maxDepth`、test types 等），并传递给 orchestrator 与 Planner Agent  
   **And** 日志中有清晰的阶段划分（explore/generate），便于排障与性能分析

3. **Given** 探索或生成过程中触发 guardrail（如 `maxAgentTurnsPerRun`、`maxSnapshotsPerRun` 或等效配置）  
   **When** 本次 `autoqa plan` 结束  
   **Then** 应以退出码 `1` 结束（表示规划不完整），并在总结产物（如 `plan-summary.json`）中标记被 guardrail 截断的原因

4. **Given** 用户仅想执行探索或仅想执行用例生成  
   **When** 分别运行 `autoqa plan explore ...` 或未来的 `autoqa plan generate ...`（或等效子命令）  
   **Then** CLI 应只执行对应阶段，但仍复用同一 orchestrator 与产物布局约定

## Tasks / Subtasks

- [x] 实现 `autoqa plan` 顶层命令（AC: 1, 2, 3）  
  - [x] 在 `src/cli/commands/plan.ts` 中扩展现有命令，增加默认子流程编排逻辑  
  - [x] 解析 `-u/--url`、`--env`、`--config` 等参数，并与 `autoqa.config.json` 中的 `plan` 段合并  
  - [x] 约定退出码语义：`0=规划成功`、`1=运行时失败或被 guardrail 截断`、`2=参数/配置错误`

- [x] 编排 orchestrator 调用（AC: 1, 2, 4）  
  - [x] 在 `src/plan/orchestrator.ts` 中提供单一入口（如 `runPlan(config)`），内部依次调用探索与生成  
  - [x] 支持仅执行探索或仅执行生成的模式，供子命令/后续扩展使用  
  - [x] 在 orchestrator 内集中管理 runId 与产物输出位置

- [x] 总结产物与日志（AC: 1, 2, 3）  
  - [x] 设计并实现 `plan-summary.json` 结构，记录：页数、用例数、覆盖的测试类型、guardrail 是否触发等  
  - [x] 扩展 `src/logging/types.ts`，增加 `autoqa.plan.started/finished/failed` 等事件，并在 CLI 中打印关键信息  
  - [x] 确保日志与现有 `autoqa.run` 日志格式对齐，方便统一收集与分析

## Dev Notes

- 本故事聚焦 CLI 与 orchestrator 层面的编排，不重新定义探索或用例生成本身的算法。  
  - **来源:** [Source: docs/epics.md#Story-7.3-autoqa-plan-命令编排（探索-规划-用例生成）]
- `autoqa plan` 的执行模型应尽量与 `autoqa run` 一致（单进程、按 runId 管理产物），以降低用户心智成本。  
  - **来源:** [Source: docs/sprint-artifacts/ts-7-agent-based-intelligent-planner.md]
- 配置合并与优先级策略（命令行 > 配置文件 > 默认值）需要在 tech-spec 中有明确约定，并在实现中集中处理。  
  - **来源:** [Source: docs/epics.md#Story-7.4-配置化探索与生成策略]

### Project Structure Notes

- CLI 命令仍位于 `src/cli/commands/plan.ts`，仅负责参数解析与调用 orchestrator。  
  - **来源:** [Source: docs/architecture.md#Project Structure & Boundaries（项目结构与边界）]
- 规划编排逻辑集中在 `src/plan/orchestrator.ts`，不得在 CLI 层直接操作 Playwright 或 Agent SDK。  
  - **来源:** [Source: docs/architecture.md#Core Architectural Decisions（核心架构决策）]

### References

- [Source: docs/epics.md#Story-7.3-autoqa-plan-命令编排（探索-规划-用例生成）]  
- [Source: docs/epics.md#Epic-7-Agent-驱动智能测试规划器（基于-snapshot-的自动化测试计划生成）]  
- [Source: docs/sprint-artifacts/ts-7-agent-based-intelligent-planner.md]  
- [Source: docs/architecture.md#Core Architectural Decisions（核心架构决策）]  
- [Source: docs/prd.md#Functional Requirements]

## Dev Agent Record

### Agent Model Used

Cascade

### Implementation Plan

1. **扩展配置 schema** (src/config/schema.ts)
   - 添加 `planConfigSchema` 和 `planGuardrailsSchema`
   - 在 `autoqaConfigSchema` 中添加可选的 `plan` 字段
   - 支持从配置文件读取 baseUrl、maxDepth、testTypes、guardrails 等参数

2. **增强 CLI 命令** (src/cli/commands/plan.ts)
   - 实现 `mergeConfigWithOptions` 函数，合并配置文件和命令行参数
   - 优先级：命令行 > 配置文件 > 默认值
   - 为所有子命令添加配置读取和合并逻辑
   - 实现退出码语义：0=成功、1=运行时失败/guardrail、2=配置错误

3. **实现 orchestrator 统一入口** (src/plan/orchestrator.ts)
   - 添加 `runPlan` 函数，支持 full/explore-only/generate-only 模式
   - 集中管理 runId 和产物输出位置
   - 统一日志事件发送（autoqa.plan.started/finished/failed）

4. **实现总结产物** (src/plan/output.ts)
   - 添加 `PlanSummary` 类型定义
   - 实现 `writePlanSummary` 函数
   - 记录探索统计、测试用例数量、测试类型分布、优先级分布
   - 记录 guardrail 触发信息和退出码

5. **扩展日志事件** (src/logging/types.ts)
   - 添加 `PlanStartedEvent`、`PlanFinishedEvent`、`PlanFailedEvent`
   - 添加 `PlanGenerateFailedEvent`
   - 确保与现有日志格式一致

### Debug Log References

- 所有测试通过（24 个单元测试）
- 配置 schema 验证正常
- 日志事件类型定义完整

### Completion Notes List

- ✅ 实现了配置文件与命令行参数的合并逻辑，优先级为：命令行 > 配置文件 > 默认值
- ✅ 扩展了 autoqa.config.json schema 以支持 plan 配置段
- ✅ 实现了 runPlan 统一入口函数，支持 full/explore-only/generate-only 三种模式
- ✅ 实现了 plan-summary.json 产物，包含探索统计、测试用例分布、guardrail 信息
- ✅ 添加了完整的日志事件类型（autoqa.plan.started/finished/failed/generate.failed）
- ✅ 实现了退出码语义：0=成功、1=运行时失败或 guardrail 触发、2=配置错误
- ✅ 编写了 24 个单元测试，覆盖配置合并、orchestrator 模式、总结产物结构、schema 验证
- ✅ 所有测试通过，代码质量良好

### File List

- src/config/schema.ts (修改)
- src/cli/commands/plan.ts (修改)
- src/plan/orchestrator.ts (修改)
- src/plan/output.ts (修改)
- src/logging/types.ts (修改)
- tests/unit/cli-plan-config-merge.test.ts (新增)
- tests/unit/plan-orchestrator.test.ts (新增)
- tests/unit/plan-summary.test.ts (新增)
- tests/unit/config-schema-plan.test.ts (新增)

### Change Log

- 2025-12-20: 初始创建 Story 7.3 文档（`autoqa plan` 命令编排），尚未实现
- 2025-12-21: 完成 Story 7.3 实现
  - 扩展配置 schema 支持 plan 配置段
  - 实现配置文件与命令行参数合并逻辑
  - 实现 runPlan 统一入口函数，支持多种模式
  - 实现 plan-summary.json 总结产物
  - 添加完整的日志事件类型
  - 实现退出码语义
  - 编写并通过 24 个单元测试
