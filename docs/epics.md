---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - docs/prd.md
  - docs/architecture.md
---

# AutoQA-Agent - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for AutoQA-Agent, decomposing the requirements from the PRD, UX Design if it exists, and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: 提供项目初始化命令 `autoqa init`，生成 `autoqa.config.json` 配置文件，并创建 `specs/` 示例目录与 `specs/login-example.md` 示例文档，同时检查并提示用户配置 `ANTHROPIC_API_KEY` 环境变量。
FR2: 提供测试执行命令 `autoqa run`，支持运行单个 Markdown 文件或整个目录；支持 `--headless`（默认无头）与 `--debug`（有头便于观察）参数；支持 `--url` 参数指定 Base URL（MVP：暂不从 Markdown 文档读取 Base URL）。
FR3: 支持 Markdown 语义解析：解析 Markdown 中的 `## Preconditions`（前置条件）与有序列表步骤（含“预期结果/断言”），并将 Markdown 内容转化为 Claude Agent SDK 可理解的 System Prompt 或 Task Context。
FR4: 实现视觉感知循环（Visual Perception Loop）：在 Agent 调用任何浏览器操作工具（如 click/fill 等）之前，系统必须自动截取当前页面截图（Screenshot），并作为 image block 注入到 Agent SDK 的当前 turn 中。
FR5: 实现原生自愈机制（Native Self-Healing）：当底层 Playwright 工具抛出错误（如 TimeoutError、ElementNotFound）时，禁止直接中断程序；必须捕获错误并封装为 ToolResult（包含 `is_error: true`）返回给 Agent SDK，以触发下一轮推理并结合截图重试。
FR6: 提供最小浏览器操作工具集（Playwright adapters）：`navigate(url)`、`click(target_description)`、`fill(target_description, text)`、`scroll(direction, amount)`、`wait(seconds)`；其中 `click/fill` 必须支持“语义描述”定位（例如“蓝色登录按钮”）。
FR7: 提供断言工具：`assertTextPresent(text)`、`assertElementVisible(description)`；断言失败应同样触发自愈重试，多次失败后才标记测试不通过。

### NonFunctional Requirements

NFR1: 启动速度：CLI 启动到浏览器打开的时间应 < 3 秒。
NFR2: 稳定性：在标准 TodoMVC 演示应用中，连续运行 10 次应 100% 通过。
NFR3: Token 成本控制：截图应进行适当压缩（例如压缩至 1024px 宽，JPEG 格式/quality），避免消耗过多 token。
NFR4: 可观测性：CLI 需实时打印 Agent 的“思考过程”（Thinking Process）、工具调用与关键上下文，便于 CI/CD 场景定位失败原因。

### Additional Requirements

