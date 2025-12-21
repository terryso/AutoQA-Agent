# Story 8.3: Planner 提示词与用例质量标准增强

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a QA 工程师,
I want Planner 在生成测试计划时自动考虑 Happy path、边界/负例场景、起始状态与成功标准，并在适当场景复用 `include:` 步骤库,
so that 产生的用例既具备自动化可执行性，又符合资深测试工程师的用例质量标准。

## Acceptance Criteria

1. **Happy path 与 边界/负例用例覆盖**
   - **Given** Explore Session 在目标系统中发现了搜索、表单提交、登录/登出、CRUD 等关键行为，且已生成 ExplorationGraph
   - **When** 运行 `autoqa plan-explore` + `autoqa plan-generate` 或一键 `autoqa plan` 生成 `test-plan.json` 与对应 Markdown specs
   - **Then** 对每类关键行为，`test-plan.json` 中至少包含：
     - 一条清晰的 Happy path 用例（正常输入 / 正常流程）
     - 一条或多条边界/负例用例（例如必填校验、长度上限、非法字符、权限不足、无结果搜索等）
   - **And** 生成的 Markdown specs：
     - 在 `## Preconditions` 中明确起始状态（登录状态、测试数据、环境等）
     - 在 `## Steps` 段中使用“可执行语义”步骤（Navigate / Click / Fill / Verify），并为每个需要验收的步骤提供 `- Expected: ...` 断言行
   - **And** 这些用例应满足 Tech Spec 中对 AC3「Planner 输出包含负例与质量约束」的要求。

2. **用例质量标准与结构约束被内化到 Planner Prompt**
   - **Given** 已更新的 Planner 提示词（尤其是 `plan-agent` prompt），包含对用例质量与结构的显式约束
   - **When** 检查 prompt 文本以及从同一个探索产物生成的 `test-plan.json` 与 Markdown specs
   - **Then** Prompt 必须至少约束：
     - 每个 TestCase 需包含：清晰的业务目标、起始世界状态（Preconditions）、结束/成功标准
     - `steps[].description` 使用可执行语义，避免过细 UI 交互噪音（不要求逐个像素级点击）
     - `steps[].expectedResult` 为非空且为可自动验证的断言文案
   - **And** 随机抽样的生成用例在结构与文案风格上，与手写示例（如 `specs/saucedemo-01-login.md`、`specs/saucedemo-03-cart.md`）保持一致，并满足 `ts-7-agent-based-intelligent-planner.md` / `ts-8-1-8-3-plan-scope-and-executable-specs.md` 中的质量要求。

3. **自动复用 `include:` 步骤库，避免重复建轮子**
   - **Given** 在 PlanConfig 或相关配置中已约定登录步骤库路径（例如 `plan.loginStepsSpec`，默认 `steps/login.md`），且项目中已存在对应步骤库
   - **When** Planner 识别出某个用例需要登录态或可复用的通用前置步骤（例如登录、基础导航）
   - **Then** 生成的 Markdown spec 顶部应自动插入一条 `include: <plan.loginStepsSpec>` 或等效的步骤库引用，放在业务步骤之前
   - **And** 当多个用例复用相同登录或通用前置流程时，Planner 应倾向于通过 `include:` 复用，而不是在每个用例中重复展开完整步骤
   - **And** 上述行为与 Epic 2 中 `include:` 语义兼容，不改变 Runner 的 include 展开行为。

4. **质量增强具备可回归的测试与示例**
   - **Given** 新增/更新与 Planner 提示词质量、负例生成与 include 复用相关的单元测试与端到端测试
   - **When** 运行 `npm test`
   - **Then** 至少验证：
     - 对给定 ExplorationGraph（包含搜索/表单/登录等行为），生成的 `test-plan.json` 中包含 Happy path + 边界/负例用例对
     - 生成的 Markdown specs 结构满足 `parseMarkdownSpec` 最小结构要求，并符合本故事的质量约束
     - 当 PlanConfig 中配置了 `plan.loginStepsSpec` 且用例需要登录时，Markdown 中自动插入正确的 `include:` 步骤库引用
   - **And** 补充/更新文档示例（如 Polyv / SauceDemo Planner 输出样例），说明 Planner 用例质量标准与 `include:` 复用策略。

## Tasks / Subtasks

