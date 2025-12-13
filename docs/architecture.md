---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputDocuments:
  - docs/prd.md
  - docs/project-brief.md
workflowType: 'architecture'
lastStep: 8
status: 'complete'
completedAt: '2025-12-13'
project_name: 'AutoQA-Agent'
user_name: 'Nick'
date: '2025-12-13'
---

# Architecture Decision Document

## Project Context Analysis（项目背景分析）

### Requirements Overview（需求概览）

**Functional Requirements:**

- **CLI workflows**: `autoqa init` / `autoqa run`（单文件/目录执行、`--headless`/`--debug`、`--url` 覆盖 Base URL）
- **Markdown → Task Context**: 从 Markdown 中提取前置条件与步骤/断言，生成 Claude Agent SDK 可用的任务上下文
- **Visual Perception Loop**: 每次执行浏览器操作工具前自动截图，并把截图注入当前 turn，使模型“看着页面”决策
- **Self-Healing Loop**: 工具/断言失败不直接中断，返回 `ToolResult(is_error: true)` 触发下一轮推理与重试
- **Tooling surface**: Playwright adapters（navigate/click/fill/scroll/wait）与 assertions（text/visible）

**Non-Functional Requirements:**

- **Startup**: CLI 启动到浏览器打开 < 3s
- **Stability**: TodoMVC demo 连跑 10 次 100% 通过
- **Cost control**: 截图压缩（如 1024px 宽、JPEG/quality）以降低 token
- **Observability**: CLI 需实时输出 Agent 思考过程、工具调用与关键上下文，便于 CI 定位问题

**Scale & Complexity:**

- Primary domain: 开源 CLI 开发者/QA 工具
- Complexity level: medium（无多租户/合规/实时协作，但存在多模态 + 自愈闭环 + 成本/可观测性约束）
- Estimated architectural components: CLI layer / config & schema / markdown parser / agent runner / playwright tool adapters / screenshot pipeline / logging & reporting

### Technical Constraints & Dependencies（技术约束与依赖）

- Node.js >= 20（原因：`commander@14` 要求 Node >= 20）
- 推荐使用当前 LTS：Node.js `v24.12.0`（Krypton，已通过 nodejs.org release notes 验证）
- Claude Agent SDK（Node）：`@anthropic-ai/claude-agent-sdk@0.1.69`（已通过 npm registry 验证）
- Playwright runtime：`playwright@1.57.0` / 测试：`@playwright/test@1.57.0`（已通过 npm registry 验证）
- 需要 `ANTHROPIC_API_KEY` 环境变量
- MVP：不做并发、不做复杂报告看板
- 测试隔离：每个 Markdown 用例文件运行一个新的 Browser Context（隔离 cookie/session）

### Cross-Cutting Concerns Identified（横切关注点）

- **Error model + retry/self-heal strategy**（工具失败与断言失败一致处理，且必须有限制/护栏）
- **Screenshot capture/compress/inject pipeline**（成本与稳定性关键路径）
- **Observability/logging for CI**（可读、可追踪、可定位失败）
- **Determinism & test isolation**（可重复执行、环境隔离）

## Starter Template Evaluation（启动模板/脚手架评估）

### Primary Technology Domain（主要技术域）

本项目属于 **Node.js + TypeScript 的本地 CLI 工具**：负责读取 Markdown 用例、驱动 Playwright 浏览器，并通过 Claude Agent SDK 完成推理与工具编排。

### Starter Options Considered（候选方案）

- **Option A: oclif 生成器**
  - 优点：脚手架成熟、插件体系完整
  - 取舍：对 MVP 偏重，抽象层较多，不利于把核心逻辑聚焦在“Agent + Tools + Screenshot + Self-heal”
- **Option B: Commander.js + tsup 的轻量自建骨架（选定）**
  - 优点：与 PRD 期望一致（Commander），代码路径短、结构更透明，利于 AI agents 一致实现
  - 风险：需要手动补齐 build/test/lint 约定（但可控）
- **Option C: 仅 `tsc` 编译、无 bundler**
  - 优点：依赖最少
  - 风险：产物组织（ESM/CJS、shebang、dist 结构）容易产生分歧；长期更容易出现“多 agent 各写各的”

### Selected Starter（选定方案）

**Selected Starter: 自建 TypeScript CLI Skeleton（Commander.js + tsup）**

**Rationale for Selection（选择理由）:**

