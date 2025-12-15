# Story 2.7: 运行日志与可观测性（控制台输出 + 结构化字段）

Status: done

## Story

As a 开发者,
I want `autoqa run` 输出清晰且可追踪的运行日志（包含 spec/步骤/工具/错误上下文），
so that 我能在本地与 CI 中快速定位失败原因。

## Acceptance Criteria

1. **Given** 用户运行 `autoqa run`
   **When** Runner 开始本次 run（完成参数校验与 spec 发现之后、执行第一个 spec 之前）
   **Then** CLI 必须输出本次 `runId`（保持现有 `runId=<uuid>` 形式）
   **And** CLI 必须输出本次运行产物根目录路径（推荐与现有截图产物一致：`.autoqa/runs/<runId>/`）
   **And** CLI 必须输出用于机器解析的最小运行元信息：`baseUrl`（仅 origin）、`headless`、`debug`。

2. **Given** `autoqa run` 在本次 run 中执行多个 specs
   **When** 每个 spec 开始与结束
   **Then** 必须产生可机器解析的结构化日志事件（JSON 行，使用 `pino`）
   **And** 每条事件至少包含字段：
   - `event`（例如 `autoqa.spec.started` / `autoqa.spec.finished`）
   - `runId`
   - `specPath`
   - `timestamp`（由 logger 自动提供即可）
   **And** `autoqa.spec.finished` 必须包含该 spec 是否失败与失败原因摘要（若失败）。

3. **Given** Agent 在执行 spec 过程中调用浏览器工具（`navigate/click/fill/scroll/wait`）
   **When** MCP tool handler 开始执行与返回结果
   **Then** 必须产出结构化日志事件（JSON 行，`pino`）用于追踪工具调用链
   **And** 每条工具事件必须包含字段：
   - `event`（例如 `autoqa.tool.called` / `autoqa.tool.result`，或合并为单事件）
   - `runId`
   - `specPath`
   - `toolName`
   - `toolDurationMs`
   - `toolInput`（必须裁剪/脱敏）
   - `stepIndex`（若实现了步骤标记/解析；否则允许为 `null`，但必须预留字段）
   **And** 当工具失败时必须包含：`error.code`、`error.message`、`error.retriable`。

4. **Given** 工具调用链包含截图相关信息（pre-action screenshot / 写盘路径）
   **When** 截图成功或失败
   **Then** 日志必须能追踪截图状态：
   - 成功：包含 `screenshot.mimeType/width/height`，以及（若写盘）受控相对路径（例如 `.autoqa/runs/<runId>/screenshots/...`）
   - 失败：包含 `screenshotError`（或等价字段）
   **And** 日志不得泄露任何绝对本机路径。

5. **Given** 运行过程中存在潜在敏感信息（URL 凭证、query token、fill 输入等）
   **When** 记录 `baseUrl` / `toolInput` / 错误上下文
   **Then** 日志必须执行脱敏/裁剪：
   - `baseUrl`：仅记录 `origin`（与现有实现一致）
   - `fill`：不得记录明文 `text`，只能记录 `textLength`（或继续沿用现有 `text_len` 语义）
   - 其他字段：对过长文本进行截断（例如最大 400 chars），并避免输出潜在 secrets

6. **Given** `autoqa run` 运行结束
   **When** 进程退出
   **Then** 退出码必须保持清晰区分：
   - `2`：用户输入/配置/文件结构错误（如缺少 `--url`、spec 不合法、路径不可访问）
   - `1`：spec 执行失败（例如 runner 返回 `SPEC_EXECUTION_FAILED`）
   - `0`：全部通过
   **And** 必须产出最终的 `autoqa.run.finished`（或等价）结构化事件，包含 `exitCode` 与失败汇总（若有）。

## Tasks / Subtasks

- [x] 定义可观测性事件与字段契约（AC: 2-6）
  - [x] 事件名（建议）：`autoqa.run.started/spec.started/tool.called/tool.result/spec.finished/run.finished`
  - [x] 统一字段：`runId/specPath/stepIndex/toolName/toolDurationMs/error.*`
  - [x] 明确哪些字段必须脱敏/裁剪（与 `fill`/URL 规则一致）

- [x] 建立结构化日志基础设施（pino）（AC: 2-6）
  - [x] 新增 `src/logging/**`（例如 `logger.ts` / `redact.ts`）
  - [x] 默认将 JSON 行日志写入 `.autoqa/runs/<runId>/run.log.jsonl`（推荐）
  - [x] 可选：debug 模式同时输出到 stderr（或保持现有 key=value 行 + debug stream）

- [x] 在 `autoqa run` 入口输出运行元信息与产物根目录（AC: 1）
  - [x] 保持现有 `runId=...` / `baseUrl=...` / `headless=...` / `debug=...` 输出形式不变
  - [x] 新增 `artifactRoot=.autoqa/runs/<runId>`（或等价）输出
  - [x] 在 run 开始时确保 `.autoqa/runs/<runId>/` 目录创建成功（避免“输出了路径但目录不存在”）

- [x] 记录 spec 生命周期事件（AC: 2, 6）
  - [x] 在 `src/runner/run-specs.ts` 为每个 spec 记录 started/finished（含 duration、ok/failed）
  - [x] 在失败时补充最小可定位信息（specPath + failure code）

- [x] 记录工具调用与结果事件（AC: 3-5）
  - [x] 在 `src/agent/browser-tools-mcp.ts` 中为每个 tool handler 增加计时与结构化日志
  - [x] `toolInput` 必须按工具类型脱敏：
    - [x] `fill`：仅 `textLength`
    - [x] `navigate`：禁止记录包含凭证的完整 URL（建议只记录 relative/absolute + 归一化后的 path 摘要）
    - [x] `click`：截断 `targetDescription`

