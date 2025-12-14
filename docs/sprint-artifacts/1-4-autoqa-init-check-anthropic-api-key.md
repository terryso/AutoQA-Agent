# Story 1.4: `autoqa init` 判断本机已通过 Claude Code 授权（优先）并提示鉴权方式

Status: ready-for-dev

## Story

As a QA 工程师,
I want 在运行 `autoqa init` 时得到清晰的鉴权提示（优先检测 Claude Code 已授权的 Agent SDK 是否可用，否则提示配置 `ANTHROPIC_API_KEY`），
so that 我不会在后续运行时才发现缺少关键鉴权配置。

## Acceptance Criteria

1. **Given** 本机已通过 Claude Code 授权且 Agent SDK 可直接使用该授权（无需 `ANTHROPIC_API_KEY`）
   **When** 运行 `autoqa init`
   **Then** CLI 应打印清晰提示说明无需配置 `ANTHROPIC_API_KEY` 也可继续使用
   **And** `autoqa init` 仍应完成文件生成（配置与示例）并以退出码 `0` 结束

2. **Given** 本机未通过 Claude Code 授权（或 Agent SDK 无法使用该授权）
   **And** 环境变量 `ANTHROPIC_API_KEY` 未设置
   **When** 运行 `autoqa init`
   **Then** CLI 应打印清晰提示说明需要设置 `ANTHROPIC_API_KEY`
   **And** `autoqa init` 仍应完成文件生成（配置与示例）并以退出码 `0` 结束

3. **Given** 探测逻辑执行失败但错误不属于“认证失败”（例如临时网络失败、其他异常）
   **When** 运行 `autoqa init`
   **Then** CLI 不应把该异常当作“未授权”下结论
   **And** 应输出保守提示（例如“无法确认 Claude Code 授权状态，将在后续运行时再次校验”或等价文案）
   **And** `autoqa init` 仍应以退出码 `0` 结束

## Tasks / Subtasks

- [ ] 增加鉴权探测模块（方案 A：probe-first）（AC: 1, 2, 3）
  - [ ] 新增模块（建议：`src/auth/probe.ts` 或 `src/agent/auth/probe.ts`）导出 `probeAgentSdkAuth()`
  - [ ] 使用 `@anthropic-ai/claude-agent-sdk` 的 `query()` 发起一次最小探测调用：
    - [ ] `prompt`：极短文本（例如 `"ping"`）
    - [ ] `options`：限制成本与回合（例如 `maxTurns: 1`；如 SDK 支持则设置 `maxBudgetUsd` 为极小值）
    - [ ] 及时退出/停止迭代：拿到任意一个可判定“已连通/已鉴权”的信号即可结束
  - [ ] 错误分类：
    - [ ] 如果捕获到顶层错误且 `error.code === 'AUTHENTICATION_FAILED'`（或 SDK 等价错误码）→ 视为“不可用”，由 CLI 打印需要配置 `ANTHROPIC_API_KEY` 的提示
    - [ ] 其他错误（网络/超时/未知）→ 视为“无法确认”，不要误判为未授权（对应 AC: 3）

- [ ] 将探测集成到 `autoqa init` 的输出提示（AC: 1, 2, 3）
  - [ ] 在 `src/cli/commands/init.ts` 的文件生成流程结束后（打印 Created/Skipping 之后）执行鉴权提示逻辑
  - [ ] 确保鉴权探测失败不会影响 init 成功退出（始终 exitCode=0，除非已有既定的 FS 错误流程）
  - [ ] 打印提示时不要输出任何敏感信息（不要回显 env 值、不要打印 token）

- [ ] 单元测试（AC: 1, 2, 3）
  - [ ] 在 `tests/unit/init.test.ts` 增加测试：
    - [ ] 模拟 probe 返回“可用”→ 断言 stdout 包含“无需配置 ANTHROPIC_API_KEY”（或等价文案）
    - [ ] 模拟 probe 抛出 `{ code: 'AUTHENTICATION_FAILED' }` 且 env 未设置 → 断言 stdout 包含“需要设置 ANTHROPIC_API_KEY”（或等价文案）
    - [ ] 模拟 probe 抛出非认证错误（例如 `{ code: 'ECONNRESET' }`）→ 断言 stdout 包含“无法确认/将再次校验”（或等价文案）
  - [ ] 测试实现建议：将 probe 模块设计为可注入/可 mock（避免测试时真实调用网络/SDK）

## Dev Notes

- **核心策略（必须遵守）**：
  - 采用“探测调用（probe-first）”判断 Agent SDK 是否可直接使用本机 Claude Code 授权。
  - 不要依赖猜测 Keychain 或固定文件路径来做确定性判断（macOS 凭据存储在 Keychain，属于实现细节）。

- **实现位置建议（避免破坏分层）**：
  - `src/cli/commands/init.ts` 只负责调用与输出，不要把 SDK 交互逻辑写在 CLI 文件里。
  - 鉴权探测模块放在非 CLI 层（例如 `src/agent/**` 或单独 `src/auth/**`），并提供可 mock 的接口供单测使用。

- **错误处理与退出码**：
  - 本 story 的鉴权提示是“建议/提示”，不应让 `autoqa init` 因鉴权探测失败而退出码非 0。
  - 退出码 `2` 仍只用于既有的“用户可纠正的 FS 错误/输入错误”路径（参考 Story 1.2/1.3 的约定与实现）。

- **文档依据（官方）**：
  - Claude Code 文档说明：macOS 上凭据存放在加密的 Keychain（Credential management）。
  - 排障文档提到可通过删除 `~/.config/claude-code/auth.json` 清理认证状态，但不应把该文件作为唯一可靠信号。

### Project Structure Notes

- 参考架构文档的分层边界：鉴权探测属于“SDK 集成/运行前校验”类逻辑，应放在 `src/agent/**` 或独立模块中，而不是 `src/cli/**`。

### References

- [Source: docs/epics.md#Story 1.4]
- [Source: docs/architecture.md#Authentication & Security（认证与安全）]
- [Source: https://code.claude.com/docs/en/iam#Credential management]
- [Source: https://code.claude.com/docs/en/troubleshooting#Authentication issues]

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

### File List