- **清晰边界**：CLI/Runner/Agent/Tools 分层在骨架阶段就确定，减少后续重构
- **最小抽象**：避免复杂脚手架自带的意见（opinionated）结构干扰核心逻辑
- **可维护与可读性**：符合“核心逻辑尽量精简”的项目目标

**Initialization Command（初始化命令，版本已验证）:**

```bash
# Node.js: 推荐 v24.12.0 (LTS)，最低 >= 20

npm init -y
npm pkg set type=module
npm pkg set bin.autoqa=dist/cli.js

# runtime deps
npm i \
  @anthropic-ai/claude-agent-sdk@0.1.69 \
  commander@14.0.2 \
  playwright@1.57.0 \
  pino@10.1.0 \
  remark-parse@11.0.0 \
  zod@3.24.1

# dev deps
npm i -D \
  @playwright/test@1.57.0 \
  tsup@8.5.1 \
  typescript@5.9.3 \
  vitest@4.0.15

npx tsc --init
```

**Architectural Decisions Provided by Starter（starter 自带决策）:**

- **Module system**：ESM（`package.json` `type=module`）
- **Build output**：统一输出到 `dist/`，并通过 `bin.autoqa` 暴露 CLI 入口
- **Runtime baseline**：Node >= 20

## Core Architectural Decisions（核心架构决策）

### Decision Priority Analysis（决策优先级）

**Critical Decisions (Block Implementation):**

- **Runtime**：Node.js >= 20；推荐使用 Node.js `v24.12.0` (LTS)
- **Language**：TypeScript `5.9.3`
- **Agent Runtime**：`@anthropic-ai/claude-agent-sdk@0.1.69`
- **Browser Automation**：`playwright@1.57.0`
- **CLI Framework**：`commander@14.0.2`
- **Config validation**：`zod@3.24.1`（满足 Agent SDK peer dependency）
- **Markdown parsing**：`remark-parse@11.0.0`
- **Logging**：`pino@10.1.0`
- **Build/Distribution**：`tsup@8.5.1` 输出 `dist/`，通过 `bin.autoqa` 暴露 `autoqa` 命令

**Important Decisions (Shape Architecture):**

- **执行模型**：单进程、按 spec 顺序执行（MVP 不做并发），确保可观测性与可重复性
- **隔离模型**：每个 Markdown 文件创建新的 Browser Context；同一个 `autoqa run` 可复用同一个 Browser 实例以降低启动开销
- **自愈护栏（必须实现）**：任何自愈/重试循环必须有限制（例如 `maxToolCallsPerSpec` / `maxConsecutiveErrors` / `maxRetriesPerStep`）
- **截图策略（必须实现）**：
  - 每次“会改变页面状态”的工具调用前截屏，作为当前 turn 的视觉上下文
  - 工具失败/断言失败时必须附带失败截图（用于下一轮推理）
  - 截图应压缩（优先 JPEG + quality；必要时通过固定 viewport 宽度实现近似“1024px”）
- **产物策略**：默认只输出控制台日志；但在架构上预留 reporter 扩展点（未来可加 JUnit/JSON）

**Deferred Decisions (Post-MVP):**

- 并发执行（多文件并行、跨进程调度）
- 复杂报告形态（JUnit/JSON/HTML）
- MCP Server / 服务化形态

### Data Architecture（数据与状态）

本项目不需要数据库；“数据架构”主要体现在配置、运行状态与运行产物。

- **配置文件**：`autoqa.config.json`
  - 使用 `zod` 进行严格校验与默认值补齐
  - 建议包含 `schemaVersion`，用于未来字段演进
- **输入**：Markdown specs（文件/目录）
  - 解析最小结构：Preconditions + Steps（含预期/断言语句）
- **运行时状态（内存）**：建议以 `RunContext` 聚合
  - `runId`、`specPath`、`baseUrl`
  - `browser`、`context`、`page`
  - `stepIndex`、`toolCallCount`、`consecutiveErrorCount`
- **运行产物（文件系统，可配置）**：建议写入 `.autoqa/<runId>/...`
  - `run.log.jsonl`：结构化日志（pino）
  - `screenshots/`：截图（默认只保留失败相关；debug 模式可保留全部）
  - `transcript.json`：可选，记录关键的 tool calls/结果，便于复现与调试

### Authentication & Security（认证与安全）