- [x] 单元测试（AC: 1-6）
  - [x] 覆盖 `artifactRoot` 输出存在
  - [x] 覆盖结构化日志包含关键字段（run/spec/tool）
  - [x] 覆盖脱敏规则：不得出现 `fill.text` 明文、不得出现 URL 凭证/敏感 query

## Dev Notes

- 分层边界（强约束）：
  - `src/cli/**` 只做参数解析与输出；不要直接调用 Playwright
  - `src/runner/**` 负责 spec 生命周期；适合产出 `spec.started/spec.finished`
  - `src/agent/**` 负责 SDK 集成；适合产出与 agent/tool 相关事件
  - `src/tools/**` 只封装 Playwright 动作/断言；工具失败不得 throw

- 现有实现与约束（避免重复造轮子/破坏契约）：
  - `runId` 已在 `src/cli/commands/run.ts` 生成并输出到 stderr
  - `baseUrl` 已做 origin-only 脱敏（`sanitizeBaseUrlForLog`），请复用该策略
  - 截图产物目录已固定为 `.autoqa/runs/<runId>/screenshots/**`（见 `src/browser/screenshot.ts` / `src/agent/pre-action-screenshot.ts`）
  - `fill` 工具日志已避免输出明文输入（仅 `text_len`），结构化日志必须保持该安全性

- stdout/stderr 约定（避免影响现有 CLI 行为与测试）：
  - `stdout` 当前用于输出 specPath 列表（见 `tests/unit/run-args-spec-discovery.test.ts`）；不要把日志混入 stdout
  - 结构化日志建议写入文件 + stderr（或至少 stderr），保持 stdout 干净

### Project Structure Notes

- 预计新增：
  - `src/logging/logger.ts`（pino 初始化/写盘 destination）
  - `src/logging/redact.ts`（脱敏/截断工具）

- 预计修改：
  - `src/cli/commands/run.ts`（输出 artifactRoot + run.started/run.finished 事件）
  - `src/runner/run-specs.ts`（spec 生命周期事件 + duration）
  - `src/agent/run-agent.ts`（可选：步骤标记解析以补齐 `stepIndex`，或提供与 logger 的集成点）
  - `src/agent/browser-tools-mcp.ts`（tool 计时 + 结构化事件 + 脱敏）

### References

- [Source: docs/epics.md#Story 2.7]
- [Source: docs/architecture.md#可观测性（结构化日志 + 事件流）]
- [Source: docs/project_context.md#7. 可观测性（结构化日志 + 事件流）]
- [Source: src/cli/commands/run.ts]
- [Source: src/runner/run-specs.ts]
- [Source: src/agent/browser-tools-mcp.ts]
- [Source: src/agent/run-agent.ts]
- [Source: src/browser/screenshot.ts]
- [Source: docs/sprint-artifacts/2-6-pre-action-screenshot-inject-turn-compress.md]

## Dev Agent Record

### Context Reference

<!-- Path(s) to story context XML will be added here by context workflow -->

### Agent Model Used

Cascade

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- Implemented structured logging infrastructure with pino (src/logging/*)
- Added run.started/run.finished events in CLI with artifactRoot output
- Added spec.started/spec.finished events in runner with duration tracking
- Added tool.called/tool.result events in browser-tools-mcp with timing
- Implemented redaction for fill text (textLength only), URL credentials, and long strings
- Screenshot paths sanitized to relative paths only
- All 86 unit tests passing

### File List

- `src/logging/types.ts` (new)
- `src/logging/logger.ts` (new)
- `src/logging/redact.ts` (new)
- `src/logging/index.ts` (new)
- `src/cli/commands/run.ts` (modified)
- `src/runner/run-specs.ts` (modified)
- `src/agent/run-agent.ts` (modified)
- `src/agent/browser-tools-mcp.ts` (modified)
- `tests/unit/logging-logger.test.ts` (new)
- `tests/unit/logging-redact.test.ts` (new)
- `tests/unit/runner-spec-lifecycle.test.ts` (modified)

### Change Log

- Code review fixes: use pino destination/multistream for jsonl logging (per-instance flush, remove global pending writes), standardize `timestamp` field, remove unused imports/params, and verify `npm test` / `npm run build` pass

## Senior Developer Review (AI)

### Outcome

Approve

### Findings

- **HIGH** `createLogger()` 未真正使用 pino 的 destination 写盘，且使用全局 pending write 队列导致并发/多实例冲突风险。
- **HIGH** 时间戳字段契约不一致（types 使用 `timestamp?`，实际写盘使用 `time`），会影响日志解析与后续报表。
- **MEDIUM** 存在未使用 import/参数（例如 `run.ts` 中未使用的 `Logger` 类型导入、runner options 中未使用的 `cwd`）。

### Fixes Applied

- `src/logging/logger.ts` 改为使用 `pino.destination()` 写入 `.autoqa/runs/<runId>/run.log.jsonl`，debug 模式通过 `pino.multistream()` 同时输出到 stderr；flush 为每个 logger 实例独立实现。
- 保持日志时间戳字段为 `timestamp`（由 logger 自动提供），并同步更新单元测试断言。
- 清理冗余导入/参数（移除 `runSpecs` 的 `cwd` 参数、移除 `run.ts` 未使用的类型导入）。
- 验证 `npm test` 与 `npm run build` 均通过。