- **Starter Template（IMPORTANT）**：使用 TypeScript CLI Skeleton（`commander@14` + `tsup`），统一 ESM（`package.json` `type=module`），产物输出到 `dist/`，并通过 `bin.autoqa=dist/cli.js` 暴露 CLI。
- 运行时与依赖版本约束：Node.js `>= 20`；并固定关键依赖版本（Claude Agent SDK、Playwright、Commander、Zod、Pino、remark-parse、TypeScript、Vitest 等）。
- 分层与边界强约束：`src/cli` 只做参数解析与路由；`src/runner` 管生命周期；`src/agent` 集成 SDK/护栏；`src/tools` 封装 Playwright；`src/browser` 截图/创建对象；`src/reporting` 输出。禁止在 CLI/Runner 直接调用 Playwright API。
- 工具错误模型强约束：工具失败不得 `throw` 终止；必须返回统一的 `ToolResult` 结构（`ok/data/error/screenshot`），并映射为 SDK 的 `ToolResult(is_error: true)` 语义。
- 自愈护栏（必须实现）：对 `maxToolCallsPerSpec`、`maxConsecutiveErrors`、`maxRetriesPerStep` 等设置硬上限，触发后应将 spec 标记为失败并给出清晰日志。
- 截图策略强约束：任何“可能改变页面状态”的工具调用前必须截屏；工具/断言失败时必须附带失败截图；截图应压缩以控制 token 成本。
- 执行模型：MVP 单进程按 spec 顺序执行（不做并发）；每个 Markdown 用例文件创建新的 Browser Context；同一次 `autoqa run` 可复用 Browser 实例以降低启动开销。
- 配置文件契约：配置文件固定为 `autoqa.config.json`；字段使用 `camelCase`；必须包含 `schemaVersion`；用 `zod` 进行严格校验与默认值补齐。
- 工具命名规范（注册到 SDK 的 toolName）：动作工具 `navigate/click/fill/scroll/wait`；断言工具 `assertTextPresent/assertElementVisible`；错误 `error.code` 必须可机器处理。
- 交付与 CI 约定：作为 npm 包发布（支持全局安装或 `npx autoqa`）；退出码约定 `0=全部通过`、`1=存在失败`、`2=用户输入/配置错误`。
- 安全与隐私：仅从环境变量读取 `ANTHROPIC_API_KEY` 且不落盘；日志需要脱敏（env/headers/token 相关字段）；截图默认仅在失败/调试模式持久化；输入路径需规范化防止目录穿越。
- 产物与可观测性：建议输出结构化日志（pino）与统一事件流（如 `autoqa.run.started`/`autoqa.tool.called`/`autoqa.spec.finished`）；可选将运行产物落到 `.autoqa/<runId>/`（log、screenshots、transcript）。

### FR Coverage Map

FR1: Epic 1 - 项目初始化 `autoqa init`
FR2: Epic 2 - 执行入口 `autoqa run`（含参数与 URL 指定）
FR3: Epic 2 - Markdown 解析与 Task Context 构建
FR4: Epic 2 - 动作前截图并注入 turn
FR5: Epic 3 - 工具失败/错误回流触发自愈重试（含护栏）
FR6: Epic 2 - 浏览器操作工具集 `navigate/click/fill/scroll/wait`
FR7: Epic 3 - 断言工具 + 断言失败自愈重试

## Epic List

### Epic 1: 零配置上手（项目初始化）
用户完成该 Epic 后可以运行 `autoqa init` 一键生成可运行的项目骨架与示例材料，并清楚如何配置 `ANTHROPIC_API_KEY`。
**FRs covered:** FR1

### Epic 2: 执行闭环（从 Markdown 驱动浏览器完成流程）
用户完成该 Epic 后可以用 `autoqa run` 执行单个 spec 或目录（含 `--headless` / `--debug` / `--url`），Agent 能通过浏览器工具把流程跑起来；每次动作前自动截图并注入 turn；CLI 输出清晰的过程日志，便于本地与 CI 排障。
**FRs covered:** FR2, FR3, FR4, FR6

### Epic 3: 验收判定与自愈闭环（断言 + 失败重试 + 护栏）
用户完成该 Epic 后可以用断言工具自动判定通过/失败；当工具/断言失败时把错误 + 截图回流触发自愈重试；通过护栏避免无限循环与成本失控，保证 CI 结果稳定可控。
**FRs covered:** FR5, FR7

## Epic 1: 零配置上手（项目初始化）

用户完成该 Epic 后可以运行 `autoqa init` 一键生成可运行的项目骨架与示例材料，并清楚如何配置 `ANTHROPIC_API_KEY`。