- **API key**：只从环境变量 `ANTHROPIC_API_KEY` 读取，不落盘
- **日志脱敏**：对 env、HTTP headers、以及可能包含 token 的字段进行 redaction
- **截图敏感信息**：
  - 默认仅在失败/调试模式将截图持久化到磁盘
  - CI 场景可仅把截图注入模型，不持久化
- **文件路径安全**：输入路径规范化（避免目录穿越），产物写入目录必须受控

### API & Communication Patterns（内部接口与通信模式）

本项目不对外提供 HTTP API；主要通过 **内部分层与清晰边界** 保持可维护性：

- **CLI layer**：解析参数、加载配置、选择要执行的 specs
- **Runner layer**：按 spec 执行，负责生命周期与隔离（Browser/Context/Page）
- **Agent layer**：集成 Claude Agent SDK，构建提示词/任务上下文，注册工具并驱动运行
- **Tool layer**：对 Playwright 的稳定封装；失败时不得抛出终止异常，而返回 `is_error: true` 结果给 SDK
- **Reporting/Logging**：订阅运行事件输出（控制台 + 可选文件），用于 CI 可观测性

建议通过统一事件名（例如 `autoqa.spec.started`、`autoqa.tool.called`、`autoqa.heal.attempted`）贯穿全链路，确保日志字段一致、便于后续接入报告器。

### Infrastructure & Deployment（交付与 CI）

- **交付形态**：npm 包（支持全局安装与 `npx autoqa`）
- **退出码约定**：
  - `0`：全部 specs 通过
  - `1`：存在失败（断言失败或自愈护栏触发）
  - `2`：用户输入/配置错误（如缺少 `ANTHROPIC_API_KEY`、配置不合法）
- **CI**：GitHub Actions（建议最小流程）
  - 安装依赖
  - 安装 Playwright browsers
  - 运行 `vitest`（单元测试）
  - 运行最小集成用例（例如 TodoMVC 或内部 demo）

## Implementation Patterns & Consistency Rules（实现模式与一致性规则）

### Pattern Categories Defined（需要强约束的一致性维度）

为避免不同 AI agents 在实现时做出不兼容选择，本项目把一致性约束分为以下类别（约 7 类高风险冲突点）：

- **命名规范**：CLI/flags、配置字段、工具名称、日志字段
- **分层边界**：CLI/Runner/Agent/Tools/Browser/Reporting
- **错误与返回模型**：throw vs `is_error`、错误码、可重试语义
- **截图与自愈策略**：截图时机、压缩、保留策略、护栏
- **可观测性**：日志结构、事件名、输出顺序
- **测试与隔离**：Browser/Context 的生命周期、确定性设置
- **文件系统产物**：运行目录结构、命名、清理策略

### Naming Patterns（命名规范）

**CLI 命令与 flags：**

- 命令：`autoqa init`、`autoqa run`
- flags：kebab-case，例如 `--headless`、`--debug`、`--url`
- 退出码：`0/1/2`（见上文交付约定）

**配置文件（JSON）：**

- 文件名固定：`autoqa.config.json`
- 字段命名统一 `camelCase`（例如 `baseUrl`、`schemaVersion`、`maxToolCallsPerSpec`）
- 必须包含 `schemaVersion`（字符串或整数均可，但要固定一种；推荐整数）

**环境变量：**

- `ANTHROPIC_API_KEY`（必须）
- 未来如需扩展，统一 `AUTOQA_*` 前缀

**工具命名（注册到 Agent SDK 的 toolName）：**

- 浏览器动作：`navigate`、`click`、`fill`、`scroll`、`wait`
- 断言：`assertTextPresent`、`assertElementVisible`
- 约定：所有工具都用动词开头；断言用 `assert*` 前缀

**日志字段：**

- 必须包含：`runId`、`specPath`、`stepIndex`
- 工具相关必须包含：`toolName`、`toolInput`（可裁剪）、`toolDurationMs`
- 错误相关必须包含：`error.code`、`error.message`、`error.retriable`

### Structure Patterns（结构与边界规范）

**分层边界（强约束）：**

- `src/cli/**`
  - 只做参数解析、帮助信息、调用 runner
  - 禁止直接调用 Playwright API
- `src/runner/**`
  - 负责 per spec 生命周期：创建 Browser/Context/Page、调用 agent、收集结果
- `src/agent/**`
  - 负责 Claude Agent SDK 集成、提示词与任务上下文、工具注册
  - 负责“自愈护栏”的统一实现
