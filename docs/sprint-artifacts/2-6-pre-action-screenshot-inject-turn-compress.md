# Story 2.6: 动作前自动截图并注入 Agent turn（含压缩）

Status: done

## Story

As a QA 工程师,
I want 在每次浏览器动作前自动截图并作为视觉上下文提供给模型，
so that 模型可以“看着页面”做更稳健的点击/填表决策。

## Acceptance Criteria

1. **Given** Agent 即将调用任一“可能改变页面状态”的动作工具（至少包含 `navigate` / `click` / `fill`）
   **When** 工具被执行
   **Then** 系统必须在执行该动作之前捕获当前页面截图（pre-action screenshot）
   **And** 截图必须被注入到与该动作调用关联的 Agent turn 中（例如作为 tool result content 的 image block 或等效方式），以便模型在后续推理中“看见”页面状态。

2. **Given** 截图被注入到 Agent turn
   **When** 该截图被编码/传输给模型
   **Then** 截图必须进行成本控制（NFR3）：
   - 使用 `image/jpeg`（优先）与 `quality` 参数
   - 宽度应近似 1024px（推荐通过固定 viewport width 实现；若后续需要更强压缩，可评估引入缩放方案）

3. **Given** 截图捕获或压缩过程中发生错误（例如 Playwright 抛错、磁盘写入失败）
   **When** 动作工具继续执行
   **Then** 该错误不得导致进程崩溃或中断自愈闭环
   **And** 工具结果应仍返回可序列化错误信息（并在可用时附带截图；若截图不可用则明确标注缺失）。

4. **Given** 默认运行模式（非 debug）
   **When** 截图被捕获
   **Then** 默认不强制把截图落盘（避免隐私风险与磁盘膨胀），但必须能在内存中注入给模型
   **And** 在 `--debug` 或工具失败（供后续自愈）时，应能够把截图写入受控目录 `.autoqa/` 并提供可追踪引用。

5. **Given** 实现完成
   **When** 执行 `npm test`
   **Then** 应新增单元测试覆盖：pre-action screenshot 的捕获/压缩/注入路径，以及“截图失败不应导致工具 throw”的行为。

## Tasks / Subtasks

- [x] 建立截图能力（压缩策略 + 产物策略）（AC: 1-4）
  - [x] 新增 `src/browser/screenshot.ts`：提供统一的截图函数（输入 `Page`，输出 `Buffer` + 元信息）
  - [x] 明确压缩策略（MVP 推荐）：
    - [x] Runner 创建 `BrowserContext` 时固定 viewport width 约 1024px（高度按默认或配置）
    - [x] `page.screenshot({ type: 'jpeg', quality: ... })` 捕获 JPEG
  - [x] 明确落盘策略（MVP 推荐）：
    - [x] 默认不落盘，仅返回 buffer（用于注入 turn）
    - [x] debug 或失败时落盘到 `.autoqa/runs/<runId>/screenshots/**`（目录需 normalize，避免目录穿越）

- [x] 在动作工具执行前统一捕获截图并关联到 ToolResult（AC: 1, 3）
  - [x] 避免在每个工具里复制粘贴：新增共享 wrapper（可放在 tools 层或 agent adapter 层）
  - [x] 对以下工具启用 pre-action screenshot：
    - [x] `navigate`
    - [x] `click`
    - [x] `fill`
    - [x] `scroll`（建议）
    - [x] `wait`（可选；若认为不会改变页面可不做，但需在实现中给出明确理由）
  - [x] wrapper 必须保证：
    - [x] 截图失败时不 throw；工具继续执行，并返回稳定错误信息（例如附加 `SCREENSHOT_FAILED` 语义或日志字段）

- [x] 将截图注入 Agent SDK 的 turn（AC: 1, 2）
  - [x] 创建/补齐 Agent 层最小集成（当前仓库尚无 `src/agent/**`，需在本 story 建立最小骨架以承载“注入 turn”）
  - [x] 使用 `createSdkMcpServer` + `tool(...)` 将 `src/tools/*` 封装为 SDK 可用的自定义工具（tool input schema 只暴露业务字段，`page` 通过闭包注入）
  - [x] 在 MCP tool handler 内：
    - [x] 先 capture screenshot（buffer）
    - [x] 再执行动作工具
    - [x] 将 screenshot 作为 `content` 的 `image` block 回传（`source.type='base64'`, `media_type='image/jpeg'`）
    - [x] 对失败结果设置 `isError: true`（与 Agent SDK tool result 语义对齐）
  - [x] 在 `src/runner/run-specs.ts` 的 `onSpec` 回调中调用 `src/agent/run-agent.ts`（或等价入口），确保每个 spec 都会触发 Agent 推理与工具调用链（用于验证截图注入可用）