### Story 1.1: Set up initial project from starter template
  
  As a 开源贡献者,
  I want 在仓库中建立可构建/可运行的 TypeScript CLI 骨架（ESM + commander + tsup），
  So that 我可以本地运行 `autoqa` 命令并继续实现后续功能。
  
  **FRs covered:** FR1
  
  **Acceptance Criteria:**
  
  **Given** 开发环境已安装 Node.js `>= 20`
  **When** 运行 `npm run build`
 **Then** 应生成可执行产物 `dist/cli.js`（符合 `bin.autoqa=dist/cli.js` 约定）
 **And** 运行 `node dist/cli.js --help` 可看到帮助信息且进程以退出码 `0` 结束
 ### Story 1.2: 实现 `autoqa init` 生成 `autoqa.config.json`
  
  As a QA 工程师,
  I want 通过 `autoqa init` 自动生成默认的 `autoqa.config.json` 配置文件，
  So that 我无需手写配置即可开始尝试运行 AutoQA。
  
  **FRs covered:** FR1
  
  **Acceptance Criteria:**
  
  **Given** 当前目录不存在 `autoqa.config.json`
  **When** 运行 `autoqa init`
 **Then** 应生成 `autoqa.config.json` 且包含 `schemaVersion` 字段
 **And** 生成的配置文件应可被后续 `autoqa run` 的配置校验逻辑成功读取（格式合法）
 ### Story 1.3: `autoqa init` 创建示例 specs 目录与示例用例
  
  As a QA 工程师,
  I want `autoqa init` 自动创建 `specs/` 目录并生成一个可参考的示例 Markdown 用例，
  So that 我能快速理解“文档即测试”的最低输入规范。
  
  **FRs covered:** FR1
  
  **Acceptance Criteria:**
  
  **Given** 当前目录不存在 `specs/`
  **When** 运行 `autoqa init`
 **Then** 应创建 `specs/` 目录
 **And** 应生成一个示例 spec 文件（例如 `specs/login-example.md`），至少包含 `## Preconditions` 与按序步骤（1. 2. 3.）结构
 ### Story 1.4: `autoqa init` 检查并提示 `ANTHROPIC_API_KEY`
  
  As a QA 工程师,
  I want 在运行 `autoqa init` 时得到 `ANTHROPIC_API_KEY` 配置提示，
  So that 我不会在后续运行时才发现缺少关键环境变量。
  
  **FRs covered:** FR1
  
  **Acceptance Criteria:**
  
  **Given** 环境变量 `ANTHROPIC_API_KEY` 未设置
  **When** 运行 `autoqa init`
 **Then** CLI 应打印清晰提示说明需要设置 `ANTHROPIC_API_KEY`
 **And** `autoqa init` 仍应完成文件生成（配置与示例）并以退出码 `0` 结束
 
## Epic 2: 执行闭环（从 Markdown 驱动浏览器完成流程）
 
 用户完成该 Epic 后可以用 `autoqa run` 执行单个 spec 或目录（含 `--headless` / `--debug` / `--url`），Agent 能通过浏览器工具把流程跑起来；每次动作前自动截图并注入 turn；CLI 输出清晰的过程日志，便于本地与 CI 排障。
**FRs covered:** FR2, FR3, FR4, FR6

 
### Story 2.1: 实现 `autoqa run` 的输入参数与 spec 发现
 
 As a 开发者,
 I want 使用 `autoqa run <file-or-dir>` 运行单文件或目录下的 specs，
 So that 我可以把 AutoQA 接入本地与 CI 流程中。
 
 **FRs covered:** FR2
 
 **Acceptance Criteria:**
 
 **Given** 用户传入的路径为一个 Markdown 文件或包含 Markdown 文件的目录
 **When** 运行 `autoqa run <path>`
 **Then** CLI 应识别并以确定性顺序收集要执行的 spec 列表（目录模式）
 **And** 当路径不存在/无可执行 spec 时应以退出码 `2` 失败并给出可理解的错误信息
 
### Story 2.2: 支持 `--headless` / `--debug` / `--url` 参数与运行前校验
 
 As a 开发者,
 I want 在 `autoqa run` 时通过参数控制运行模式与 Base URL，
 So that 我能在 CI 使用无头模式，在本地使用 debug 模式观察执行。
 
 **FRs covered:** FR2
 
 **Acceptance Criteria:**
 
 **Given** 用户运行 `autoqa run`
 **When** 指定 `--headless`
 **Then** Playwright 应以无头模式启动
 **And** 当指定 `--debug` 时应以有头模式启动并输出更详细日志
 
 **Given** 用户运行 `autoqa run` 且未指定 `--debug`
 **When** CLI 解析参数并启动 Playwright
 **Then** Playwright 应默认以无头模式启动（无需显式 `--headless`）
 
 **Given** MVP 不从 Markdown 读取 Base URL
 **When** 用户未提供 `--url`
 **Then** `autoqa run` 应以退出码 `2` 失败并提示必须提供 Base URL
 
