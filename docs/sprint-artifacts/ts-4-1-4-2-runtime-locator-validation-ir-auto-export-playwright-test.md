# Epic 4: 沉淀与导出（从自然语言执行到 Playwright Test）- Tech Spec（Story 4.1 / 4.2）

Status: draft

## Goals

- 在 Agent 成功执行动作后，记录结构化动作 IR（便于复现与导出）。
- 对 `click/fill` 等“命中具体元素”的动作，在运行时生成多种稳定 locator 候选，并进行无副作用验证。
- 仅沉淀验证通过的 locator 候选，避免将不稳定的定位方式（例如会话内 `ref`）带入导出。
- `autoqa run` 结束后自动导出可运行的 `@playwright/test` 测试文件到 `tests/autoqa/`。
- 导出代码中的断言仅来源于 spec 的断言步骤。

## Non-goals

- 不依赖 Playwright MCP 的推荐代码（例如 `page.locator(...)`）作为导出输入。
- 不将会话内的 `ref` 写入导出代码（`ref` 仅允许作为运行时执行/自愈辅助信息）。
- 不从运行时观察自动发明断言（禁止“看到什么就 expect 什么”）。
- 本阶段不解决 secrets 在导出代码中的脱敏/参数化（可后续扩展）。

## User-facing Behavior

- `autoqa run <specOrDir> --url <baseUrl>`
  - 运行过程中持续记录动作 IR。
  - 每个 spec 执行结束后：
    - 若 IR 可导出（关键动作均具备可用的稳定 locator），则自动生成 `@playwright/test` 文件到 `tests/autoqa/`。
    - 若无法导出（例如关键动作缺少任何通过验证的 locator 候选），则该 spec 的导出失败并输出清晰原因（不生成不完整测试文件）。

## Artifacts Layout

- 运行时产物建议落盘到：`.autoqa/<runId>/`
  - `ir.jsonl`：动作记录（每条动作一行 JSON）
  - `export/`：导出阶段的中间产物（可选）
  - `logs/`、`screenshots/`：沿用既有约定（若已有）

说明：导出的 Playwright Test 文件固定输出到 `tests/autoqa/`。

## IR Schema (Draft)

每条动作记录（ActionRecord）建议包含：

- `runId: string`
- `specPath: string`
- `stepIndex: number`
- `stepText: string`
- `toolName: 'navigate' | 'click' | 'fill' | 'scroll' | 'wait' | 'assertTextPresent' | 'assertElementVisible'`
- `toolInput: Record<string, unknown>`（用于导出/调试；对敏感字段允许只存长度或标记）
- `outcome: { ok: boolean; errorCode?: string; errorMessage?: string }`
- `pageUrl?: string`
- `element?: {
    fingerprint: ElementFingerprint;
    locatorCandidates: LocatorCandidate[];
    chosenLocator?: LocatorCandidate;
  }`

其中 `element` 仅在“命中具体元素”的动作（如 `click/fill`）存在。

### ElementFingerprint (Draft)

用于判断“候选 locator 命中的元素是否与实际命中元素一致”，建议字段：

- `tagName?: string`
- `role?: string`
- `accessibleName?: string`
- `id?: string`
- `nameAttr?: string`
- `typeAttr?: string`
- `placeholder?: string`
- `ariaLabel?: string`
- `testId?: string`（如 `data-testid`/`data-test` 等）
- `textSnippet?: string`（短文本，截断）

### LocatorCandidate (Draft)

- `kind: 'getByTestId' | 'getByRole' | 'getByLabel' | 'getByPlaceholder' | 'cssId' | 'cssAttr' | 'text'`
- `value: string`（例如 testId/name/label 文本；或 css selector）
- `code: string`（用于导出的代码片段，例如 `page.getByRole('button', { name: 'Login' })`）
- `validation: {
    unique: boolean;
    visible?: boolean;
    enabled?: boolean;
    editable?: boolean;
    fingerprintMatch?: boolean;
  }`

## Locator Candidate Generation

对 `click/fill` 的“实际命中元素”，生成候选 locator（按优先级）：

1. `getByTestId`（若存在 `data-testid` 或等价字段）
2. `getByRole` + `name`（若 role 与 accessibleName 可稳定获得）
3. `getByLabel`（主要面向输入框）
4. `getByPlaceholder`（主要面向输入框）
5. `cssId`（`#id`）
6. `cssAttr`（例如 `[name="..."]`、`[aria-label="..."]`，仅当足够稳定且唯一时）
7. `text`（作为低优先级兜底，仅适用于按钮/链接等且文本稳定）

说明：候选生成必须基于运行时可观测的稳定属性，不依赖一次性 snapshot 的 `ref`。

## No-side-effect Validation

对每个候选 locator 执行无副作用验证（不得点击/输入/提交）：

- **唯一性**：`locator.count() === 1`
- **可用性**：
  - click：目标应 `visible` 且（若可判定）`enabled`
  - fill：目标应 `visible` 且 `editable`
- **一致性**：候选命中的元素应与实际命中元素的 `ElementFingerprint` 匹配（核心字段一致或符合容错规则）

验证通过的候选才允许写入 IR；验证失败的候选可以记录简要摘要以便 debug，但不得用于导出。

## Export Generation (`@playwright/test`)

- 输出目录：`tests/autoqa/`
- 文件命名：以 spec 文件名为基准生成 `*.spec.ts`（需要保证可重复与可预测）

### 基本结构

- `import { test, expect } from '@playwright/test'`
- 每个 spec 对应一个 `test(...)`
- `test` 开始处执行 `await page.goto(baseUrl)`（或由导出器按 IR 中首个 `navigate` 决定）

### 动作导出

- 对 `click/fill`：必须使用 `chosenLocator` 生成代码。
- 若某动作缺少 `chosenLocator`：该 spec 导出失败（不生成不完整文件）。

### 断言导出（仅来自 spec）

- 只把 spec 中显式标注为 assertion 的步骤转为 `expect(...)`。
- 不允许从运行时页面信息推断并生成额外断言。

## Failure Behavior

- locator 候选验证失败：
  - 不影响 agent 继续执行（仍以 best-effort 跑通）。
  - 仅影响“导出可用性”。
- 导出阶段失败：
  - 必须输出清晰错误（包含 `specPath` 与失败原因摘要）。
  - 不生成部分/不可运行的测试文件。

## Security Notes

- `fill` 的运行日志与 IR 中的 `toolInput` 默认不记录明文敏感值（例如密码），可仅记录长度或标记。
- 导出代码会包含 spec 中的字面量（本阶段不做 secrets 参数化）。

## References

- [Source: docs/epics.md#Epic 4]
- [Source: docs/sprint-artifacts/2-5-playwright-action-tools-toolresult.md]
