# Epic 2: 执行闭环（结构化快照 + trace）- Tech Spec（Story 2.8 / 2.9）

Status: draft

## Goals

- 提供结构化页面表示（AX/ARIA snapshot），作为比截图更高效的页面理解输入。
- 录制 Playwright trace 作为可回放调试产物，支持失败复现与定位。
- 与现有运行产物目录（建议 `.autoqa/<runId>/`）对齐，做到“可发现、可追溯、可复用”。

## Non-goals

- 不要求在每次动作前把“完整的、未截断的” AX/ARIA snapshot 原文全部注入到 Agent turn（避免 token 暴涨）；允许以“截断/聚焦快照 + 落盘路径”的形式提供。
- trace 不作为导出 `@playwright/test` 的必需输入（导出只依赖 IR + locator 候选），但 trace 本身作为运行产物是必需的。
- 不要求实现基于 AX tree 的自动定位策略（可作为后续优化点）。

## Default Policy

- **AX/ARIA snapshot**：
  - 默认策略：每次动作工具调用前采集，并作为主要感知上下文提供给模型（文本形式，允许截断/聚焦）。
  - 失败/诊断时：额外落盘完整快照（以及必要时的压缩截图兜底）。

- **Playwright trace**：
  - 默认策略：按 spec 生命周期录制，并作为运行产物保留（至少每个 spec 生成一个 trace 文件）。
  - 后续可扩展：提供保留策略开关（例如 `on-failure`），用于控制产物体积。

## Artifacts Layout

建议统一归档到：`.autoqa/<runId>/`

- `snapshots/`
  - `<specName>/`
    - `step-<index>-<toolName>.aria.yaml`（可读文本）
    - `step-<index>-<toolName>.ax.json`（结构化 JSON，便于机器处理）

- `traces/`
  - `<specName>.zip`（Playwright trace）

- `ir.jsonl`
  - Epic 4 的动作 IR（与本 Epic 的产物互相引用路径即可）

## AX / ARIA Snapshot Format

### 1) 可读文本（ARIA snapshot）

- 建议格式：YAML
- 采集方式（实现阶段可选其一）：
  - `page.locator('body').ariaSnapshot()`（YAML 文本）
  - 或对关键区域 locator 做 `ariaSnapshot()`（更小、更聚焦）

### 2) 结构化 JSON（AX snapshot）

- 建议使用 `page.accessibility.snapshot()` 的结果（JSON tree）
- 说明：JSON 更适合后续做“候选 locator 生成/验证”与 diff。

## Capture Triggers

建议在以下事件触发“落盘完整快照/补充诊断信息”（每次动作前的快照采集属于常规流程，不在此列）：

- 工具执行失败（`ToolResult.ok === false`）
- 同一步骤内出现多次重试或连续错误（护栏将触发前）
- 断言失败
- 导出失败（定位器缺失/验证不通过导致不可导出）

可选增强（未来）：

- 每次 `click/fill` 成功后采集一次（用于后续定位器候选生成/指纹增强）

## Trace Recording Spec Lifecycle Integration

在 Runner 的 spec 生命周期内：

- spec start：`context.tracing.start({ screenshots: true, snapshots: true, sources: true })`
- spec end：`context.tracing.stop({ path: '.autoqa/<runId>/traces/<specName>.zip' })`

说明：trace 应由 Runner 负责（`src/runner`），避免 `src/tools` 侧各自控制导致碎片化。

## CLI / Config Surface（Draft）

本阶段建议先不引入复杂参数，先与现有 `--debug` 语义绑定；trace 默认开启且保留：

- `--debug`：
  - 输出更频繁/更完整的快照
  - 输出更详细的 trace/快照产物路径

后续可扩展（非本阶段必需）：

- `--trace=on-failure|always`
- `--snapshot=on-failure|always`

## Logging & Discoverability

- 在失败时，CLI 应输出：
  - `specPath`
  - `runId`
  - `tracePath`（若存在）
  - `snapshotDir`（若存在）

- 在 debug 模式下，可在每次失败的工具结果中附带：
  - `SNAPSHOT_PATH: ...`
  - `TRACE_PATH: ...`（仅在 spec end 才确定最终路径也可）

## Relationship to Epic 4 (IR + Export)

- IR 中可选记录：
  - `snapshotPath?`
  - `tracePath?`

用途：

- 便于导出失败/定位失败时，从 IR 直接跳转到对应快照/trace。
- 但 **导出 Playwright Test 代码不依赖 snapshot/trace**（避免耦合与不确定性）。

## Failure Behavior

- 快照采集失败：不得影响 spec 主流程（仅记录 debug 日志）。
- trace 录制失败：不得影响 spec 主流程（仅记录 debug 日志）。

## Security Notes

- 快照/trace 可能包含页面敏感信息；本方案将 trace 作为必需运行产物默认保留，使用方需自行评估敏感风险。
- 后续可通过增加保留策略开关（例如 `--trace=on-failure|always`、`--snapshot=on-failure|always`）降低敏感暴露与产物体积。
- 产物目录建议在 `.gitignore` 中忽略（如果后续新增）。

## References

- [Source: docs/epics.md#Epic 2]
- [Source: Playwright docs - aria snapshots]
- [Source: Playwright docs - trace viewer]
