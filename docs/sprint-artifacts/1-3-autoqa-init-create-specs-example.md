# Story 1.3: `autoqa init` 创建示例 specs 目录与示例用例

Status: done

## Story

As a QA 工程师,
I want `autoqa init` 自动创建 `specs/` 目录并生成一个可参考的示例 Markdown 用例，
so that 我能快速理解“文档即测试”的最低输入规范。

## Acceptance Criteria

1. **Given** 当前目录不存在 `specs/`
   **When** 运行 `autoqa init`
   **Then** 应创建 `specs/` 目录
   **And** 应生成 `specs/login-example.md` 示例 spec 文件
   **And** 示例 spec 至少包含 `## Preconditions` 章节与有序列表步骤（`1.` `2.` `3.` ...）

2. **Given** 当前目录已存在 `specs/login-example.md`（用户自定义内容）
   **When** 运行 `autoqa init`（且当前目录不存在 `autoqa.config.json`）
   **Then** CLI 不应覆盖已有 `specs/login-example.md`
   **And** `autoqa init` 仍应完成本次初始化并以退出码 `0` 结束

## Tasks / Subtasks

- [x] 设计并实现示例 spec 写入模块（AC: 1, 2）
  - [x] 新增 `src/specs/init.ts`（或等价位置）提供 `ensureExampleSpecs(cwd)` 之类的纯函数/工具函数
  - [x] 目录创建使用 `mkdirSync(specsDir, { recursive: true })`
  - [x] 示例 spec 内容以内联字符串常量形式随代码发布（不要依赖运行时读取仓库内文件，避免 npm 包打包/路径问题）
  - [x] 写入 `specs/login-example.md` 时使用“禁止覆盖”语义（例如 `flag: 'wx'`）；若已存在则跳过并输出提示

- [x] 集成到 `autoqa init` 命令（AC: 1, 2）
  - [x] 在 `src/cli/commands/init.ts` 的 `writeDefaultConfigFile` 成功后调用示例 specs 创建逻辑
  - [x] 复用现有错误映射策略：用户可纠正的 FS 错误（`EACCES`/`EPERM`/`EROFS`/`ENOTDIR`/`EISDIR`/`ENOENT` 等）应以退出码 `2` 结束并输出可理解信息
  - [x] 注意 ESM import 规则：跨文件导入使用 `.js` 后缀

- [x] 单元测试（AC: 1, 2）
  - [x] 在临时目录执行 `program.parse(['init'], { from: 'user' })` 后断言：
    - [x] `specs/` 目录存在
    - [x] `specs/login-example.md` 存在且包含 `## Preconditions`
    - [x] 文件中包含至少一个有序列表步骤（例如匹配 `/^1\./m`）
  - [x] 增加“已有 login-example.md 不覆盖”的测试：预写入自定义内容 → 运行 init → 断言内容未变化且退出码为 0
  - [x] 测试不要依赖仓库根目录（使用 `mkdtemp` / `tmpdir`）

## Dev Notes

- **范围边界**
  - 本 story 只实现 `autoqa init` 的示例 specs 生成：
    - 创建 `specs/`
    - 写入 `specs/login-example.md`
  - 不要在本 story 内实现：
    - `ANTHROPIC_API_KEY` 检查提示（属于 Story 1.4）
    - `autoqa run` 或任何 Playwright/Agent/Markdown 解析逻辑（Epic 2/3）

- **与既有实现的关系（避免重复造轮子）**
  - `autoqa init` 入口已存在：`src/cli/commands/init.ts`
  - 配置文件写入已封装：`src/config/init.ts` 的 `writeDefaultConfigFile`
  - 本 story 应在不破坏 Story 1.2 行为的前提下扩展 init 流程（尤其是“配置文件已存在 → 退出码 2 拒绝覆盖”）

- **示例 spec 内容建议（必须满足 AC 的结构约束）**
  - 必须包含 `## Preconditions`
  - 步骤使用有序列表（`1.` `2.` …）
  - 建议包含 1-2 条“验证/预期结果”步骤，为后续 Story 2.3 的 Markdown 解析提供真实样例

### Project Structure Notes

- 新增实现应放在非 CLI 层的模块中（例如 `src/specs/**` 或 `src/init/**`），CLI 仅负责命令路由与错误映射。
- 禁止在 `src/cli/**` 直接写复杂的 FS 逻辑或模板拼接，避免后续可维护性下降。

### References

- [Source: docs/epics.md#Story 1.3]
- [Source: docs/architecture.md#Structure Patterns（结构与边界规范）]
- [Source: docs/architecture.md#Naming Patterns（命名规范）]
- [Source: docs/PRD.md#Markdown 输入规范]

## Dev Agent Record

### Context Reference

<!-- Path(s) to story context XML will be added here by context workflow -->

### Agent Model Used

Cascade

### Debug Log References

- `npm test`
- `npm run build`
- `node dist/cli.js init`

### Completion Notes List

- 实现 `ensureExampleSpecs(cwd)`：创建 `specs/` 并以“禁止覆盖（wx）”语义写入 `specs/login-example.md`（若已存在则跳过并提示）
- 在 `autoqa init` 成功创建 `autoqa.config.json` 后调用示例 spec 初始化逻辑
- 新增单测覆盖“首次生成/已有文件不覆盖”两种场景

### File List

- `src/specs/init.ts`
- `src/cli/commands/init.ts`
- `tests/unit/init.test.ts`
- `docs/sprint-artifacts/1-3-autoqa-init-create-specs-example.md`
- `docs/sprint-artifacts/sprint-status.yaml`

### Change Log

- Implement example specs generation for `autoqa init` (create `specs/` and write `specs/login-example.md` without overwriting) and add unit tests
- Code review fixes: make specs creation strict (exitCode=2), roll back config on specs failure, and strengthen unit tests

## Senior Developer Review (AI)

### Findings

- **HIGH** `specs` 创建失败时应严格失败（exitCode=2），避免在失败时留下半成功产物导致后续 rerun 卡死。
- **MEDIUM** 新增文件未被 Git 跟踪，容易导致提交遗漏（功能/文档缺失）。
- **LOW** 示例文本包含智能引号，可能造成后续解析噪声。

### Fixes Applied

- `specs` 创建失败时使用 `program.error(..., { exitCode: 2 })`；并在失败时回滚本次新建的 `autoqa.config.json`。
- 将示例文本的智能引号替换为普通引号。
- 增强单测覆盖：`specs` 目录无法创建 → 退出码 2 且回滚 config。

## Review Follow-ups (AI)

- [x] 运行 `git add -A`，确保本 Story 新增/修改文件都被纳入版本控制，避免遗漏未追踪文件。