- `src/tools/**`
  - 只封装 Playwright 操作与断言
  - **失败不得 throw 终止**，必须返回错误结果给 SDK 驱动自愈
- `src/browser/**`
  - 只处理 Playwright 对象创建、截图、定位辅助
- `src/reporting/**`
  - 输出与产物生成（MVP：console）

**测试组织：**

- 单元测试放在 `tests/unit/**`
- 集成测试放在 `tests/integration/**`
- Playwright e2e（如需要）放在 `tests/e2e/**`

### Format Patterns（数据契约/返回格式）

**ToolResult 约定（项目内部契约）：**

- 所有工具都返回同构对象：
  - `ok: boolean`
  - `data?: any`（成功时）
  - `error?: { code: string; message: string; retriable: boolean; cause?: string }`（失败时）
  - `screenshot?: { mimeType: string; path?: string; width?: number; height?: number }`

**与 Claude Agent SDK 的对接：**

- 工具失败必须映射为 SDK 的 `ToolResult(is_error: true)`（或等价语义）
- 工具失败时的 `error.code` 必须可机器处理（用于统计与护栏）

### Communication Patterns（事件与日志顺序）

建议采用事件驱动（例如 Node `EventEmitter`）贯穿 runner：

- `autoqa.run.started` → `autoqa.spec.started` → (tool/step events...) → `autoqa.spec.finished` → `autoqa.run.finished`

事件负载字段遵循日志字段规范，以便 reporter 只需订阅事件即可输出。

### Process Patterns（流程与护栏）

**截图与视觉注入：**

- 在任何“可能改变页面状态”的工具调用前都截屏
- 失败时必须截屏并附带错误信息（供下一轮推理）
- 截图默认压缩（例如 JPEG，且固定 viewport 宽度以控制 token）

**自愈护栏（必须）：**

- `maxToolCallsPerSpec`：限制单个 spec 的总工具调用次数
- `maxConsecutiveErrors`：限制连续失败次数（避免陷入同一错误循环）
- `maxRetriesPerStep`：限制单个步骤重试次数

一旦触发护栏，runner 必须将该 spec 标记为失败并继续（或按配置中止整个 run）。

**确定性（建议）：**

- 固定 viewport、时区、语言（如适用）
- 记录关键环境信息到日志（Node 版本、Playwright 版本、baseUrl、headless/debug）

### Enforcement Guidelines（执行与约束）

所有 AI agents 必须：

- 严格遵守分层边界（尤其禁止在 CLI/Runner 直接调用 Playwright）
- 工具失败不得 throw 终止；必须返回错误结果给 SDK 驱动自愈
- 新增配置项必须经过 schema 校验并提供默认值
- 新增工具必须注册到统一入口（例如 `src/tools/index.ts`）并满足 ToolResult 约定

### Pattern Examples（示例/反例）

**Good Examples:**

- `run` 命令只负责把 `specPath` 交给 runner，并输出汇总
- `click` 工具内部捕获 Playwright 异常，返回 `{ ok: false, error: { code: 'ELEMENT_NOT_FOUND', retriable: true } }`

**Anti-Patterns:**

- 在 `src/cli/commands/run.ts` 里直接 `page.click(...)`
- 工具失败时直接 `throw` 导致进程退出（SDK 无法进入下一轮推理）
- 自愈无上限重试（会导致 token 成本失控、CI 卡死）

## Project Structure & Boundaries（项目结构与边界）

### Complete Project Directory Structure（完整目录结构）

```text
AutoQA-Agent/
├── README.md
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
├── playwright.config.ts
├── .gitignore
├── .env.example
├── docs/
│   ├── prd.md
│   ├── project-brief.md
│   └── architecture.md
├── specs/
│   └── login-example.md
├── src/
│   ├── cli/
│   │   ├── cli.ts
│   │   └── commands/
│   │       ├── init.ts
│   │       └── run.ts
│   ├── config/
│   │   ├── schema.ts
│   │   ├── defaults.ts
│   │   └── load.ts
│   ├── markdown/
│   │   ├── parse-markdown.ts
│   │   └── build-task-context.ts
│   ├── runner/
│   │   ├── run-directory.ts
│   │   └── run-spec-file.ts
│   ├── agent/
│   │   ├── create-agent.ts
│   │   ├── run-agent.ts
│   │   ├── prompts.ts
│   │   └── guardrails.ts
│   ├── browser/
│   │   ├── create-browser.ts
│   │   ├── create-context.ts
│   │   └── screenshot.ts
│   ├── tools/
│   │   ├── index.ts
│   │   ├── navigate.ts
│   │   ├── click.ts
│   │   ├── fill.ts
│   │   ├── scroll.ts
│   │   ├── wait.ts
│   │   └── assertions/
│   │       ├── assert-text-present.ts
│   │       └── assert-element-visible.ts
│   ├── logging/
│   │   ├── logger.ts
│   │   └── redact.ts
│   ├── reporting/
│   │   ├── reporter.ts
│   │   └── console-reporter.ts
│   └── util/
│       ├── errors.ts
│       ├── fs.ts
│       └── timing.ts
├── tests/
│   ├── unit/
│   └── integration/
├── dist/               (generated)
└── .autoqa/             (generated)
```

