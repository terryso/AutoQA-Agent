---
stepsCompleted: []
inputDocuments:
  - docs/project-brief.md
documentCounts:
  briefs: 1
  research: 0
  brainstorming: 0
  projectDocs: 0
workflowType: 'prd'
lastStep: 0
---

# Product Requirements Document - AutoQA-Agent

**Author:** Nick  
**Date:** 2025-12-13

## Executive## Executive Summary Summary

- AutoQA-Agent 旨在通过 Claude Agent SDK + 浏览器工具环境，把 Markdown 格式的验收文档直接执行为可重复的自动化验收。
- 核心差异化在于“视觉驱动 + 原生自愈”：基于截图的决策与对工具错误的闭环反馈，降低 UI 变动导致的脚本脆弱性。
- 交付形态以 CLI 为主（`autoqa init` / `autoqa run`），默认可嵌入 CI/CD。

## Goals and Background Context

### 核心目标

- 消灭“脚本脆弱性” (Eliminate Script Brittleness): 利用 Claude Agent SDK 的原生推理与视觉能力，使测试通过率不再受限于微小的 UI 变动（目标：20% 元素 ID 漂移下仍能自愈）。
- 填补“转换鸿沟” (Bridge the Translation Gap): 实现“文档即测试”。QA 工程师只需维护 Markdown 格式的 PRD/用例，无需编写指令式代码。
- 极简开发者体验 (Developer-Friendly): 提供零配置启动的 CLI 工具 (autoqa run)，完美适配现有的 CI/CD 工作流。
- 架构轻量化: 依托 Claude Agent SDK 接管复杂的推理循环（ReAct Loop），将核心逻辑代码控制在 500 行以内，确保开源项目的可维护性。

### 背景描述

传统的自动化测试（Selenium/Playwright）处于危机之中。随着前端框架（React/Vue）的动态化，维护测试脚本的成本已超过了其带来的价值。虽然 LLM Agent 承诺解决这一问题，但早期的尝试（自行拼接 LLM API）导致了架构的脆弱和状态管理的混乱。
随着 Anthropic Claude Agent SDK 的发布，我们有机会构建一个标准化的解决方案。AutoQA-Agent 不再试图“教” LLM 如何测试，而是提供一个能够让 Claude 大脑直接“接管”浏览器的环境（Tool Environment），实现真正的声明式质量验收。

## Change Log

| 日期 | 版本 | 描述 | 作者 |
|---|---|---|---|
| 2025-05-20 | v0.1 | 初始草案 (基于简报 v1.2) | PM (John) |

## Success Criteria

### User Success

- QA 工程师可仅维护 Markdown（包含“步骤”和“预期结果”），无需编写指令式测试脚本即可通过 CLI 执行验收。
- 开发者可在 CI/CD 中集成 AutoQA-Agent 作为合并前质量门禁，保证验收可重复执行且日志输出清晰。

### Business Success

- 开源采用度（待确认）：被多少项目在 CI 中接入、社区贡献（issues/PR）数量、Star/下载量等。

### Technical Success

- 见下文 `## Non-Functional Requirements` 以及 `### 核心目标` 中的量化目标。

### Measurable Outcomes

- 核心逻辑代码（不含工具封装）少于 500 行。
- 在标准电商 Demo 网站上，修改 20% 的元素 ID 后，Agent 仍能跑通流程。

## Product Scope

### MVP - Minimum Viable Product

- 基于 SDK 的 CLI：使用 Claude Agent SDK 初始化并运行测试任务。
- Markdown 驱动：支持读取包含“步骤”和“预期结果”的 Markdown 文件。
- Playwright Toolset（最小集）：
  - Maps(url)
  - click(selector_or_description)
  - fill(selector_or_description, text)
  - assert_text(text)
- 视觉自愈：在 click 失败时通过视觉描述重新定位元素并重试。

### Growth Features (Post-MVP)

- 并发执行（MVP 明确不做，后续如需规模化执行再引入）。
- 更丰富的测试报告形态（MVP 仅输出控制台日志）。
- MCP Server 部署/服务化形态（MVP 明确不做）。

