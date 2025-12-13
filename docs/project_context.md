# AutoQA-Agent Project Context（AI 实现速查版）

本文件面向“实现/维护 AutoQA-Agent 的 AI agents 与开发者”，用于汇总 **必须遵守** 的硬约束与一致性规则。

- **权威性**：如与 `docs/architecture.md` 冲突，以 `docs/architecture.md` 为准。
- **目标**：降低多 agent 并行实现时的结构漂移、命名不一致与错误处理分歧。

## 1. 运行时与依赖基线（不可随意更改）

- **Node.js**：`>= 20`（建议使用 LTS `v24.12.0`）
- **模块系统**：**ESM only**（避免 CJS/ESM 混用）
- **TypeScript**：`5.9.3`
- **Claude Agent SDK**：`@anthropic-ai/claude-agent-sdk@0.1.69`
- **Playwright**：`playwright@1.57.0`；`@playwright/test@1.57.0`
- **CLI**：`commander@14.0.2`
- **Build**：`tsup@8.5.1`
- **Test**：`vitest@4.0.15`
- **Markdown parsing**：`remark-parse@11.0.0`
- **Schema**：`zod@3.24.1`（与 Agent SDK peer dependency 对齐）
- **Logging**：`pino@10.1.0`

> 实际版本以 `package.json` 为准；升级依赖必须同时更新架构文档中的决策/约束。

## 2. 分层边界（强约束）

目标：任何 agent 都能快速判断“代码该写在哪里”，并避免跨层直接调用导致不可控耦合。

- **CLI Layer（`src/cli/**`）**
  - 只做参数解析、帮助信息、命令路由、调用 runner
  - **禁止**直接调用 Playwright（`page.*`/`browser.*`）

- **Runner Layer（`src/runner/**`）**
  - 负责 per-spec 生命周期与隔离：Browser/Context/Page 的创建与销毁
  - 负责把 spec → TaskContext 交给 agent 执行

- **Agent Layer（`src/agent/**`）**
  - 负责 Agent SDK 集成、提示词/任务上下文、工具注册
  - 负责统一的自愈护栏（防无限重试/成本失控）

- **Tools Layer（`src/tools/**`）**
  - 只封装浏览器动作/断言
  - **禁止**在工具失败时抛出未捕获异常终止整个 run（见下文 ToolResult 约定）

- **Browser 基础能力（`src/browser/**`）**
  - 只处理 Playwright 对象创建、截图、定位辅助

- **Logging/Reporting（`src/logging/**`, `src/reporting/**`）**
  - `logging`：日志初始化、脱敏
  - `reporting`：订阅运行事件并输出（MVP：console）

## 3. 命名与格式约定（必须统一）

- **CLI 命令**：`autoqa init`、`autoqa run`
- **CLI flags**：kebab-case（如 `--headless`、`--debug`、`--url`）
- **配置文件**：`autoqa.config.json`
  - 字段：camelCase（如 `baseUrl`、`schemaVersion`、`maxToolCallsPerSpec`）
  - **必须包含** `schemaVersion`（推荐整数）
- **环境变量**：
  - 必需：`ANTHROPIC_API_KEY`
  - 扩展：统一 `AUTOQA_*` 前缀
- **Tools 名称（注册到 SDK）**：动词开头；断言以 `assert*` 前缀
  - 动作：`navigate`、`click`、`fill`、`scroll`、`wait`
  - 断言：`assertTextPresent`、`assertElementVisible`

## 4. ToolResult / 错误处理契约（核心一致性点）

### 4.1 工具不得“throw 终止”

- 工具内部可以捕获异常，但必须转换为**可序列化错误结果**返回。
- 目的：让 Agent SDK 在失败后还能继续推理并尝试自愈，而不是进程直接崩溃。

### 4.2 统一 ToolResult 形状（项目内部契约）

所有工具必须返回同构对象：

- `ok: boolean`
- `data?: any`
- `error?: { code: string; message: string; retriable: boolean; cause?: string }`
- `screenshot?: { mimeType: string; path?: string; width?: number; height?: number }`

与 Agent SDK 对接时，失败必须映射为 `is_error: true`（或等价语义）。

### 4.3 错误码（必须可机器处理）

- `error.code` 必须稳定（用于统计/护栏/重试策略）
- 建议（可扩展）：
  - `ELEMENT_NOT_FOUND`
  - `TIMEOUT`
  - `NAVIGATION_FAILED`
  - `ASSERTION_FAILED`
  - `INVALID_INPUT`

## 5. 截图与视觉注入（必做 + 可控成本）

- 在任何“可能改变页面状态”的工具调用前都截屏
- 工具失败时必须截屏，并把截图与错误一并回流给 agent
- 默认截图应压缩（例如 JPEG），并固定 viewport 宽度以控制 token
- 截图产物目录建议：`.autoqa/runs/<runId>/screenshots/**`
- 输入路径与输出路径必须做规范化处理，避免目录穿越

## 6. 自愈护栏（必须有上限）

为避免无限循环与成本失控，runner/agent 必须执行护栏：

- `maxToolCallsPerSpec`
- `maxConsecutiveErrors`
- `maxRetriesPerStep`

触发护栏时：

- 必须将该 spec 标记为失败
- 退出码遵循架构文档：
  - `0`：全部通过
  - `1`：存在失败（断言失败或护栏触发）
  - `2`：用户输入/配置错误

## 7. 可观测性（结构化日志 + 事件流）

- 统一使用结构化日志（pino）
- 日志/事件必须包含（最少字段）：
  - `runId`
  - `specPath`
  - `stepIndex`
- 工具事件必须包含：
  - `toolName`
  - `toolDurationMs`
  - `toolInput`（可裁剪/脱敏）
- 错误必须包含：
  - `error.code`
  - `error.message`
  - `error.retriable`

事件命名建议：

- `autoqa.run.started`
- `autoqa.spec.started`
- `autoqa.tool.called`
- `autoqa.heal.attempted`
- `autoqa.spec.finished`
- `autoqa.run.finished`

## 8. 配置与安全（最低要求）

- 启动时必须校验：
  - `ANTHROPIC_API_KEY` 是否存在
  - `autoqa.config.json` 是否符合 schema
- 禁止把 secrets（API Key、token）输出到日志
- 任何写文件操作必须写到受控目录（如 `.autoqa/**`），且路径必须 normalize

## 9. 测试与确定性（建议遵守）

- 单元测试：`tests/unit/**`
- 集成测试：`tests/integration/**`
- 确定性建议：固定 viewport/时区/语言（如适用），并记录到日志

## 10. 实现变更守则（对 AI agents）

- 新增配置项：
  - 必须在 `src/config/schema.ts` 中声明并提供默认值
  - 必须更新本文件与 `docs/architecture.md` 的相关约束（如有影响）
- 新增工具：
  - 必须满足 ToolResult 契约
  - 必须注册到统一入口（如 `src/tools/index.ts`）
  - 必须具备失败截图与可重试语义（`retriable`）
