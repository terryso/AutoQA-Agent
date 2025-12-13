# 项目简报: AutoQA-Agent (v1.2)

## 1. 执行摘要 (Executive Summary)

AutoQA-Agent 是一个基于 Claude Agent SDK 构建的开源自动化测试 CLI 工具。它旨在利用 Anthropic 官方提供的 Agent 框架能力，打造一个能够直接阅读 Markdown PRD、自主规划路径、并在遇到 UI 变动时利用 SDK 内置能力进行自愈的智能验收工具。我们的核心策略是：站在巨人的肩膀上——利用 Claude Agent SDK 处理复杂的思考与工具调度，我们专注于提供高质量的浏览器操作能力（Playwright Tools）。

## 2. 问题陈述 (Problem Statement)

- 手写 Agent 的脆弱性: 开发者自己用 while 循环拼接 LLM API，容易导致状态管理混乱、错误处理不完善，且难以跟进模型的新能力（如 Computer Use）。
- 测试维护成本高: 传统测试脚本是“指令式”的，UI 一变脚本就挂。我们需要“声明式”的测试——告诉 Agent 测什么，而不是怎么测。

## 3. 解决方案与技术架构

### 3.1 核心大脑：Claude Agent SDK

我们不再直接调用底层的 Messages API，而是实例化一个 Claude Agent。

- SDK 托管思考: 由 Agent SDK 接管“观察-思考-行动”的循环。
- 标准化接口: 通过 SDK 定义的接口暴露 Playwright 能力，确保模型能以最优方式理解工具。

### 3.2 架构图 (The Stack)

- Input Layer: 解析 Markdown PRD，将其转化为 Agent SDK 能理解的 Task Context。
- Agent Layer (Claude Agent SDK):
  - 负责维护对话历史。
  - 负责决策调用哪个工具。
  - 负责处理工具返回的错误（自愈的核心）。
- Tool Layer (Playwright Adapter):
  - 将 Playwright 的 API 封装为符合 Agent SDK 标准的 Tools。
  - 关键特性: 每个 Tool 在执行失败时，不仅返回 Error，还自动附带当前截图（Screenshot），触发 SDK 的视觉修正机制。

### 3.3 为什么选 Claude Agent SDK？

- 原生最佳实践: 包含了 Anthropic 对于 Prompt Engineering 和工具调用的最佳调优。
- 简化代码: 我们的代码库将专注于“如何操作浏览器”，而不是“如何与 LLM 聊天”。
- 未来兼容性: 未来 Claude 发布新能力（如更强的 Computer Use），SDK 升级后我们可以直接受益。

## 4. 目标用户 (Target Users)

- QA 工程师: 使用 CLI 工具，无需编写代码，仅需维护 Markdown 文档。
- 开发者: 在 CI/CD 流水线中集成，作为代码合并前的质量门禁。

## 5. MVP 功能范围 (Scope)

### ✅ In Scope (MVP)

- 基于 SDK 的 CLI: 使用 Agent SDK 初始化并运行测试任务。
- Markdown 驱动: 支持读取包含 "步骤" 和 "预期结果" 的 Markdown 文件。
- Playwright Toolset:
  - Maps(url)
  - click(selector_or_description)
  - fill(selector_or_description, text)
  - assert_text(text)
- 视觉自愈: 利用 SDK 的多模态能力，在 click 失败时通过视觉描述重新定位元素。

### ❌ Out of Scope (MVP)

- 复杂的 MCP Server 部署（MVP 仅作为本地 CLI 运行）。
- 复杂的测试报告看板（MVP 仅输出控制台日志）。
- 并发执行。

## 6. 成功指标

- 代码行数: 核心逻辑代码（不含工具封装）应少于 500 行（依赖 SDK 的封装能力）。
- 自愈成功率: 在标准电商 Demo 网站上，修改 20% 的元素 ID 后，Agent 仍能跑通流程。