### Architectural Boundaries（架构边界）

**CLI Boundaries:**

- `src/cli/**` 只负责 CLI UX（参数/帮助/命令路由），不包含浏览器逻辑

**Runner Boundaries:**

- `src/runner/**` 只负责 per-spec 生命周期与隔离（Browser/Context/Page），不做具体“如何点击/填表”的细节

**Agent Boundaries:**

- `src/agent/**` 只负责 Agent SDK 集成、提示词/任务上下文、工具注册、护栏

**Tools/Browser Boundaries:**

- `src/browser/**` 只负责创建 Playwright 对象与截图等基础能力
- `src/tools/**` 只负责对 Playwright 操作/断言的稳定封装（失败返回可序列化错误，不 throw 终止）

**Reporting/Logging Boundaries:**

- `src/logging/**` 只负责日志初始化与脱敏
- `src/reporting/**` 只负责把运行事件渲染成输出/产物（MVP：console）

### Requirements to Structure Mapping（需求到目录映射）

- **FR1 autoqa init** → `src/cli/commands/init.ts` + `specs/` 模板
- **FR2 autoqa run** → `src/cli/commands/run.ts` + `src/runner/*`
- **FR3 Markdown 解析** → `src/markdown/*`
- **FR4 视觉感知循环** → `src/browser/screenshot.ts` + `src/agent/run-agent.ts`
- **FR5 自愈闭环** → `src/agent/**` 统一实现
- **FR6 浏览器操作工具** → `src/tools/*`
- **FR7 断言工具** → `src/tools/assertions/*`

### Integration Points（集成点）

**External Integrations:**

- Anthropic Claude（通过 `@anthropic-ai/claude-agent-sdk`）
- Playwright browsers（Chromium/WebKit/Firefox，按 Playwright 安装管理）

**Internal Communication:**

- CLI → Runner：传递选中的 spec 列表、运行参数（headless/debug/url override）
- Runner → Agent：传递 `RunContext`（含 page）与 `TaskContext`（由 Markdown 解析生成）
- Agent → Tools：通过 SDK 工具调用接口

### Data Flow（数据流）

- `autoqa run` → load config → discover specs → parse markdown → build task context
- per spec：create browser context → create agent + register tools
- per tool call：capture screenshot → tool execute → return ToolResult（ok/is_error）
- failure：ToolResult(is_error) → SDK next turn reasoning → retry until success or guardrails hit

## Architecture Validation Results（架构验证结果）

### Coherence Validation（一致性验证）

**Decision Compatibility（决策兼容性）:**

- Node 基线为 `>= 20`：满足 `commander@14` 与 `vitest@4` 的 engines 要求，同时兼容 `playwright@1.57.0`（>=18）与 `@anthropic-ai/claude-agent-sdk@0.1.69`（>=18）
- 统一使用 ESM：避免 CJS/ESM 混用导致的入口/打包分歧
- Agent SDK peer dependency：使用 `zod@3.24.1` 满足 `^3.24.1` 要求

**Pattern Consistency（模式一致性）:**

- ToolResult 统一返回模型与 `is_error` 语义对齐，能让 SDK 在失败时进入下一轮推理而不是被异常中断
- “截图 → 注入 → 工具调用 → 结果回流” 作为强约束，与自愈护栏共同限制成本与无限重试风险

**Structure Alignment（结构对齐）:**

- 目录分层与边界（CLI/Runner/Agent/Tools/Browser/Reporting）与需求映射一致，避免在实现期出现“哪里都能直接调用 page”的漂移