### Vision (Future)

- 待补充（基于社区反馈与 CI 大规模使用后的需求再确定）。

## User Journeys

**Journey 1：QA 工程师从 Markdown 到可执行验收**
QA 工程师维护一个描述“步骤 + 预期结果”的 Markdown 文档，通过 `autoqa run` 执行验收并观察控制台输出。目标是将“文档即测试”落地为可重复运行的质量验收流程。

**Journey 2：开发者把 AutoQA-Agent 接入 CI/CD 做质量门禁**
开发者在流水线中运行 `autoqa run`（指定单文件或目录），在合并前自动执行验收用例。MVP 阶段以控制台日志为主要产物，不引入复杂报告看板。

**Journey 3：UI 变动导致操作失败后的自愈执行**
当页面元素变动导致 click 等操作失败时，工具返回错误与截图，Claude 基于视觉重新定位并继续执行，直到成功或明确失败。

### Journey Requirements Summary

- CLI 能稳定读取并执行 Markdown 用例（步骤与预期结果）。
- Tool 执行失败时需要将错误与截图反馈给 Agent，以触发视觉自愈与重试。
- CI/CD 场景需要可重复执行与清晰日志输出，便于定位失败原因。

## Domain Requirements

- 当前定位为开源自动化测试 CLI 工具，简报未提出特定行业合规（金融/医疗/政务等）要求。
- 基础运行约束：需要配置 `ANTHROPIC_API_KEY` 环境变量以调用 Claude 能力。

## Innovation Analysis

- 站在巨人肩膀上：不手写 while-loop/状态机拼接 LLM API，而是让 Claude Agent SDK 托管“观察-思考-行动”循环。
- 标准化工具接口：将 Playwright 能力封装为 Agent SDK 标准 Tools，提升工具调用的稳定性与可扩展性。
- 错误 + 截图回流推理：工具失败时附带截图，触发多模态视觉修正机制，形成自愈闭环。

## Project-Type Requirements

- 产品形态：开源 CLI 工具（本地运行）。
- MVP 约束：不引入复杂部署（不做 MCP Server）、不做复杂测试报告看板、不做并发执行。
- 交付侧重点：开发者体验与可集成性（CI/CD），以及清晰的控制台日志输出。

## Functional Requirements

### Capability Areas

#### 核心 CLI 工作流

- FR1: 项目初始化 (autoqa init)
  - 用户运行命令后，自动生成 autoqa.config.json 配置文件。
  - 自动创建 specs/ 示例目录和 specs/login-example.md 示例文档。
  - 检查并提示用户配置 ANTHROPIC_API_KEY 环境变量。
- FR2: 测试执行 (autoqa run)
  - 支持运行单个 Markdown 文件或整个目录。
  - 支持 --headless (默认无头模式) 和 --debug (有头模式，便于观察) 参数。
  - 支持 --url 参数覆盖文档中的默认 Base URL。

#### Agent 核心能力 (SDK 驱动)

- FR3: Markdown 语义解析
  - 系统必须能解析 Markdown 中的 ## Preconditions (前置条件) 和有序列表 1. 2. 3. (测试步骤)。
  - 系统需将 Markdown 内容转化为 Claude Agent SDK 可理解的 System Prompt 或 Task Context。
- FR4: 视觉感知循环 (Visual Perception Loop)
  - 在 Agent SDK 决定调用任何操作工具（如 Click）之前，系统必须自动截取当前页面截图 (Screenshot)。
  - 截图必须作为 image block 注入到 Agent SDK 的当前 Turn 中，确保 Claude “看着页面”做决定。
- FR5: 原生自愈机制 (Native Self-Healing)
  - 当底层 Playwright 工具抛出错误（如 TimeoutError, ElementNotFound）时，禁止直接中断程序。
  - 必须将错误信息捕获并封装为 ToolResult (包含 is_error: true) 返回给 Agent SDK。
  - Agent SDK 接收错误后，应自动触发下一轮推理，结合截图尝试替代方案（如点击位置偏移、尝试备选选择器、关闭遮挡层）。

#### 工具集 (Tool Definitions)

