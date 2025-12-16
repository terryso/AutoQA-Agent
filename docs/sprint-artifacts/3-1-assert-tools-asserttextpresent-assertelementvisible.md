# Story 3.1: 实现断言工具（`assertTextPresent` / `assertElementVisible`）

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a QA 工程师,
I want 通过断言工具表达“页面应该包含某段文本 / 某个元素应该可见”，
so that 系统可以自动判定验收是否通过，并在失败时把错误回流给 Agent 触发自愈重试闭环。

## Acceptance Criteria

1. **Given** Agent 调用 `assertTextPresent(text)`
   **When** 页面包含目标文本
   **Then** 断言应返回 `ok: true`
   **And** ToolResult 必须可序列化、字段满足项目 ToolResult 契约

2. **Given** Agent 调用 `assertTextPresent(text)`
   **When** 页面不包含目标文本
   **Then** 断言应返回 `ok: false`
   **And** 必须带有可机器处理的 `error.code`（建议使用 `ASSERTION_FAILED`）

3. **Given** Agent 调用 `assertElementVisible(description)`
   **When** 页面存在并可见目标元素
   **Then** 断言应返回 `ok: true`

4. **Given** Agent 调用 `assertElementVisible(description)`
   **When** 元素不存在或不可见
   **Then** 断言应返回 `ok: false`
   **And** 必须带有可机器处理的 `error.code`（建议使用 `ASSERTION_FAILED`）
   **And** `error.retriable` 应设置为 `true`（允许模型通过等待/重新定位/替代路径自愈；护栏由后续 story 统一约束）

5. **Given** 断言工具内部调用 Playwright API（例如 `locator.count()`/`locator.isVisible()`）
   **When** Playwright 抛出异常（含 Timeout）
   **Then** 工具不得 `throw` 终止进程
   **And** 必须返回 `{ ok: false, error: { code, message, retriable } }`

6. **Given** 断言工具已实现
   **When** Agent 通过 MCP 工具面调用断言（toolName：`assertTextPresent` / `assertElementVisible`）
   **Then** MCP 层必须把失败映射为 `isError: true`（使 SDK 进入下一轮推理）
   **And** `run-agent.ts` 的 `allowedTools` 与 prompt 工具列表必须包含上述断言工具

7. **Given** 实现完成
   **When** 执行 `npm test`
   **Then** 必须新增单元测试覆盖：成功/失败、错误码、以及“工具不抛异常”的行为

## Tasks / Subtasks

- [ ] 扩展错误码（AC: 2, 4, 5）
  - [ ] 在 `src/tools/playwright-error.ts` 的 `ToolErrorCode` union 中加入 `ASSERTION_FAILED`
  - [ ] 明确 `ASSERTION_FAILED` 的 `retriable` 语义（建议 `true`）

- [ ] 实现断言工具（Tools 层）（AC: 1-5）
  - [ ] 新增 `src/tools/assertions/assert-text-present.ts`
    - [ ] 输入：`{ page, text }`
    - [ ] 成功：返回 `{ ok: true, data: { textLength } }`（避免回传超长文本）
    - [ ] 失败：返回 `{ ok: false, error: { code: 'ASSERTION_FAILED', message, retriable: true } }`
  - [ ] 新增 `src/tools/assertions/assert-element-visible.ts`
    - [ ] 输入：`{ page, targetDescription }`（语义描述定位）
    - [ ] 复用/对齐 `src/tools/click.ts` 的语义定位策略（role/text/fuzzy/attribute selectors + pickFirstMatch），但不得产生点击副作用
    - [ ] 失败同样返回 `ASSERTION_FAILED`（retriable: true）
  - [ ] 更新 `src/tools/index.ts` 导出断言工具与类型

