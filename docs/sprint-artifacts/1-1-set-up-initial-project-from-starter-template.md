# Story 1.1: Set up initial project from starter template

Status: done

## Story

As a 开源贡献者,
I want 在仓库中建立可构建/可运行的 TypeScript CLI 骨架（ESM + commander + tsup），
so that 我可以本地运行 `autoqa` 命令并继续实现后续功能。

## Acceptance Criteria

1. **Given** 开发环境已安装 Node.js `>= 20`
   **When** 运行 `npm run build`
   **Then** 应生成可执行产物 `dist/cli.js`（符合 `bin.autoqa=dist/cli.js` 约定）
   **And** 运行 `node dist/cli.js --help` 可看到帮助信息且进程以退出码 `0` 结束

## Tasks / Subtasks

- [x] 初始化 TypeScript CLI Skeleton（AC: 1）
  - [x] 创建 `package.json` 并配置：`type=module`、`bin.autoqa=dist/cli.js`
  - [x] 添加依赖与版本锁定（按架构文档固定版本）
  - [x] 配置构建：`tsup` 输出到 `dist/cli.js`
  - [x] 配置 TypeScript：`tsconfig.json`（ESM 友好，Node >= 20）

- [x] 建立目录结构与最小可运行入口（AC: 1）
  - [x] 创建 `src/cli/cli.ts` 作为 CLI 入口
  - [x] 使用 `commander@14` 注册最小命令骨架（先只需要 `--help` 可用即可）
  - [x] 确保 `npm run build` 后执行 `node dist/cli.js --help` 返回退出码 `0`

- [x] 基础工程配置（AC: 1）
  - [x] 添加 `.gitignore`（至少忽略 `dist/`、`.autoqa/`、`node_modules/`）
  - [x] 添加 `vitest` 基础配置（允许后续 story 增量加测试）

## Dev Notes

- **仓库当前状态**：目前仅有 `docs/**`（未发现 `package.json/tsconfig.json/src/**`），本 story 需要从零创建工程骨架。

- **硬约束（不要偏离）**
  - **Node.js**：`>= 20`（推荐 `v24.12.0`）
  - **模块系统**：ESM only（`package.json` 必须 `type=module`）
  - **构建**：`tsup` 输出到 `dist/`，并通过 `bin.autoqa=dist/cli.js` 暴露 CLI

- **依赖与版本（按架构文档固定）**
  - runtime:
    - `@anthropic-ai/claude-agent-sdk@0.1.69`
    - `commander@14.0.2`
    - `playwright@1.57.0`
    - `pino@10.1.0`
    - `remark-parse@11.0.0`
    - `zod@3.24.1`
  - dev:
    - `@playwright/test@1.57.0`
    - `tsup@8.5.1`
    - `typescript@5.9.3`
    - `vitest@4.0.15`

- **推荐的目录结构（后续 stories 会依赖这些路径）**
  - `src/cli/**` 只做参数解析与路由
  - `src/runner/**` 管生命周期
  - `src/agent/**` 集成 SDK/护栏
  - `src/tools/**` 封装 Playwright
  - `src/browser/**` 截图/创建对象
  - `src/reporting/**` 输出

- **关键实现提示**
  - `tsup` 需要确保最终产物是 ESM，并且生成的 `dist/cli.js` 可直接用 `node dist/cli.js --help` 执行。
  - CLI 入口建议使用 shebang（例如通过 tsup `banner` 注入），但以 AC 可通过为准。

### Project Structure Notes

- 该 story 只负责“骨架可构建/可执行”，不要在本 story 内实现 `autoqa init/run` 的业务逻辑（这些属于后续 stories）。

### References

- [Source: docs/epics.md#Story 1.1]
- [Source: docs/architecture.md#Starter Template Evaluation（启动模板/脚手架评估）]
- [Source: docs/architecture.md#Complete Project Directory Structure（完整目录结构）]
- [Source: docs/project_context.md#1. 运行时与依赖基线（不可随意更改）]

## Dev Agent Record

### Context Reference

<!-- Path(s) to story context XML will be added here by context workflow -->

### Agent Model Used

Cascade

### Debug Log References

- `npm install`
- `npm run build`
- `node dist/cli.js --help`
- `npm test`
- `npx tsc -p tsconfig.json --noEmit`

### Completion Notes List

- `tsup` 产物固定输出为 `dist/cli.js`，并通过 `banner` 注入 shebang
- CLI 骨架采用 `commander`，已确保 `--help` 可用且退出码为 `0`
- Vitest 配置启用 `passWithNoTests`
- 添加最小单测覆盖 `--help` 行为
- `tsconfig.json` 显式指定 `types: ["node"]`，避免向上层目录扫描导致外部 `@types` 解析失败

### File List

- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `tsup.config.ts`
- `vitest.config.ts`
- `.gitignore`
- `src/cli/cli.ts`
- `src/cli/program.ts`
- `tests/unit/cli-help.test.ts`
- `docs/sprint-artifacts/sprint-status.yaml`

### Change Log

- Update project skeleton and build/test wiring for Story 1.1
- Code review fixes: tighten Node engines & make tests non-watch; update tsconfig types; update .gitignore
