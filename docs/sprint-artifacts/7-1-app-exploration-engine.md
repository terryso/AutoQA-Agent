# Story 7.1: Agent 驱动的应用探索 Session（`autoqa plan explore`）

Status: in-progress

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

- [ ] 将现有基于固定遍历策略的探索实现重构为“Agent 驱动 + 工具层封装”的模式（AC: 1）
  - [ ] 在 `src/plan/explore.ts` 中抽象出与 Agent 对话的 orchestrator，负责：创建/复用 Browser/Context/Page，提供统一的 snapshot 接口  
  - [ ] 复用 `src/browser/snapshot.ts` / `src/agent/pre-action-screenshot.ts` 现有能力，确保 `autoqa run` 与 `autoqa plan explore` 使用相同的 snapshot 结构  
  - [ ] 在 `src/agent` 下为 Planner Agent 定义独立的配置（prompt + 工具列表），与执行用 Agent 解耦

- [ ] 设计并实现探索产物结构（AC: 2）
  - [ ] 扩展或复用 `src/plan/types.ts`，引入 `PlanConfig`、`ExplorationGraph`、`PageNode` 等类型  
  - [ ] 在 `src/plan/output.ts` 中增加探索产物写入逻辑，输出到 `.autoqa/runs/<runId>/plan-explore/*`  
  - [ ] 确保产物结构可被 Story 7.2 的用例生成器直接消费（无需对产物做大规模转换）

- [ ] 登录场景支持重构为 Agent 驱动（AC: 3）
  - [ ] 将现有基于 CLI 参数的登录实现，改为通过 Agent 使用统一工具链完成登录步骤  
  - [ ] 确保登录失败时有清晰错误与退出码语义（例如退出码 `1` 表示探索失败），并在日志中给出调试信息  
  - [ ] 在探索产物与 transcript 中记录登录阶段的关键信息，便于排查登录相关失败

- [ ] 日志、Guardrail 与测试（AC: 1, 2, 3）
  - [ ] 为探索命令新增/扩展结构化日志事件（如 `autoqa.plan.explore.agent.started/finished/failed`），字段与现有 runner 日志保持对齐  
  - [ ] 引入针对探索 Session 的 guardrail（如 `maxAgentTurnsPerRun`、`maxSnapshotsPerRun`），并在触发时给出清晰提示  
  - [ ] 更新/新增单元测试与集成测试，覆盖 Agent 驱动探索的 happy path、登录失败、guardrail 触发等场景

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

实现了完整的应用探索引擎，包括：
1. 核心数据模型与类型定义（`src/plan/types.ts`）
2. CLI 命令与参数校验（`src/cli/commands/plan.ts`）
3. 浏览器驱动的探索引擎（`src/plan/explore.ts`）
4. 产物输出管理（`src/plan/output.ts`）
5. 结构化日志事件（扩展 `src/logging/types.ts`）
6. 完整的单元测试覆盖（19个新增测试用例）

### Debug Log References

- 探索命令日志事件：`autoqa.plan.explore.started`、`autoqa.plan.explore.finished`、`autoqa.plan.explore.failed`
- 产物输出路径：`.autoqa/runs/<runId>/plan-explore/explore-result.json`
- 运行示例：`autoqa plan explore -u https://example.com -d 3`

### Completion Notes List

**已实现功能：**
- ✅ 支持通过 `-u/--url` 指定目标 URL，`-d/--depth` 配置探索深度（0-10，默认3）
- ✅ 自动识别页面中的可交互元素（按钮、链接、输入框、文本域、下拉框、表单）
- ✅ 记录页面导航关系（NavigationEdge）和页面结构（PageNode）
- ✅ 支持登录场景（`--login-url`、`--username`、`--password`）
- ✅ 同域链接自动探索，外部链接仅记录不跟随
- ✅ URL 去重与深度限制，避免无限循环
- ✅ 结构化 JSON 产物输出，包含统计信息（页面数、元素数、表单数、链接数）
- ✅ 完整的结构化日志支持，与现有 `autoqa run` 日志格式对齐
- ✅ 错误处理与退出码语义（退出码2表示参数错误，退出码1表示探索失败）

**已知限制：**
- 当前为基础实现，未实现高级策略（如排除模式、限速、JavaScript 重度应用的等待策略）
- 登录流程使用简单的定位器策略，复杂登录页面可能需要自定义
- 大型站点建议设置较小的深度值以避免过度抓取

**为后续 Story 铺垫：**
- 探索结果数据结构已考虑 Story 7.2（测试用例生成器）的需求
- 每个可交互元素包含 `locatorCandidates` 数组，便于生成 Playwright 定位器
- 表单信息包含字段类型、必填属性等元数据，支持自动化表单填写测试生成

### File List

**新增文件：**
- `src/plan/types.ts` - 探索引擎核心类型定义
- `src/plan/output.ts` - 产物输出管理
- `src/plan/explore.ts` - 探索引擎核心实现
- `src/cli/commands/plan.ts` - plan 命令及 explore 子命令
- `tests/unit/plan-types.test.ts` - 类型定义测试
- `tests/unit/plan-output.test.ts` - 产物输出测试
- `tests/unit/plan-explore.test.ts` - 探索引擎逻辑测试
- `tests/unit/cli-plan-explore.test.ts` - CLI 命令测试

**修改文件：**
- `src/cli/program.ts` - 注册 plan 命令
- `src/logging/types.ts` - 添加探索相关日志事件类型

### Change Log

- 2025-12-20: 实现应用探索引擎（Story 7.1）
  - 新增 `autoqa plan explore` 命令，支持自动探索 Web 应用结构
  - 实现页面遍历、元素识别、表单分析、导航关系记录
  - 支持登录场景和深度可配置探索
  - 新增19个单元测试，所有测试通过（371/371）