- [x] 增强 Planner Prompt 与 TestCase 质量约束（AC: 1, 2）
  - [x] 在 `src/plan/plan-agent.ts` 中重构和扩展 prompt 结构：明确区分「探索输入摘要」「用例生成规则」「质量与负例约束」等小节
  - [x] 在 prompt 中加入对 Happy path 与边界/负例用例的明确要求，以及起始状态/成功标准的必填约束
  - [x] 确保 `TestCasePlan` 模型中保留足够字段（如 preconditions、successCriteria / expectedResult 等），供后续 Markdown 生成消费

- [x] 负例与边界用例生成策略实现（AC: 1, 2）
  - [x] 基于 ExplorationGraph 与页面元素/行为信息，为 Planner 提供典型负例/边界输入提示（例如空值、超长、非法字符、权限不足）
  - [x] 在 `generateTestPlan` 或其下游逻辑中，确保对关键表单/搜索/登录等行为，至少生成一条负例或边界用例
  - [x] 通过单元测试验证在代表性场景下（搜索、表单、登录），确实生成 Happy + 负例组合

- [x] `include:` 步骤库复用策略与配置（AC: 3）
  - [x] 对照 `ts-8-1-8-3-plan-scope-and-executable-specs.md` 第 6.3 小节，梳理登录/公共步骤库复用规则
  - [x] 在 PlanConfig 或相关配置中接入 `plan.loginStepsSpec`（如尚未接入），并在 Markdown 生成时根据 `requiresLogin` 或等价标志插入 `include:`
  - [x] 确保生成的 include 写法与 Epic 2/5/6 中现有 include/环境变量方案兼容

- [x] 测试与文档更新（AC: 4）
  - [x] 新增 Planner 输出质量相关单元测试与端到端测试，覆盖 Happy/负例组合、Preconditions 与 Expected 结构、include 复用等
  - [x] 在 `docs/sprint-artifacts/ts-8-1-8-3-plan-scope-and-executable-specs.md` 中标记 W3 相关条目已实现，并补充示例
  - [x] 更新 `docs/project-context.md` / Planner 相关用户文档，解释 Planner 用例质量标准与配置要点

## Dev Notes

- 本故事聚焦 **Planner 提示词与输出用例质量** 的增强，在现有 CLI 行为、Runner 模型与 Markdown 语法不变的前提下，通过 Prompt 约束与 TestPlan 结构约定来提高 Planner 产出质量。
- 优先复用并扩展 Epic 7/8 现有架构与模型：
  - Planner 输入/输出模型：`src/plan/types.ts` 中的 `PlanConfig`、`TestPlan`、`TestCasePlan` 等结构
  - Orchestrator 与 Prompt 组装：`src/plan/orchestrator.ts`、`src/plan/plan-agent.ts`、`src/plan/explore-agent.ts`
  - Markdown 生成：`src/plan/output.ts` 及相关辅助函数
- 对「负例/边界用例」的识别规则应尽量保持 **启发式 + Prompt 驱动**，而不是在 TypeScript 端硬编码站点特定逻辑，避免违反 Epic 7 中“业务智能主要由 Agent 决策”的原则。
- 与 Epic 5/6 的环境与登录态方案保持一致：
  - URL 模板化继续依赖 `{{BASE_URL}}` / `{{LOGIN_BASE_URL}}` 等变量
  - 登录相关用例通过 `include: login` 或 `include: <plan.loginStepsSpec>` 复用登录步骤库，而不是在 Planner 里复制登录流程细节。

### Project Structure Notes

- 严格遵守 `docs/architecture.md` 中的分层与边界约束：
  - `src/cli/commands/plan.ts` 只做参数解析与 orchestrator 调用，不直接操作 Playwright 或浏览器实例
  - `src/plan/*` 负责 Explore/Plan Agent 提示词、PlanConfig、ExplorationGraph/ TestPlan/Markdown 生成
  - 禁止在 Planner 中引入新的运行时依赖或跨越到 `src/browser`、`src/tools` 等层
- 保持与 Epic 7 中 `.autoqa/runs/<runId>/plan-*` 目录结构兼容，继续复用现有探索产物与规划产物布局。

### References