### Story 2.3: 解析 Markdown spec（Preconditions + 步骤 + 断言语句）
 
 As a QA 工程师,
 I want 用自然的 Markdown（前置条件 + 有序步骤 + 预期结果）描述验收流程，
 So that 我无需编写指令式脚本也能驱动自动化验收。
 
 **FRs covered:** FR3
 
 **Acceptance Criteria:**
 
 **Given** 一个符合最低结构的 Markdown spec（包含 `## Preconditions` 与有序列表步骤）
 **When** `autoqa run` 读取并解析该 spec
 **Then** 系统应抽取前置条件与步骤列表，生成结构化的 Task Context（可用于 Agent 推理）
 **And** 当 Markdown 不满足最低结构时，应以退出码 `2` 失败并指出缺失的结构元素
 
### Story 2.4: 实现 Runner（按 spec 生命周期创建 Browser/Context/Page）
 
 As a 开发者,
 I want Runner 按 spec 隔离浏览器上下文并稳定执行，
 So that 多个 spec 的运行结果可重复且互不污染（cookie/session 隔离）。
 
 **FRs covered:** FR2
 
 **Acceptance Criteria:**
 
 **Given** `autoqa run` 需要执行多个 specs
 **When** Runner 逐个执行 specs
 **Then** 每个 spec 都应创建新的 Browser Context 并在结束后正确释放资源
 **And** 同一次 `autoqa run` 应可复用同一个 Browser 实例以降低启动开销（满足启动性能目标的实现方向）
 
### Story 2.5: 实现 Playwright 动作工具（`navigate/click/fill/scroll/wait`）并返回 ToolResult
 
 As a QA 工程师,
 I want Agent 能通过标准工具调用驱动浏览器完成操作，
 So that 流程可以由模型“观察-思考-行动”循环自动推进。
 
 **FRs covered:** FR5, FR6
 
 **Acceptance Criteria:**
 
 **Given** Agent 调用 `navigate/click/fill/scroll/wait` 任一工具
 **When** 底层 Playwright 操作成功
 **Then** 工具应返回 `{ ok: true, data: ... }` 的 ToolResult
 **And** 当 Playwright 抛出错误时工具不得 `throw` 终止进程，而应返回 `{ ok: false, error: { code, message, retriable } }` 的 ToolResult
 
 **Given** Agent 调用 `click(target_description)` 或 `fill(target_description, text)` 且 `target_description` 为语义描述（例如“蓝色登录按钮”）
 **When** 工具执行元素定位并尝试完成点击/填表
 **Then** 工具应支持基于语义描述定位目标元素并完成对应操作
 **And** 当无法定位目标元素时应返回 `{ ok: false, error: { code, message, retriable } }` 且 `error.code` 可机器处理
 
### Story 2.6: 动作前自动截图并注入 Agent turn（含压缩）
 
 As a QA 工程师,
 I want 在每次浏览器动作前自动截图并作为视觉上下文提供给模型，
 So that 模型可以“看着页面”做更稳健的点击/填表决策。
 
 **FRs covered:** FR4
 
 **Acceptance Criteria:**
 
 **Given** Agent 即将调用任一可能改变页面状态的动作工具（如 `click`/`fill`/`navigate`）
 **When** 工具被执行
 **Then** 系统应在工具执行前捕获当前页面截图并注入到当前 turn
 **And** 截图应经过压缩/降采样以控制 token 成本（例如固定宽度近似 1024px 或等效策略）
 
