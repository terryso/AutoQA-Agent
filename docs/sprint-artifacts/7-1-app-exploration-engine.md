# Story 7.1: Agent 驱动的应用探索 Session（`autoqa plan explore`）

Status: review

## Story

As a QA 工程师,
I want 使用 `autoqa plan explore` 触发一个由 Agent 驱动的探索 Session,
so that Agent 可以基于页面 snapshot 主动决定去哪儿看、看什么，并沉淀成可复用的应用结构视图。

## Acceptance Criteria

1. **Given** 提供了应用 URL  
   **When** 运行 `autoqa plan explore -u https://example.com -d 3`  
   **Then** 探索过程中的导航/点击/等待等具体动作均由 Agent 通过浏览器工具调用驱动  
   **And** TypeScript 代码仅提供 `navigate/click/fill/scroll/wait/snapshot` 等基础工具，不再硬编码页面特定的探索逻辑  
   **And** 每次 Agent 请求观察页面时，系统都会生成与 `autoqa run` 一致格式的 snapshot（至少包含 screenshot + AX/ARIA snapshot + URL + 标题）

2. **Given** 探索结束  
   **When** 查看 `.autoqa/runs/<runId>/plan-explore/`  
   **Then** 至少包含：  
   - `explore-graph.json`：页面节点 + 导航关系  
   - `explore-elements.json`：每个页面的交互元素清单  
   - `explore-transcript.jsonl`：Agent 探索过程的工具调用与思考摘要  
   **And** 这些产物可作为 Story 7.2 用例生成器的直接输入

3. **Given** 应用需要登录  
   **When** 通过配置或参数提供登录入口与凭据占位符  
   **Then** Agent 应能在探索早期完成登录步骤，并在同一 Browser Context 中继续后续页面探索  
   **And** 登录失败时应以退出码 `1` 结束，并在日志与探索产物中附带 snapshot 与错误说明

## Tasks / Subtasks

- [x] 将现有基于固定遍历策略的探索实现重构为“Agent 驱动 + 工具层封装”的模式（AC: 1）
  - [x] 在 `src/plan/explore.ts` 中抽象出与 Agent 对话的 orchestrator，负责：创建/复用 Browser/Context/Page，提供统一的 snapshot 接口  
  - [x] 复用 `src/browser/snapshot.ts` / `src/agent/pre-action-screenshot.ts` 现有能力，确保 `autoqa run` 与 `autoqa plan explore` 使用相同的 snapshot 结构  
  - [x] 在 `src/agent` 下为 Planner Agent 定义独立的配置（prompt + 工具列表），与执行用 Agent 解耦

- [x] 设计并实现探索产物结构（AC: 2）
  - [x] 扩展或复用 `src/plan/types.ts`，引入 `PlanConfig`、`ExplorationGraph`、`PageNode` 等类型  
  - [x] 在 `src/plan/output.ts` 中增加探索产物写入逻辑，输出到 `.autoqa/runs/<runId>/plan-explore/*`  
  - [x] 确保产物结构可被 Story 7.2 的用例生成器直接消费（无需对产物做大规模转换）

- [x] 登录场景支持重构为 Agent 驱动（AC: 3）
  - [x] 将现有基于 CLI 参数的登录实现，改为通过 Agent 使用统一工具链完成登录步骤  
  - [x] 确保登录失败时有清晰错误与退出码语义（例如退出码 `1` 表示探索失败），并在日志中给出调试信息  
  - [x] 在探索产物与 transcript 中记录登录阶段的关键信息，便于排查登录相关失败

- [x] 日志、Guardrail 与测试（AC: 1, 2, 3）
  - [x] 为探索命令新增/扩展结构化日志事件（如 `autoqa.plan.explore.agent.started/finished/failed`），字段与现有 runner 日志保持对齐  
  - [x] 引入针对探索 Session 的 guardrail（如 `maxAgentTurnsPerRun`、`maxSnapshotsPerRun`），并在触发时给出清晰提示  
  - [x] 更新/新增单元测试与集成测试，覆盖 Agent 驱动探索的 happy path、登录失败、guardrail 触发等场景

## Dev Notes