- [ ] MCP 集成（Agent 层）（AC: 6）
  - [ ] 在 `src/agent/browser-tools-mcp.ts` 注册 MCP tools：`assertTextPresent` / `assertElementVisible`
    - [ ] 复用现有 `logToolCall` / `logToolResult` 事件结构
    - [ ] 复用 `runWithPreActionScreenshot(...)` 的 wrapper（保持与其他 tools 一致的截图/产物策略；由 `AUTOQA_TOOL_CONTEXT` 控制成本）
    - [ ] 返回 content 时保持 token 友好（沿用 `summarizeToolResult(...)`，避免返回大段 page 文本/stack）
    - [ ] 对失败结果设置 `isError: true`
    - [ ] （可选但推荐）支持 `ref`：
      - schema 增加 `ref?: string`（与 click/fill 保持一致）
      - ref 存在时使用 `resolveRefLocator(ref)` 做可见性断言
  - [ ] 更新 `src/agent/run-agent.ts`
    - [ ] prompt 中 “Use ONLY the provided browser tools (...)” 列表加入断言工具
    - [ ] `allowedTools` 加入：`mcp__browser__assertTextPresent`、`mcp__browser__assertElementVisible`

- [ ] 单元测试（AC: 7）
  - [ ] 新增 `tests/unit/tools-assertion-tools.test.ts`（或并入既有 `tools-action-tools.test.ts`）
    - [ ] `assertTextPresent`：文本存在 → ok=true；不存在 → ok=false + ASSERTION_FAILED
    - [ ] `assertElementVisible`：元素可见 → ok=true；不存在/不可见 → ok=false + ASSERTION_FAILED
    - [ ] timeout → code=TIMEOUT（由 `toToolError` 映射），且不 throw
  - [ ] （可选）增加最小回归测试，确保 `run-agent.ts` 的 `allowedTools` 包含断言 toolName（避免集成遗漏）

## Dev Notes

- 分层边界（强约束）：
  - 断言的 Playwright 封装必须放在 `src/tools/**`（建议 `src/tools/assertions/**`）
  - MCP tool 注册与“isError 语义”映射必须放在 `src/agent/**`
  - `src/cli/**` 与 `src/runner/**` 禁止直接调用 Playwright API

- ToolResult / 错误模型（一致性关键点）：
  - 断言失败不得 `throw`；必须返回 `ToolResult` 失败分支
  - `error.code` 必须稳定、可机器处理（本 story 推荐新增 `ASSERTION_FAILED`）
  - 断言失败建议 `retriable: true`，以便后续 story（3.2/3.3）统一实现自愈与护栏

- 语义定位（避免重复造轮子）：
  - `assertElementVisible` 不要重新发明一套定位器；优先复用 `src/tools/click.ts` 已实现的“语义描述 → Locator”策略（role/text/fuzzy/属性选择器 + pickFirstMatch）
  - 如果需要抽取公共逻辑，优先新增 `src/tools/locator-heuristics.ts` 并让 `click`/`assertElementVisible` 共用（避免复制粘贴漂移）

- Token/隐私与可观测性：
  - 断言工具的 `data` 应保持短小（建议只返回 `textLength`、`targetDescription` 等摘要信息）
  - MCP 返回内容沿用 `summarizeToolResult(...)`，避免把完整 stack 或大段文本塞回模型
  - 日志字段由 `browser-tools-mcp.ts` 统一输出（`autoqa.tool.called` / `autoqa.tool.result`），`redactToolInput(...)` 会截断过长字符串

### Project Structure Notes

- 预计新增：
  - `src/tools/assertions/assert-text-present.ts`
  - `src/tools/assertions/assert-element-visible.ts`
  - `tests/unit/tools-assertion-tools.test.ts`

- 预计修改：
  - `src/tools/index.ts`
  - `src/tools/playwright-error.ts`（新增 `ASSERTION_FAILED`）
  - `src/agent/browser-tools-mcp.ts`（注册 MCP tools）
  - `src/agent/run-agent.ts`（允许工具 + prompt 列表）

### References

- [Source: docs/epics.md#Story 3.1]
- [Source: docs/architecture.md#Format Patterns（数据契约/返回格式）]
- [Source: docs/architecture.md#Structure Patterns（结构与边界规范）]
- [Source: docs/project_context.md#4. ToolResult / 错误处理契约]
- [Source: src/tools/tool-result.ts]
- [Source: src/tools/click.ts]
- [Source: src/agent/browser-tools-mcp.ts]
- [Source: src/agent/run-agent.ts]

## Dev Agent Record

### Agent Model Used

Cascade

### Debug Log References

- `npm test`
- `npm run build`

### Completion Notes List

### File List

- `docs/sprint-artifacts/3-1-assert-tools-asserttextpresent-assertelementvisible.md`