- FR6: 浏览器操作工具 (Playwright Adapters)
  - Maps(url): 访问页面。
  - click(target_description): 点击元素（支持语义描述，如 "蓝色登录按钮"）。
  - fill(target_description, text): 输入文本。
  - scroll(direction, amount): 页面滚动。
  - wait(seconds): 显式等待（仅在必要时由 Agent 调用）。
- FR7: 断言工具 (Assertions)
  - assert_text_present(text): 验证页面包含特定文本。
  - assert_element_visible(description): 验证元素可见。
  - 关键: 断言失败应同样触发自愈重试，多次失败后才标记为测试不通过。

## Non-Functional Requirements

- NFR1: 启动速度: CLI 启动到浏览器打开的时间应 < 3秒。
- NFR2: 稳定性: 在标准 TodoMVC 演示应用中，连续运行 10 次应 100% 通过。
- NFR3: Token 成本控制: 截图应进行适当压缩（如压缩至 1024px 宽，JPEG 格式），避免消耗过多 Token。
- NFR4: 可观测性: CLI 界面需实时打印 Agent 的“思考过程” (Thinking Process)，不仅是结果。

## User Experience (CLI)

虽然我们没有图形界面，但 CLI 的交互体验 (DX) 至关重要。

### 核心命令设计

```bash
# 1. 运行测试
$ autoqa run ./specs/login.md
# 2. 输出示例
> [AutoQA] 🚀 Starting Agent powered by Claude 3.5 Sonnet...
> [Context] 📖 Reading ./specs/login.md
> [Agent] 🤔 Thinking: "First, I need to navigate to the login page."
> [Tool] 🛠️ Call: navigate(url="http://localhost:3000/login")
> [Browser] 📸 Screenshot captured (15kb)
> [Agent] 🤔 Thinking: "I see the login form. Now I will enter the email."
> [Tool] 🛠️ Call: fill(target="Email field", text="user@example.com")
> ...
> [Error] ❌ Click failed: Element obscured by
> [Healing] 🩹 SDK triggering recovery...
> [Agent] 🤔 Thinking: "Ah, the cookie banner is blocking it. I need to close it first."
> [Tool] 🛠️ Call: click(target="Accept Cookies button")
> [Tool] 🛠️ Call: click(target="Sign In button") (Retry)
> [Result] ✅ Test Passed! (Time: 24s, Cost: ~$0.02)
```

### Markdown 输入规范

用户编写的 PRD 应该保持自然，但也需要遵循最低限度的结构:

```md
# 用户登录流程验收
## Config
- Base URL: http://localhost:3000
## Scenarios
### 场景 1: 成功登录
1. 访问 /login 页面
2. 输入邮箱 "demo@autoqa.com"
3. 输入密码 "password123"
4. 点击 "Sign In" 按钮
5. 验证: 页面应跳转到 /dashboard
6. 验证: 页面应包含文本 "Welcome back, Demo User"
```

## Assumptions & Constraints

- 依赖 Claude Agent SDK: 我们假设 Anthropic 的 Agent SDK (Node.js版) 能够稳定处理 ToolResult 的错误反馈并触发重试。
- Playwright 环境: 用户本地需具备运行 Playwright 的基础环境（Node.js > 18）。
- 无状态性: MVP 阶段，每个测试文件运行一个新的 Browser Context，不复用 Cookie/Session，以保证测试隔离性。

## Project Plan (Epics)

为了快速交付 MVP，我将开发工作拆分为以下 3 个 Epic:

- Epic 1: The Skeleton (骨架)
  - 搭建 TypeScript 项目结构。
  - 集成 autoqa CLI 框架 (Commander.js)。
  - 实现 Markdown 解析器。
- Epic 2: The Brain & Hands (大脑与双手)
  - 集成 Claude Agent SDK，跑通 Hello World。
  - 封装 Playwright 为 MCP-style Tools。
  - 实现“截图 -> SDK”的视觉注入管道。
- Epic 3: The Healing (自愈闭环)
  - 实现错误捕获与反馈机制。
  - 调试 Claude 在面对不同错误时的自愈 Prompt。
  - 完善控制台日志输出。