- [x] 单元测试（AC: 5）
  - [x] 新增 `tests/unit/pre-action-screenshot.test.ts`（或等价命名），通过 mock `Page.screenshot` 返回固定 buffer
  - [x] 覆盖：
    - [x] 正常路径：工具执行前捕获 screenshot，并在返回值中携带注入内容/元信息
    - [x] screenshot 报错路径：工具仍能继续执行且不 throw
    - [x] JPEG 压缩参数（type/quality）与 viewport 固定策略（如实现选择该方案）

## Dev Notes

- 分层边界（强约束）：
  - 截图基础能力放在 `src/browser/**`
  - Playwright 动作封装仍在 `src/tools/**`
  - “注入 Agent turn”的编排逻辑应放在 `src/agent/**`，避免 CLI/Runner 直接操纵 SDK 细节

- 成本控制（NFR3）优先级很高：
  - MVP 推荐用“固定 viewport width ≈1024 + JPEG quality”来实现压缩，避免引入额外图像处理依赖

- 工具结果契约对齐：
  - 内部仍遵循 `ToolResult`（`ok/data/error/screenshot?`）
  - 对接 Agent SDK 时，失败必须映射为 `isError: true`（或等价语义），且需要把 screenshot 以 image block 形式回传（供后续推理自愈）

- 安全与隐私：
  - `.autoqa/` 已在 `.gitignore` 中忽略，但默认仍应避免无必要落盘
  - `fill` 工具不回传明文 `text` 的约定必须继续保持（避免 secrets 泄露）

### Project Structure Notes

- 预计新增：
  - `src/browser/screenshot.ts`
  - `src/agent/**`（最小骨架，用于 SDK 集成与截图注入）
  - `tests/unit/pre-action-screenshot.test.ts`（或等价测试文件）

- 预计修改：
  - `src/runner/run-specs.ts`（通过 `onSpec` 集成 agent）
  - `src/cli/commands/run.ts`（传入 `onSpec`，让 run 真正执行 spec，而不是只打印 specPath）

### References

- [Source: docs/epics.md#Story 2.6]
- [Source: docs/prd.md#FR4 视觉感知循环 (Visual Perception Loop)]
- [Source: docs/prd.md#NFR3 Token 成本控制]
- [Source: docs/architecture.md#Process Patterns（截图与视觉注入）]
- [Source: docs/project_context.md#5. 截图与视觉注入（必做 + 可控成本）]
- [Source: src/tools/tool-result.ts]
- [Source: src/tools/*]
- [Source: src/runner/run-specs.ts]

## Dev Agent Record

### Context Reference

<!-- Path(s) to story context XML will be added here by context workflow -->

### Agent Model Used

Cascade

### Debug Log References

- `npm test`
- `npm run build`

### Completion Notes List

- Added JPEG screenshot capture with optional controlled disk write under `.autoqa/` (debug or tool failure)
- Added pre-action screenshot wrapper that never throws and attaches screenshot metadata to ToolResult
- Integrated Claude Agent SDK MCP tools to inject screenshot as an image content block per tool call
- Wired `autoqa run` to execute each spec via Agent + tools (runSpecs onSpec)
- Hardened screenshot disk write behavior (path segment handling, safer file permissions, avoid absolute path leakage)
- Ensured agent failures propagate (avoid CLI false positives) and improved debug stream output
- Reduced tool-result text payload size to avoid token bloat / leaking stack traces
- Added tests for screenshot/action ordering and screenshot write failure handling
- Verified `npm test` and `npm run build` pass

### File List

- `src/browser/screenshot.ts`
- `src/agent/pre-action-screenshot.ts`
- `src/agent/browser-tools-mcp.ts`
- `src/agent/run-agent.ts`
- `src/runner/run-specs.ts`
- `src/cli/commands/run.ts`
- `tests/unit/pre-action-screenshot.test.ts`
- `tests/unit/runner-spec-lifecycle.test.ts`
- `docs/sprint-artifacts/sprint-status.yaml`

## Senior Developer Review (AI)

Reviewer: Nick on 2025-12-15

### Findings Resolved

- **Fixed** Agent run could silently fail without propagating error to runner/CLI (`run-agent.ts` now fails if final result indicates error or stream ends without a final result)
- **Fixed** Screenshot path handling and disk write security:
  - block `.`/`..` path segments
  - write files with restrictive permissions
  - return controlled relative path to avoid leaking absolute local paths
- **Fixed** Token/PII risk from returning full `ToolResult` JSON (now returns summarized payload, excluding large `cause` stack traces)
- **Added** unit tests:
  - screenshot capture happens before action invocation
  - screenshot write failure does not throw and still returns a valid result

### Review Follow-ups (optional)

- Consider making JPEG `quality` configurable (CLI flag or config schema) if cost tuning becomes necessary.
- Consider structured logging for agent/tool stream output (planned in 2-7).

### Git Hygiene Note

- Several files are new/untracked and should be added before committing/creating a PR.
