# Story 3.2: 工具/断言失败回流到 Agent SDK 触发自愈重试

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a QA 工程师,
I want 当任一浏览器动作工具或断言工具失败时，将失败以 `is_error: true` 的语义回流给 Claude Agent SDK（包含错误信息与失败时的上下文），
so that 模型可以在同一个 step 内继续推理并尝试自愈重试，而不是让整个 spec 直接崩溃或提前失败。

## Acceptance Criteria

1. **Given** 任一动作工具或断言工具返回 `ok: false`
   **When** MCP 层将结果反馈给 Claude Agent SDK
   **Then** MCP tool result 必须设置 `isError: true`（使 SDK 产生 `tool_result.is_error = true` 并进入下一轮推理）
   **And** tool result 的文本内容必须包含 ToolResult 的关键字段摘要：`error.code`、`error.message`、`error.retriable`

2. **Given** 工具执行失败且 `AUTOQA_TOOL_CONTEXT=screenshot`
   **When** 系统成功采集到截图
   **Then** 反馈中必须包含失败截图上下文（至少包含 `ToolResult.screenshot` 元信息；如需视觉输入，建议仅在失败时附带 image block）

3. **Given** Tools 层或 MCP 层内部遇到 Playwright 异常（含 Timeout）
   **When** 工具处理失败
   **Then** 不得抛出未捕获异常导致 Runner 直接失败
   **And** 必须转换为 `{ ok: false, error: { code, message, retriable } }` 并按 AC1 回流

4. **Given** 失败结果回流后进入下一轮推理
   **When** Agent 选择重试/替代路径
   **Then** 同一 spec 应继续执行（直到最终成功、护栏触发或 Agent 最终结果为 `is_error`）

## Tasks / Subtasks

- [ ] 统一错误回流通路（AC: 1, 3）
  - [ ] 复核 Tools 层：所有 `src/tools/**` 的 Playwright 异常均通过 `toToolError(...)` 转换并 `return fail(...)`（不得 throw 泄漏）
  - [ ] 复核 MCP 层：`src/agent/browser-tools-mcp.ts` 中所有 tools（navigate/click/fill/select_option/scroll/wait/assertTextPresent/assertElementVisible）在 `result.ok === false` 时均 `return { ..., isError: true }`
  - [ ] 特别检查 `ref` 分支：click/fill/select_option/assertElementVisible 的 ref 直连 Playwright 路径也必须按 ToolResult 失败返回（不得 throw）

- [ ] 失败上下文与截图策略（AC: 2）
  - [ ] 明确 “失败截图” 的回流策略：
    - [ ] 默认通过 `ToolResult.screenshot` 回传元信息（mimeType/width/height/path）
    - [ ] 如需多模态视觉输入：在 `browser-tools-mcp.ts` 中仅在失败时把 `runWithPreActionScreenshot(...).meta.imageBlock` 加入 MCP `content`（避免成功路径 token 成本爆炸）
  - [ ] 保持与现有产物策略一致：
    - [ ] 按 `AUTOQA_TOOL_CONTEXT` 控制是否采集 screenshot/snapshot
    - [ ] 按 `AUTOQA_ARTIFACTS=all|fail|none` 控制是否落盘

- [ ] 单元测试（AC: 1-4）
  - [ ] 新增或补齐 MCP 层单测（建议新增 `tests/unit/agent-mcp-error-mapping.test.ts`）：
    - [ ] 工具失败时 `isError=true`，且 content 中包含 `error.code`（机器可处理）
    - [ ] screenshot 捕获失败时不会 throw，content 追加 `SCREENSHOT_FAILED: ...` 提示
    - [ ] ref 不存在/不可用时返回 `ELEMENT_NOT_FOUND` 并可重试（retriable=true）

## Dev Notes

- 分层边界（强约束）：
  - Tools 层封装在 `src/tools/**`，只负责 Playwright 动作/断言并返回 `ToolResult`
  - MCP 注册与 `isError` 映射在 `src/agent/browser-tools-mcp.ts`
  - `src/runner/**` 只负责生命周期，禁止直接调用 Playwright API

- ToolResult / 错误模型（一致性关键点）：
  - ToolResult 形状见 `src/tools/tool-result.ts`
  - 错误码与 retriable 语义见 `src/tools/playwright-error.ts` 与 `docs/project_context.md#4. ToolResult / 错误处理契约`
  - MCP 层向 SDK 回流时，失败必须通过 `isError: true` 触发下一轮推理（对应 SDK 侧 `tool_result.is_error`）

- Token 成本与隐私：
  - 保持 `summarizeToolResult(...)` 的 “短摘要” 设计，不要把 stack/页面全文塞回模型
  - debug 日志与 toolInput 必须走 `redactToolInput(...)`，不要把 `text/targetDescription/ref` 原样输出（参见上一条 story 的 review 风险提示）

### Project Structure Notes

- 预计修改：
  - `src/agent/browser-tools-mcp.ts`（统一 isError 映射；按需注入失败 screenshot 的 image block）
  - （可选）`src/agent/pre-action-screenshot.ts`（如需调整截图注入策略/返回结构）

- 预计新增：
  - `tests/unit/agent-mcp-error-mapping.test.ts`（建议）

### References

- [Source: docs/epics.md#Story 3.2]
- [Source: docs/architecture.md#Format Patterns（数据契约/返回格式）]
- [Source: docs/architecture.md#Process Patterns（流程与护栏）]
- [Source: docs/project_context.md#4. ToolResult / 错误处理契约]
- [Source: docs/project_context.md#6. 自愈护栏（必须有上限）]
- [Source: src/agent/browser-tools-mcp.ts]
- [Source: src/agent/pre-action-screenshot.ts]
- [Source: src/agent/run-agent.ts]
- [Source: src/tools/tool-result.ts]
- [Source: src/tools/playwright-error.ts]

## Dev Agent Record

### Agent Model Used

Cascade

### Debug Log References

### Completion Notes List

- ✅ MCP 工具在失败时回流 `isError: true`，并仅在失败时注入 screenshot `image` block（降低成功路径 token 成本）
- ✅ 新增 MCP 错误映射回归单测：覆盖 `isError`/`error.code` 回流与失败注入 image block

### File List

- `src/agent/browser-tools-mcp.ts` (修改: 失败时注入 image block)
- `tests/unit/agent-mcp-error-mapping.test.ts` (新增: MCP 错误映射回归测试)
