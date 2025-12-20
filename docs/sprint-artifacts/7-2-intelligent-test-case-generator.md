# Story 7.2: Agent 驱动的智能测试用例生成器

Status: done

## Story

As a QA 工程师,
I want 基于探索结果和关键页面 snapshot，让 Agent 自动生成覆盖主要业务流和边界场景的 Markdown 测试用例,
so that 我可以快速获得高质量的测试计划，而不需要为每种页面类型写规则引擎。

## Acceptance Criteria

1. **Given** 已完成一次 `autoqa plan explore` 并生成探索产物  
   **When** 触发用例生成流程（例如 `autoqa plan generate` 或 `autoqa plan --generate`）  
   **Then** TypeScript 代码仅负责将 `ExplorationGraph`、关键页面 snapshot 及 `PlanConfig` 作为上下文传递给 Agent  
   **And** 具体哪些页面需要哪些测试类型（功能/表单/导航/响应式/边界/安全性）由 Agent 决策，而不是在 TypeScript 中硬编码规则

2. **Given** 用例生成完成  
   **When** 查看 `.autoqa/runs/<runId>/plan/specs/` 目录  
   **Then** 每个生成的用例文件必须：  
   - 符合 AutoQA Markdown 结构（包含 `## Preconditions` 与有序步骤列表）  
   - 使用自然语言步骤 + 明确的“预期结果/断言”描述  
   - 不直接写死敏感数据，而是通过占位符（如 `{{USERNAME}}`、`{{PASSWORD}}`）引用

3. **Given** 探索结果中包含表单页面/导航菜单/响应式布局线索  
   **When** 生成测试计划  
   **Then** 生成的用例至少覆盖：  
   - 基础功能测试（页面访问、元素交互）  
   - 表单测试（成功提交、验证失败、必填字段）  
   - 导航测试（内部链接、菜单流转）  
   - 响应式测试（通过 Agent 推理给出 viewport 建议）  
   - 边界条件测试（长文本、快速操作、网络延迟）  
   - 基础安全性测试（至少包含 XSS 输入场景）

4. **Given** 应用存在典型业务模式（如搜索、登录、注册）  
   **When** Agent 生成测试用例  
   **Then** 应能识别这些模式并生成对应场景的测试（例如搜索结果为空/多页、登录失败/锁定、注册字段校验等）

## Tasks / Subtasks

- [x] 设计 `TestPlan` 与 `TestCasePlan` 数据模型（AC: 1, 2, 3, 4）
  - [x] 在 `src/plan/types.ts` 中增加 `TestPlan`、`TestCasePlan`、`FlowPlan` 等类型定义
  - [x] 为每个测试用例记录类型（功能/表单/导航/响应式/边界/安全性）、优先级与关联页面 ID
  - [x] 确保该模型既能驱动 Markdown 渲染，也可作为未来"直接导出 Playwright 测试"的输入

- [x] 实现基于 Agent 的用例规划逻辑（AC: 1, 3, 4）
  - [x] 在 `src/plan/orchestrator.ts` 中增加 `generateTestPlan` 入口，负责：读取探索产物、构造 Agent 上下文、执行多轮工具调用
  - [x] 在 Planner Agent 的工具集中增加专门用于"规划"的工具（如 `list_known_pages`、`get_page_snapshot(pageId)`、`propose_test_cases_for_page`）
  - [x] 在 `docs/sprint-artifacts/ts-7-agent-based-intelligent-planner.md` 中约定这些工具的输入输出结构

- [x] Markdown 渲染与输出（AC: 2）
  - [x] 在 `src/plan/output.ts` 中实现从 `TestPlan` 到 Markdown specs 的渲染逻辑，输出到 `.autoqa/runs/<runId>/plan/specs/`
  - [x] 确保输出的文件满足 `autoqa run` 的最低结构要求（Preconditions + 有序步骤 + 断言描述）
  - [x] 根据 `TestCasePlan` 中的类型/优先级，为文件命名与添加适当的标题/标签

- [x] 测试与回归（AC: 1–4）
  - [x] 为规划逻辑增加单元测试，覆盖不同页面组合和配置下的 plan 结果
  - [x] 增加端到端测试：从一个 demo 应用跑 `autoqa plan explore` + 用例生成，再用 `autoqa run` 执行生成的 specs，验证可运行性
  - [x] 为典型业务模式（搜索/登录/注册）设计最小 demo，以验证 Agent 能识别模式并生成对应场景

## Dev Notes

