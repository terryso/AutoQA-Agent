# Story 2.2: 支持 `--headless` / `--debug` / `--url` 参数与运行前校验

Status: done

## Story

As a 开发者,
I want 在 `autoqa run` 时通过参数控制运行模式与 Base URL，
so that 我能在 CI 使用无头模式，在本地使用 debug 模式观察执行。

## Acceptance Criteria

1. **Given** 用户运行 `autoqa run`
   **When** 指定 `--headless`
   **Then** Playwright 应以无头模式启动
   **And** 当指定 `--debug` 时应以有头模式启动并输出更详细日志

2. **Given** 用户运行 `autoqa run` 且未指定 `--debug`
   **When** CLI 解析参数并启动 Playwright
   **Then** Playwright 应默认以无头模式启动（无需显式 `--headless`）

3. **Given** MVP 不从 Markdown 读取 Base URL
   **When** 用户未提供 `--url`
   **Then** `autoqa run` 应以退出码 `2` 失败并提示必须提供 Base URL

4. **Given** 用户同时指定 `--headless` 与 `--debug`
   **When** CLI 解析参数
   **Then** 应以退出码 `2` 失败并提示参数冲突（必须二选一）

5. **Given** 用户提供 `--url <baseUrl>`
   **When** CLI 做运行前校验
   **Then** 应校验该 `baseUrl` 为合法的 `http(s)` URL（能被 `new URL()` 解析且 protocol 为 `http:` 或 `https:`）
   **And** 当 URL 不合法时应以退出码 `2` 失败并给出可理解的错误信息

## Tasks / Subtasks

- [x] 更新 `autoqa run` CLI flags（AC: 1-5）
  - [x] 在 `src/cli/commands/run.ts` 增加 `--url <baseUrl>`（必填）
  - [x] 增加 `--debug` 与 `--headless`（互斥；默认 headless）
  - [x] 将解析后的运行参数组织为明确的对象（例如 `RunOptions`），用于传递给 runner 层
  - [x] 任何“用户可纠正的输入错误”（缺少 `--url`、参数冲突、URL 不合法）统一使用 `program.error(..., { exitCode: 2 })`

- [x] 新增运行前校验与参数规范化（AC: 3-5）
  - [x] 引入一个纯函数（例如 `validateRunArgs()`）对 `--url/--debug/--headless` 做校验并返回结构化结果
  - [x] 建议将 `--url` 规范化为无尾斜杠的形式（例如 `http://localhost:3000/` → `http://localhost:3000`），并将最终 Base URL 作为日志字段输出

- [x] 最小 Playwright 启动验证（AC: 1-2）
  - [x] 遵守分层边界：CLI 不直接调用 Playwright API；在非 CLI 层新增封装模块（建议 `src/browser/create-browser.ts`）
  - [x] 在 `src/browser/create-browser.ts` 内部使用 `playwright.chromium.launch({ headless })` 启动浏览器
  - [x] 在 debug 模式下建议：
    - [x] `headless: false`
    - [x] 额外日志：输出 runId、baseUrl、headless/debug 值、Node/Playwright 版本（不包含任何 secrets）
    - [x] 可选：设置一个轻量的 `slowMo`（例如 50-100ms）以提升可观察性
  - [x] 在 runner 层新增一个最小的 preflight（例如 `src/runner/preflight.ts`）：启动浏览器 → 立即关闭（本 story 不执行 specs）

- [x] 单元测试（AC: 1-5）
  - [x] 更新 `tests/unit/run-args-spec-discovery.test.ts`：所有调用 `autoqa run` 的测试都补充 `--url http://example.test`（避免被新校验阻塞）
  - [x] 增加覆盖：
    - [x] 默认模式（未指定 `--debug`）应以 `headless: true` 启动
    - [x] `--debug` 应以 `headless: false` 启动
    - [x] `--headless` 显式指定时应以 `headless: true` 启动
    - [x] 缺少 `--url` → 退出码 `2` + 可理解错误
    - [x] `--headless` 与 `--debug` 同时出现 → 退出码 `2` + 参数冲突错误
    - [x] `--url` 非法（例如 `not-a-url`）→ 退出码 `2` + 可理解错误
  - [x] 测试建议：通过 `vi.mock('playwright')` 或 mock `src/browser/create-browser.ts`，避免单测真实启动浏览器

## Dev Notes

- 分层边界（强约束）：
  - `src/cli/**` 只做参数解析、错误映射与路由；禁止直接调用 Playwright（例如 `chromium.launch`、`page.click`）。
  - Playwright 启动逻辑应落在 `src/browser/**`（基础能力）并由 `src/runner/**` 调度。

- 与既有实现的关系（避免重复造轮子）：
  - spec 发现逻辑已在 `src/specs/discover.ts`，并且已有单测覆盖“递归 + 确定性排序 + symlink 行为”。
  - 本 story 不应改动 spec 发现算法；只在 `autoqa run` 中新增 flags/校验，并把结果传递给后续 runner。

- 退出码约定：
  - `2`：用户输入/配置错误（本 story：缺少 `--url`、参数冲突、URL 不合法、Playwright 启动失败等环境问题）
  - `1`：测试失败（断言失败/护栏触发，属于后续 Epic 3）
  - `0`：全部通过（本 story 仅做 preflight，不代表最终通过语义；实现时需清晰日志提示）

### Project Structure Notes

- 当前仓库已存在：
  - `src/cli/commands/run.ts`（run 命令入口，当前为 discovery-only）
  - `src/specs/discover.ts`（spec 发现）
- 本 story 预计新增：
  - `src/browser/create-browser.ts`（Playwright 启动封装）
  - `src/runner/preflight.ts`（最小启动/关闭，用于验证 headless/debug 行为）
- 注意保持 ESM import 风格（跨文件导入使用 `.js` 后缀），并与现有 CLI 模块组织方式对齐。

### References

- [Source: docs/epics.md#Story 2.2]
- [Source: docs/architecture.md#Naming Patterns（命名规范）]
- [Source: docs/architecture.md#Structure Patterns（结构与边界规范）]
- [Source: docs/architecture.md#Infrastructure & Deployment（交付与 CI）]
- [Source: docs/project_context.md#2. 分层边界（强约束）]
- [Source: src/cli/commands/run.ts]
- [Source: src/specs/discover.ts]

## Dev Agent Record

### Context Reference

<!-- Path(s) to story context XML will be added here by context workflow -->

### Agent Model Used

Cascade

### Debug Log References

- `npm test`
- `npm run build`
- `node dist/cli.js run ./specs --url http://localhost:3000`
- `node dist/cli.js run ./specs --url http://localhost:3000 --debug`

### Completion Notes List

- 为 `autoqa run` 增加 `--url/--debug/--headless` 参数解析与运行前校验；所有用户可纠正的输入错误统一使用退出码 `2`
- 新增 runner preflight：按 headless/debug 选项启动并立即关闭 Playwright 浏览器；CLI 不直接调用 Playwright
- 更新单元测试：补齐 `--url` 并新增校验/互斥/默认 headless 行为覆盖；通过 mock 避免单测真实启动浏览器
- Code review 修复：日志输出的 baseUrl 仅保留 origin（避免 userinfo/query 泄露）；debug 日志区分并输出 playwrightVersion 与 chromiumVersion；补充单测覆盖 URL 规范化与校验失败不触发 preflight

### File List

- `src/cli/commands/run.ts`
- `src/runner/validate-run-args.ts`
- `src/runner/preflight.ts`
- `src/browser/create-browser.ts`
- `tests/unit/run-args-spec-discovery.test.ts`
- `docs/sprint-artifacts/sprint-status.yaml`