- [Source: docs/epics.md#Story-8.3-Planner-提示词与用例质量标准增强]
- [Source: docs/epics.md#Epic-8-Planner-输出质量与-URL-Scope-控制]
- [Source: docs/sprint-artifacts/ts-8-1-8-3-plan-scope-and-executable-specs.md]
- [Source: docs/sprint-artifacts/ts-7-agent-based-intelligent-planner.md]
- [Source: docs/sprint-artifacts/7-3-plan-command-implementation.md]
- [Source: docs/sprint-artifacts/7-4-configurable-exploration-strategy.md]

## Dev Agent Record

### Agent Model Used

Cascade

### Debug Log References

### Completion Notes List

- 2025-12-21: 完成 Story 8.3 实施
  - 增强了 `buildPlanPrompt` 函数，添加了结构化的测试规划原则，包括：
    - 综合场景覆盖（Happy Path + Boundary/Negative Cases）
    - 测试用例质量标准（清晰的初始状态、可执行步骤、可验证的成功标准）
    - Markdown 结构要求（与 autoqa run 兼容）
  - 扩展了 `requiresLogin` 函数，增加了更多登录检测关键词（authentication, authenticate）
  - `loginStepsSpec` 配置已在 PlanConfig 中定义，并在 Markdown 生成时正确使用
  - 新增 4 个测试文件，共 24 个测试用例，全部通过：
    - `tests/unit/plan-prompt-quality.test.ts`: 验证 Prompt 结构和质量约束（8 tests）
    - `tests/unit/plan-boundary-cases.test.ts`: 验证边界和负例用例生成（5 tests）
    - `tests/unit/plan-include-steps.test.ts`: 验证 include 步骤库复用（10 tests）
    - `tests/unit/plan-output-quality-integration.test.ts`: 端到端集成测试（4 tests）
  - 完整测试套件通过：583 个测试全部通过，无回归

- 2025-12-22: Code Review 修复
  - **问题 1 修复**: 增强 Prompt 质量测试的实际覆盖
    - 导出 `buildPlanPrompt` 函数供测试使用
    - 重写 `plan-prompt-quality.test.ts`，添加 25 个详细断言验证 Prompt 文本内容
    - 测试现在验证所有关键片段：Happy Path 要求、Boundary Cases 要求、质量标准、模板变量等
    - 这些测试作为 Prompt 与 Tech Spec 之间的契约，任何关键文本删除都会导致测试失败
  - **问题 3 修复**: 改进 requiresLogin 启发式，减少误判
    - 在 `TestCasePlan` 类型中添加可选的 `requiresLogin?: boolean` 字段
    - 改进启发式逻辑的优先级：
      1. 显式 `requiresLogin` 字段优先
      2. 检测步骤中的凭证模板变量（{{USERNAME}}, {{PASSWORD}}, {{LOGIN_BASE_URL}}）
      3. 识别"already logged in"模式，避免重复插入登录步骤
      4. 收紧登录动作关键词列表（移除过于宽泛的"account"等词）
    - 更新所有相关测试用例以匹配新的启发式逻辑
  - 完整测试套件通过：604 个测试全部通过（新增 21 个测试）

### File List

**Modified Files:**
- `src/plan/plan-agent.ts`: 
  - 增强 Planner Prompt，添加质量标准和负例生成指导
  - 导出 `buildPlanPrompt` 函数供测试使用（Code Review 修复）
- `src/plan/output.ts`: 
  - 扩展 requiresLogin 函数，改进登录检测逻辑
  - 实现优先级启发式：显式字段 > 凭证变量 > "already logged in" 检测 > 登录动作关键词（Code Review 修复）
- `src/plan/types.ts`: 
  - PlanConfig 已包含 loginStepsSpec 字段（在 Story 8.1/8.2 中添加）
  - TestCasePlan 新增 `requiresLogin?: boolean` 字段（Code Review 修复）

**New Test Files:**
- `tests/unit/plan-prompt-quality.test.ts`: Planner Prompt 质量标准测试（25 tests，Code Review 重写）
- `tests/unit/plan-boundary-cases.test.ts`: 边界和负例用例生成测试（5 tests）
- `tests/unit/plan-include-steps.test.ts`: Include 步骤库复用测试（10 tests，Code Review 扩展）
- `tests/unit/plan-output-quality-integration.test.ts`: 端到端集成测试（4 tests）

**Updated Test Files (Code Review 修复):**
- `tests/unit/plan-login-include-e2e.test.ts`: 更新测试用例以匹配新的 requiresLogin 启发式
- `tests/unit/plan-markdown-output.test.ts`: 调整测试断言以适应新的登录检测逻辑
- `tests/unit/plan-output-quality-integration.test.ts`: 添加显式 requiresLogin 标志