### Requirements Coverage Validation（需求覆盖验证）

**Functional Requirements Coverage（功能需求覆盖）:**

- FR1/FR2：CLI 初始化与执行路径在 `src/cli/**`，调度与隔离在 `src/runner/**`
- FR3：Markdown 解析与 TaskContext 构建在 `src/markdown/**`
- FR4：视觉感知循环由 `src/browser/screenshot.ts` + `src/agent/run-agent.ts` 保障
- FR5：自愈闭环与护栏由 `src/agent/**` 统一实现
- FR6/FR7：工具与断言封装在 `src/tools/**`

**Non-Functional Requirements Coverage（非功能需求覆盖）:**

- 启动速度：通过“单次 run 复用 Browser、每 spec 新建 Context”平衡性能与隔离
- 稳定性：隔离性 + 确定性设置 + 自愈护栏与错误回流
- 成本控制：截图压缩与持久化策略可配置，默认只保留失败相关
- 可观测性：结构化日志（pino）+ 事件流（runner 统一发事件）

### Implementation Readiness Validation（实现就绪验证）

**Decision Completeness（决策完整性）:**

- 关键栈与版本已固定（Node/TS/Playwright/Agent SDK/Commander/tsup/vitest）
- 自愈与截图的关键护栏已明确，避免实现期走偏

**Structure Completeness（结构完整性）:**

- 给出了可直接落地的目录树与模块边界
- 给出了需求到目录的映射，可直接作为实现导航

**Pattern Completeness（模式完整性）:**

- 统一命名、分层边界、错误模型、日志字段、截图策略
- 给出示例/反例，降低多 agent 协作冲突

### Gap Analysis Results（差距分析）

**Critical Gaps（阻塞级）:**

- 当前无阻塞级缺口（MVP 可直接启动实现）

**Important Gaps（重要但不阻塞）:**

- 明确 Markdown spec 的最小语法约定（章节名称、步骤/断言表达方式），并在 `autoqa init` 的模板中固化
- 明确事件 payload 的字段契约（供未来 reporter 扩展：JUnit/JSON）

**Nice-to-Have Gaps（可延后）:**

- 并发执行与资源调度（多 spec 并行）
- 多报告器（JUnit/JSON/HTML）
- 更丰富的稳定性策略（如 trace/录像保留、失败最小复现包）

### Validation Issues Addressed（验证期已解决问题）

- 统一 Node 基线为 `>= 20`，与 `commander@14`/`vitest@4` 保持一致
- 统一 `zod@3.24.1` 以满足 Agent SDK 的 peer dependency

### Architecture Readiness Assessment（就绪评估）

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** high

**Key Strengths:**

- 以“工具失败不终止、错误回流驱动自愈”为中心，架构对齐 PRD 目标
- 清晰分层 + 一致性规则，适合多 AI agent 并行实现
- 成本/可观测性/隔离性在 MVP 阶段就有明确落点

**Areas for Future Enhancement:**

- 报告器扩展（JUnit/JSON/HTML）
- 并发执行与资源调度

### Implementation Handoff（实现交接）

**AI Agent Guidelines:**

- 实现任何 story 前先阅读本 `docs/architecture.md`
- 严格遵守分层边界与 ToolResult 错误模型
- 截图/自愈必须受护栏约束

**First Implementation Priority:**

- 先落地项目骨架（Starter Template Evaluation 中的初始化命令与目录结构），再实现 `autoqa init` / `autoqa run` 的最小闭环

## Architecture Completion Summary（架构交付总结）

### Final Architecture Deliverables（最终交付物）

**完整的 Architecture Decision Document**

- 关键技术栈与版本（已验证）
- 自愈与视觉注入的关键约束与护栏
- 多 AI agents 一致性规则（命名/分层/错误模型/日志字段）
- 目录结构与需求映射
- 架构验证与差距分析

**可实现的工程蓝图**

- 可直接落地的目录树与模块边界
- 可扩展点明确（tools/assertions/reporters）

### Next Steps（下一步）

- 建议进入 BMM 工作流的下一步：`create-epics-and-stories`（把 PRD 拆解为可执行 stories，便于多 agent 并行实现）

### Optional Enhancement（可选增强）

- 已生成：[`docs/project_context.md`](./project_context.md)（面向 AI agents 的短版规则集），把本架构文档中的“必须遵守的约束”再压缩一遍，减少实现期遗漏风险