- 本故事主要覆盖 FR15 中的“自动探索 Web 应用并生成页面/交互结构”部分，是后续 Story 7.2/7.3 的输入来源。  
  - **来源:** [Source: docs/epics.md#Epic-7-Agent-驱动智能测试规划器（基于 snapshot 的自动化测试计划生成）]
- 探索逻辑应尽量收敛到 Agent + 工具接口层，不在 TypeScript 中写死对特定页面/DOM 结构的适配逻辑。  
  - **来源:** [Source: docs/sprint-artifacts/ts-7-agent-based-intelligent-planner.md]
- 需要复用现有架构中的分层与边界约束：CLI 层仅负责参数解析与调用，具体浏览器控制与页面采集逻辑应放在独立模块中。  
  - **来源:** [Source: docs/architecture.md#Structure Patterns（结构与边界规范）]
- 探索产物格式要为后续“智能测试用例生成器”（Story 7.2）与 `autoqa plan` 总体编排（Story 7.3）提供结构化输入，建议在数据模型中显式区分：页面、导航关系、交互元素类型。  
  - **来源:** [Source: docs/epics.md#Story-7.2-Agent-驱动的智能测试用例生成器]

### Project Structure Notes

- 建议在 `src/plan/` 目录下集中实现规划/探索相关逻辑，保持与 `src/runner/`、`src/agent/` 等模块边界清晰。  
  - **来源:** [Source: docs/architecture.md#Project Structure & Boundaries（项目结构与边界）]
- CLI 命令建议在 `src/cli/commands/plan.ts` 中注册 `plan` 相关子命令，并保持与现有 `run` 命令一致的参数解析与错误处理模式。  
  - **来源:** [Source: docs/architecture.md#Naming Patterns（命名规范）]

### References

- [Source: docs/epics.md#Story-7.1-Agent-驱动的应用探索-Session（autoqa-plan-explore）]  
- [Source: docs/epics.md#Epic-7-Agent-驱动智能测试规划器（基于-snapshot-的自动化测试计划生成）]  
- [Source: docs/sprint-artifacts/ts-7-agent-based-intelligent-planner.md]  
- [Source: docs/architecture.md#Core Architectural Decisions（核心架构决策）]  
- [Source: docs/prd.md#Functional Requirements]

## Dev Agent Record

### Agent Model Used

Cascade

### Implementation Plan

按照 Tech Spec (ts-7-agent-based-intelligent-planner.md) 完整重构实现，采用与 `runAgent` 相同的模式：

1. **类型系统重构** (`src/plan/types.ts`)
   - 按 Tech Spec 定义 `PlanConfig`（含 `baseUrl`、`maxDepth`、`guardrails`、`auth`）
   - 实现 `ElementSummary`、`PageNode`、`ExplorationGraph` 等核心类型
   - 新增 `GuardrailConfig`、`GuardrailTrigger`、`TranscriptEntry`、`LoginStatus` 类型

2. **Agent 驱动探索** (`src/plan/explore-agent.ts`) - **核心实现**
   - 调用 `@anthropic-ai/claude-agent-sdk` 的 `query()` 函数
   - 构建探索 Prompt，告诉 Agent 探索目标、登录凭据、深度限制
   - 复用 `createBrowserToolsMcpServer` 提供 navigate/click/fill/snapshot 工具
   - Agent 自主决定如何探索、登录、收集元素
   - 解析 Agent 输出的 JSON 结构化结果

3. **Orchestrator 入口** (`src/plan/explore.ts`)
   - 创建浏览器上下文和页面
   - 委托给 `runExploreAgent` 执行真正的探索
   - 清理浏览器资源

4. **三份产物输出** (`src/plan/output.ts`)
   - `explore-graph.json`：页面节点 + 导航关系
   - `explore-elements.json`：每个页面的交互元素清单
   - `explore-transcript.jsonl`：Agent 工具调用与思考摘要

5. **CLI 命令增强** (`src/cli/commands/plan.ts`)
   - 新增 `--max-pages`、`--max-agent-turns`、`--max-snapshots` guardrail 参数
   - 输出三份产物路径和统计信息

### Debug Log References

- 探索命令日志事件：`autoqa.plan.explore.started`、`autoqa.plan.explore.finished`、`autoqa.plan.explore.failed`
- 登录日志事件：`autoqa.plan.explore.login.started`、`autoqa.plan.explore.login.finished`、`autoqa.plan.explore.login.failed`
- 页面探索日志：`autoqa.plan.explore.page.started`、`autoqa.plan.explore.page.finished`、`autoqa.plan.explore.page.failed`
- Guardrail 日志：`autoqa.guardrail.triggered`
- 产物输出路径：
  - `.autoqa/runs/<runId>/plan-explore/explore-graph.json`
  - `.autoqa/runs/<runId>/plan-explore/explore-elements.json`
  - `.autoqa/runs/<runId>/plan-explore/explore-transcript.jsonl`
- 运行示例：`autoqa plan explore -u https://example.com -d 3 --max-pages 20`

### Completion Notes List

**AC1 - Agent 驱动 + 工具层封装：**
- ✅ 调用 `@anthropic-ai/claude-agent-sdk` 的 `query()` 函数，与 `runAgent` 采用相同模式
- ✅ 复用 `createBrowserToolsMcpServer` 提供 navigate/click/fill/snapshot 等工具
- ✅ 构建探索 Prompt，Agent 自主决定如何探索应用、登录、收集元素
- ✅ TypeScript 代码不再硬编码页面特定逻辑，完全由 Agent 驱动

**AC2 - 探索产物结构：**
- ✅ 输出 `explore-graph.json`：包含 `pages[]` 和 `edges[]`，符合 Tech Spec 的 `ExplorationGraph` 结构
- ✅ 输出 `explore-elements.json`：每个页面的 `elementSummary[]` 和 `forms[]`
- ✅ 输出 `explore-transcript.jsonl`：每行一条 JSON，记录工具调用、结果、页面访问、guardrail 触发等
- ✅ 产物结构可直接被 Story 7.2 用例生成器消费

**AC3 - 登录场景支持：**
- ✅ 登录通过 `PlannerTools` 工具链完成（`openUrl` → `fill` → `click` → `waitForLoadState`）
- ✅ 登录失败时捕获 failure snapshot 并记录到 `LoginStatus.snapshotRef`
- ✅ 登录失败时 `ExplorationResult.error.stage` 设为 `'login'`
- ✅ 登录阶段信息记录到 transcript（`login_attempt` 类型）
- ✅ 退出码语义：登录/探索失败返回 1，参数错误返回 2

**Guardrail 机制：**
- ✅ 实现 `maxAgentTurnsPerRun`、`maxSnapshotsPerRun`、`maxPagesPerRun` guardrail
- ✅ Guardrail 触发时记录 `autoqa.guardrail.triggered` 日志事件
- ✅ Guardrail 触发信息包含在 `ExplorationResult.guardrailTriggered` 和 transcript 中
- ✅ CLI 支持 `--max-pages`、`--max-agent-turns`、`--max-snapshots` 参数

**日志与统计：**
- ✅ `stats.maxDepthReached`：实际探索到的最大深度（非配置值）
- ✅ `stats.configuredDepth`：配置的最大深度
- ✅ 结构化错误信息：`error.message`、`error.stage`、`error.pageUrl`
- ✅ 9 个日志事件类型，与现有 `autoqa run` 日志格式对齐

**测试覆盖：**
- ✅ 39 个单元测试，覆盖类型、输出、探索、CLI 命令
- ✅ 测试场景：正常探索、跳过登录、深度限制、导航失败、登录失败、Guardrail 触发、transcript 记录、三份产物结构验证
- ✅ 所有 391 个测试通过

### File List

**新增文件：**
- `src/plan/types.ts` - 按 Tech Spec 定义的核心类型（PlanConfig、ElementSummary、PageNode、ExplorationGraph、GuardrailConfig 等）
- `src/plan/explore-agent.ts` - **核心实现**：调用 Claude Agent SDK 的 `query()` 函数，构建 Prompt，复用 browser-tools-mcp
- `src/plan/output.ts` - 三份产物输出（explore-graph.json、explore-elements.json、explore-transcript.jsonl）
- `src/plan/explore.ts` - Orchestrator 入口，创建浏览器上下文并委托给 explore-agent
- `src/cli/commands/plan.ts` - plan 命令及 explore 子命令（含 guardrail 参数）
- `tests/unit/plan-types.test.ts` - 类型定义测试（16 个测试）
- `tests/unit/plan-output.test.ts` - 产物输出测试（8 个测试）
- `tests/unit/plan-explore.test.ts` - 探索引擎逻辑测试（8 个测试，mock runExploreAgent）
- `tests/unit/cli-plan-explore.test.ts` - CLI 命令测试（7 个测试）

**修改文件：**
- `src/cli/program.ts` - 注册 plan 命令
- `src/logging/types.ts` - 添加探索相关日志事件类型（含 maxDepthReached/configuredDepth）

### Change Log

- 2025-12-20: 按 Code Review 结果完整重构实现（Story 7.1）
  - **核心改动**：创建 `explore-agent.ts`，调用 `@anthropic-ai/claude-agent-sdk` 的 `query()` 函数
  - 采用与 `runAgent` 相同的模式：构建 Prompt + 提供 MCP 工具 + Agent 自主探索
  - 复用 `createBrowserToolsMcpServer` 提供 navigate/click/fill/snapshot 工具
  - Agent 自主决定如何探索应用、登录、收集元素，TypeScript 不再硬编码逻辑
  - 实现三份产物输出：explore-graph.json、explore-elements.json、explore-transcript.jsonl
  - 实现 Guardrail 机制：maxAgentTurnsPerRun、maxSnapshotsPerRun、maxPagesPerRun
  - 新增 39 个单元测试，所有 391 个测试通过
