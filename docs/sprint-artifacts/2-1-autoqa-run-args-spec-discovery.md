# Story 2.1: 实现 `autoqa run` 的输入参数与 spec 发现

Status: done

## Story

As a 开发者,
I want 使用 `autoqa run <file-or-dir>` 运行单文件或目录下的 specs，
so that 我可以把 AutoQA 接入本地与 CI 流程中。

## Acceptance Criteria

1. **Given** 用户传入的路径为一个 Markdown 文件或包含 Markdown 文件的目录
   **When** 运行 `autoqa run <path>`
   **Then** CLI 应识别并以确定性顺序收集要执行的 spec 列表（目录模式）

2. **Given** 当路径不存在/不可读/类型不合法，或目录下无可执行 spec
   **When** 运行 `autoqa run <path>`
   **Then** 应以退出码 `2` 失败并给出可理解的错误信息

## Tasks / Subtasks

- [x] 增加 `autoqa run` CLI 命令入口（AC: 1, 2）
  - [x] 在 `src/cli/commands/run.ts` 新增 `registerRunCommand(program)`（参考 `registerInitCommand` 的组织方式）
  - [x] 在 `src/cli/program.ts` 注册 `run` 命令（与 `init` 并列）
  - [x] 使用 commander 定义必选参数 `<file-or-dir>`（保持与 Epic 拆解一致）

- [x] 实现 spec 发现（支持文件/目录）与确定性排序（AC: 1）
  - [x] 对用户输入路径进行规范化（例如 `path.resolve`），并进行存在性与类型校验
  - [x] 如果是文件：仅接受 Markdown（`.md`）文件作为可执行 spec
  - [x] 如果是目录：遍历目录（建议递归）收集所有 `.md` 文件作为 spec 列表
  - [x] 对目录模式收集的 spec 列表做稳定排序（例如按相对路径字典序），保证跨平台确定性

- [x] 错误处理与退出码一致性（AC: 2）
  - [x] 路径不存在 / 目录下无 `.md` / 传入非 `.md` 文件 → 使用退出码 `2` 并输出清晰错误
  - [x] 不要在本 story 引入 Playwright/Agent SDK 调用（仅做 CLI 输入与 spec 列表发现）

- [x] 单元测试（AC: 1, 2）
  - [x] 新增 `tests/unit/run-args-spec-discovery.test.ts`（或等价命名）覆盖：
    - [x] 目录模式：多个 `.md` 文件 + 子目录时，收集顺序确定且可预期
    - [x] 文件模式：传入单个 `.md` 时正确识别
    - [x] 路径不存在/目录无 spec/非 `.md` 文件：退出码为 `2` 且错误信息可理解
  - [x] 测试实现建议：
    - [x] 使用 `createProgram()` + `program.exitOverride()` 捕获退出码
    - [x] 通过 `program.configureOutput()` 捕获 stdout/stderr（参考 `tests/unit/init.test.ts`）

## Dev Notes

- 分层边界（强约束）：
  - `src/cli/**` 只做参数解析、帮助信息与路由；禁止直接调用 Playwright API。
  - 本 story 只实现 `run` 命令输入与 spec 发现；真正的执行生命周期（Browser/Context/Page）在 Story 2.4 实现。

- 确定性与可重复性（目录模式）：
  - 不要依赖 `fs.readdir` 的天然顺序；必须显式排序。
  - 建议按“相对输入目录的相对路径”排序，保证在不同 OS/文件系统上的稳定性。

- 退出码约定：
  - 用户输入/配置错误统一使用退出码 `2`。
  - 本 story 关注的错误包括：路径不存在、目录无 `.md`、传入非 `.md` 文件等。

- 现有代码可复用/对齐点：
  - `src/cli/program.ts` 目前只注册了 `init`；`run` 应采用同样的注册方式。
  - `src/cli/commands/init.ts` 已建立了“对用户可纠正错误使用 `exitCode: 2`”的模式，可直接复用。

### Project Structure Notes

- 当前仓库已存在：
  - `src/cli/cli.ts`（CLI 入口）
  - `src/cli/program.ts`（Commander Program）
  - `src/cli/commands/init.ts`（init 命令）
- 本 story 预计新增：
  - `src/cli/commands/run.ts`（run 命令）
- 注意保持 ESM import 风格（`.js` 扩展名与现有文件一致）。

### References

- [Source: docs/epics.md#Story 2.1]
- [Source: docs/architecture.md#Infrastructure & Deployment（交付与 CI）]
- [Source: docs/architecture.md#Structure Patterns（结构与边界规范）]
- [Source: docs/architecture.md#Project Structure & Boundaries（项目结构与边界）]
- [Source: src/cli/program.ts]
- [Source: src/cli/commands/init.ts]
- [Source: tests/unit/init.test.ts]

## Dev Agent Record

### Context Reference

<!-- Path(s) to story context XML will be added here by context workflow -->

### Agent Model Used

Cascade

### Debug Log References

- `npm test`
- `npm run build`

### Completion Notes List

- 实现 `autoqa run <file-or-dir>`：支持单文件/目录输入，目录模式递归收集 `.md` 并按相对路径稳定排序，保证跨平台确定性
- 对用户可纠正的输入/文件系统问题统一使用退出码 `2` 并输出清晰错误信息（路径不存在、目录无 spec、非 `.md` 文件等）
- 新增单元测试覆盖目录/文件两种模式与主要错误分支

### File List

- `docs/sprint-artifacts/2-1-autoqa-run-args-spec-discovery.md`
- `docs/sprint-artifacts/sprint-status.yaml`
- `src/cli/program.ts`
- `src/cli/commands/run.ts`
- `tests/unit/run-args-spec-discovery.test.ts`

### Change Log

- Implement Story 2.1: add `autoqa run` command (spec discovery only) with deterministic ordering, consistent `exitCode: 2` mapping, and unit tests