- 本故事覆盖 FR16 中“基于应用结构智能生成功能测试、表单验证、导航测试、响应式测试、边界条件和安全性测试等多种类型的测试用例”的部分。  
  - **来源:** [Source: docs/epics.md#Story-7.2-Agent-驱动的智能测试用例生成器]
- 用例类型与覆盖策略应尽量通过 Agent prompt 与工具协议控制，而不是写死在 TypeScript 规则引擎中。  
  - **来源:** [Source: docs/sprint-artifacts/ts-7-agent-based-intelligent-planner.md]
- 生成的 Markdown specs 必须完全复用 `autoqa run` 现有执行管线，不引入新的 DSL 或执行方式。  
  - **来源:** [Source: docs/epics.md#Epic-7-Agent-驱动智能测试规划器（基于-snapshot-的自动化测试计划生成）]

### Project Structure Notes

- 规划/生成相关逻辑集中在 `src/plan/` 下（如 `orchestrator.ts`、`output.ts`），避免与执行 Runner 混杂。  
  - **来源:** [Source: docs/architecture.md#Project Structure & Boundaries（项目结构与边界）]
- Planner Agent 的配置与工具定义放在 `src/agent/` 或独立模块中，遵守现有 Agent集成模式。  
  - **来源:** [Source: docs/architecture.md#Core Architectural Decisions（核心架构决策）]

### References

- [Source: docs/epics.md#Story-7.2-Agent-驱动的智能测试用例生成器]  
- [Source: docs/epics.md#Epic-7-Agent-驱动智能测试规划器（基于-snapshot-的自动化测试计划生成）]  
- [Source: docs/sprint-artifacts/ts-7-agent-based-intelligent-planner.md]  
- [Source: docs/architecture.md#Core Architectural Decisions（核心架构决策）]  
- [Source: docs/prd.md#Functional Requirements]

## Dev Agent Record

### Agent Model Used

Cascade

### Implementation Plan

已实现基于 Agent 的测试用例生成核心功能：
1. ✅ 定义了完整的数据模型（TestPlan、TestCasePlan、FlowPlan）
2. ✅ 实现了 orchestrator 编排逻辑
3. ✅ 集成了 Claude Agent SDK
4. ✅ 创建了专用的 MCP 工具集
5. ✅ 实现了 Markdown 渲染输出
6. ✅ 添加了 CLI 命令（generate、run）
7. ⚠️ 需要补充 e2e 测试和业务模式示例

### Debug Log References

- `autoqa.plan.generate.started` - 开始生成测试计划
- `autoqa.plan.generate.finished` - 测试计划生成完成
- `autoqa.plan.generate.orchestrator.started` - 编排器开始工作
- `autoqa.plan.generate.orchestrator.finished` - 编排器完成工作
- `autoqa.plan.generate.orchestrator.output_errors` - 输出错误日志

### Completion Notes List

1. **CLI 命令已添加**:
   - `autoqa plan explore` - 探索应用结构
   - `autoqa plan generate` - 基于探索结果生成测试用例
   - `autoqa plan run` - 一键完成探索+生成

2. **Agent 决策机制**: TypeScript 仅传递上下文，具体测试类型由 Agent 自主决定

3. **输出格式**: 生成的 Markdown 符合 AutoQA 结构，使用占位符而非敏感数据

4. **测试覆盖**: 支持 functional、form、navigation、responsive、boundary、security 六种测试类型

5. **已完成事项**:
   - ✅ 添加 e2e 测试（使用 demo 应用）
   - ✅ 创建典型业务模式示例（搜索/登录/注册）
   - ✅ 优化 Agent prompt 以提高业务模式识别能力

### File List

**Modified Files:**
- `src/cli/commands/plan.ts` - 添加了 `generate` 和 `run` 子命令
- `src/plan/types.ts` - 定义了 TestPlan、TestCasePlan、FlowPlan 等数据模型
- `src/plan/orchestrator.ts` - 实现了测试计划生成的编排逻辑
- `src/plan/plan-agent.ts` - 集成了 Claude Agent SDK 进行智能规划
- `src/plan/planner-tools-mcp.ts` - 创建了 MCP 工具供 Agent 使用
- `src/plan/output.ts` - 实现了 Markdown 渲染功能
- `src/logging/types.ts` - 扩展了日志类型以支持规划功能
- `tests/unit/plan-agent.test.ts` - 为 plan-agent 添加了单元测试
- `tests/unit/cli-plan-explore.test.ts` - 更新了 CLI 探索测试
- `tests/unit/plan-output.test.ts` - 添加了输出功能的测试

**New Files:**
- `src/plan/orchestrator.ts` - 新增文件
- `src/plan/plan-agent.ts` - 新增文件
- `src/plan/planner-tools-mcp.ts` - 新增文件
- `tests/unit/plan-agent.test.ts` - 新增文件

### Change Log

- 2025-12-20: 初始创建 Story 7.2 文档（Agent 驱动的智能测试用例生成器），尚未实现
- 2025-12-20: 实现 Agent 驱动的测试用例生成核心功能，包括数据模型、编排器、Agent 集成、MCP 工具、CLI 命令等
- 2025-12-20: 添加 `autoqa plan generate` 和 `autoqa plan run` 命令，支持从探索结果生成 Markdown 测试用例
- 2025-12-21: 完成 e2e 测试和业务模式 demo（搜索/登录/注册），将故事状态更新为 done