### Story 2.7: 运行日志与可观测性（控制台输出 + 结构化字段）
 
 As a 开发者,
 I want `autoqa run` 输出清晰且可追踪的运行日志（包含 spec/步骤/工具/错误上下文），
 So that 我能在本地与 CI 中快速定位失败原因。
 
 **FRs covered:** FR2
 
 **Acceptance Criteria:**
 
 **Given** 正在执行一个 spec
 **When** 发生工具调用或错误
 **Then** CLI 应输出包含 `runId/specPath/stepIndex/toolName` 等关键字段的日志
 **And** 日志应能区分用户输入/配置错误（退出码 `2`）与测试失败（退出码 `1`）
 
## Epic 3: 验收判定与自愈闭环（断言 + 失败重试 + 护栏）
 
 用户完成该 Epic 后可以用断言工具自动判定通过/失败；当工具/断言失败时把错误 + 截图回流触发自愈重试；通过护栏避免无限循环与成本失控，保证 CI 结果稳定可控。
 
### Story 3.1: 实现断言工具（`assertTextPresent` / `assertElementVisible`）
 
 As a QA 工程师,
 I want 用断言描述“预期结果”，
 So that 系统可以自动判断验收是否通过。
 
 **FRs covered:** FR7
 
 **Acceptance Criteria:**
 
 **Given** Agent 调用 `assertTextPresent(text)`
 **When** 页面包含目标文本
 **Then** 断言应返回 `ok: true`
 **And** 当页面不包含目标文本时应返回 `ok: false` 且带有可机器处理的 `error.code`
 
 **Given** Agent 调用 `assertElementVisible(description)`
 **When** 页面存在并可见目标元素
 **Then** 断言应返回 `ok: true`
 **And** 当元素不存在/不可见时应返回 `ok: false` 且可被自愈机制识别为可重试（若适用）
 
### Story 3.2: 工具/断言失败回流到 Agent SDK 触发自愈重试
 
 As a QA 工程师,
 I want 当工具或断言失败时系统不要立刻中断，而是把错误与截图回流给模型继续推理，
 So that 模型可以尝试替代方案完成同一目标步骤。
 
 **FRs covered:** FR5, FR7
 
 **Acceptance Criteria:**
 
 **Given** 任一动作工具或断言返回 `ok: false`
 **When** Runner 将结果反馈给 Claude Agent SDK
 **Then** 反馈必须以 `is_error: true` 的语义让 SDK 进入下一轮推理
 **And** 反馈中应包含错误信息与（若可用）失败截图，供模型定位与修正
 
### Story 3.3: 自愈护栏（maxToolCalls/maxConsecutiveErrors/maxRetriesPerStep）
 
 As a 开发者,
 I want 为自愈与重试设置硬上限，
 So that CI 不会因为无限重试而卡死或成本失控。
 
 **FRs covered:** FR5
 
 **Acceptance Criteria:**
 
 **Given** 单个 spec 正在运行
 **When** 工具调用次数超过 `maxToolCallsPerSpec`（或等效配置）
 **Then** 该 spec 应被标记为失败并停止继续调用工具
 **And** 当连续错误次数或单步骤重试次数超过上限时也应触发同样的失败终止逻辑，并输出清晰日志说明触发了哪个护栏
 
### Story 3.4: 失败产物与退出码（CI 友好）
 
 As a 开发者,
 I want 在失败时得到可定位问题的最小产物与稳定退出码，
 So that AutoQA 可以可靠地作为 CI 的质量门禁。
 
 **FRs covered:** FR2
 
 **Acceptance Criteria:**
 
 **Given** 运行结果全部通过
 **When** `autoqa run` 结束
 **Then** 进程应以退出码 `0` 结束并输出通过汇总
 
 **Given** 存在断言失败或护栏触发导致的失败
 **When** `autoqa run` 结束
 **Then** 进程应以退出码 `1` 结束并输出失败汇总
 **And** 至少保留与失败相关的截图/日志信息（持久化策略可默认仅失败/调试模式）
