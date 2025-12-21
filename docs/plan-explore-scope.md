---
title: autoqa plan --explore-scope 行为说明
---

# autoqa plan --explore-scope 行为说明

本文档详细说明 `autoqa plan` / `autoqa plan-explore` 中 `--explore-scope` 参数在**探索阶段**和**生成用例阶段**的具体策略，并结合实际示例（含本项目中 Polyv 频道管理页面的 run）帮助理解。

适用命令：

- `autoqa plan -u <url> [--explore-scope ...]`
- `autoqa plan-explore -u <url> [--explore-scope ...]`

三种可选值：

- `site`（默认）
- `focused`
- `single_page`

> 术语约定：
> - **探索阶段**：调用浏览器 + Agent 在站点中自动点击、跳转，生成 `explore-graph.json` / `explore-elements.json` / `explore-transcript.jsonl`。
> - **生成阶段**：基于探索产物调用 Planner 生成 `test-plan.json` 和 Markdown 用例（`plan/specs/*.md`）。

---

## 共同基础：URL 作用域过滤

无论使用哪种 `exploreScope`，**生成阶段**都会先对探索得到的 `ExplorationGraph` 进行一轮 URL 作用域过滤：

- 入口：`src/plan/orchestrator.ts` 中 `generateTestPlan()`
- 关键逻辑：
  - 读取探索产物 `explore-graph.json`
  - 调用 `filterGraphByScope(graph, config)` 过滤图
  - 再将过滤后的 `graph` 交给 Planner

`filterGraphByScope` 定义在 `src/plan/url-scope.ts`：

- `isUrlInScope(url, config)`：判断单个 URL 是否在作用域内
- `filterGraphByScope(graph, config)`：
  - 只保留 `isUrlInScope(page.url, config) === true` 的页面
  - 丢弃连接到任何已丢失页面的边

### URL 归一化：relativeUrl

在进行模式匹配前，会先把完整 URL 转成相对 URL：

- 使用 `extractRelativeUrl(url)`：
  - 例：`https://console.polyv.net/live/index.html#/channel` → 相对 URL：`/live/index.html#/channel`
  - 即：`pathname + hash`

后续的 pattern 匹配、前缀匹配都针对这个相对 URL 进行。

### 域名限制（Domain Check）

所有模式都会先做域名检查：

- 只有与 `config.baseUrl` **同一 host** 的 URL 才会被认为是候选：
  - 例如：
    - `baseUrl = https://console.polyv.net/live/index.html#/channel`
    - 则 `https://my.polyv.net/v3/login/` 会因 host 不同（`my.polyv.net` vs `console.polyv.net`）被拒绝。

这也是为什么登录页、第三方跳转等不会进入最终的测试计划。

---

## 模式一：site（站点级，默认）

### 行为概览

- **探索阶段**：
  - Agent 可以在同域内自由探索（受 `maxDepth` / `maxPages` / guardrails 限制）。
- **生成阶段**：
  - URL scope 只基于“同域 + includePatterns / excludePatterns（如果有）”来筛选。

### 过滤逻辑（简化解释）

1. 域名检查：必须与 `baseUrl` 同 host。
2. 如果配置了 `excludePatterns`：
   - 任何相对 URL 命中其中任一 pattern → 排除。
3. 如果 **没有配置 `includePatterns`**：
   - 允许同域内的所有 URL → 等价于“整站内都在 scope 中”。
4. 如果 **配置了 `includePatterns`**：
   - 只有相对 URL **至少命中一个 include pattern** 才算在 scope 内。

### 示例：简单后台站点

- 配置：
  - `baseUrl = https://admin.example.com/dashboard`
  - `exploreScope = "site"`
  - 无 `includePatterns` / `excludePatterns`
- 探索可能访问的页面：
  - `/dashboard`
  - `/users`
  - `/orders`
  - `/settings/profile`
- 生成阶段：
  - 上述 `/dashboard`、`/users`、`/orders`、`/settings/profile` 全部会被认为 in-scope，参与测试计划生成。

如果希望在 `site` 模式下只关注 `/orders` 相关页面，可配置：

```jsonc
{
  "plan": {
    "baseUrl": "https://admin.example.com/dashboard",
    "exploreScope": "site",
    "includePatterns": ["/orders*"]
  }
}
```

此时：

- `/orders`、`/orders/123` 会被保留
- `/dashboard`、`/users` 会被过滤掉

---

## 模式二：focused（聚焦模式）

### 设计意图

- 用于“只想测某个模块”的场景。
- 相比 `site`：会**更强依赖 includePatterns**，默认用 `baseUrl` 自动推导一个“模块前缀”。

### 过滤逻辑（简化解释）

1. 域名检查：同 `site`。
2. 先应用 `excludePatterns`（黑名单，所有模式通用）。
3. 对于 `focused`（以及 `single_page`，见下）模式：
   - 如果 `includePatterns` 非空：
     - 只保留相对 URL 命中任一 include pattern 的页面；
   - 如果 `includePatterns` 为空：
     - 自动从 `baseUrl` 推导一个 `baseRelativeUrl`：
       - 例如 `https://console.polyv.net/live/index.html#/channel`
       - 转为 `/live/index.html#/channel`
     - 保留所有 `relativeUrl.startsWith(baseRelativeUrl)` 的页面。

### 示例：只想测订单模块

- 配置：
  - `baseUrl = https://admin.example.com/orders`
  - `exploreScope = "focused"`
  - 无 `includePatterns`
- 探索中访问的相对 URL：
  - `/dashboard`
  - `/orders`
  - `/orders/123`
  - `/orders/123/logs`
- 生成阶段：
  - 计算 `baseRelativeUrl = "/orders"`
  - 只要 `relativeUrl.startsWith("/orders")` 即 in-scope：
    - `/orders` ✅
    - `/orders/123` ✅
    - `/orders/123/logs` ✅
  - `/dashboard` ❌（不以 `/orders` 开头）

如果你显式配置 `includePatterns`：

```jsonc
{
  "plan": {
    "baseUrl": "https://admin.example.com/orders",
    "exploreScope": "focused",
    "includePatterns": ["/orders", "/orders/*"]
  }
}
```

此时 `focused` 模式会使用这些 pattern，而不会再自动从 baseUrl 推导前缀。

---

## 模式三：single_page（单页面 / 子路由族）

> 当前实现中，`single_page` 的含义是：
>
> - 以 `baseUrl` 对应的相对 URL 作为“前缀”，
> - 允许**该前缀下的一整条 hash 子路由链**，
> - 而不是“只允许完全相同的一个 URL”。

从实现角度：

- `single_page` 与 `focused` 在 URL scope 的过滤逻辑**基本一致**：
  - 都会做：域名检查 → excludePatterns → includePatterns / 自动前缀推导
- 主要区别在于：
  - 提示给 Agent 的自然语言指令不同（更强调“在当前页内操作、多做交互，不乱跳模块”），详见 `src/plan/explore-agent.ts` 里的 `urlScopeSection`。

### Polyv 频道管理页面示例（真实 run）

命令：

```bash
autoqa plan \
  -u "https://console.polyv.net/live/index.html#/channel" \
  --max-agent-turns 100 \
  --explore-scope single_page
```

`test-plan.json` 中的配置快照：

```jsonc
"configSnapshot": {
  "baseUrl": "https://console.polyv.net/live/index.html#/channel",
  "exploreScope": "single_page",
  "includePatterns": [],
  "excludePatterns": []
}
```

### 1. 探索阶段访问到的页面（来自 explore-graph.json）

主要 URL：

- 登录页（不同域）：
  - `https://my.polyv.net/v3/login/` → p1
- 控制台首页：
  - `https://console.polyv.net/home/` → p2
- Live 概览：
  - `https://console.polyv.net/live/index.html#/overview` → p4
- 频道管理相关：
  - 列表页：
    - `https://console.polyv.net/live/index.html#/channel` → p3
  - 单个频道详情：
    - `https://console.polyv.net/live/index.html#/channel/6366951/` → p5
  - 频道监控：
    - `https://console.polyv.net/live/index.html#/channel/6366951/monitoring` → p6

探索阶段 Agent 仍然会经过登录、Dashboard 等页面（用于完成登录跳转），但这些 URL 是否参与**生成用例**，取决于后续的 URL scope 过滤。

### 2. single_page 下 URL scope 的具体计算

1. 域名检查：
   - `baseUrl` host 是 `console.polyv.net`
   - 登录页 `https://my.polyv.net/...` 的 host 是 `my.polyv.net` → 被过滤（out-of-scope）。
2. 计算各页面的相对 URL：
   - baseUrl → `extractRelativeUrl`：
     - `https://console.polyv.net/live/index.html#/channel`
     - → `/live/index.html#/channel`（记作 `baseRelativeUrl`）
   - p3：频道列表
     - URL：`https://console.polyv.net/live/index.html#/channel`
     - `relativeUrl = "/live/index.html#/channel"`
   - p5：频道详情
     - URL：`https://console.polyv.net/live/index.html#/channel/6366951/`
     - `relativeUrl = "/live/index.html#/channel/6366951/"`
   - p6：频道监控
     - URL：`https://console.polyv.net/live/index.html#/channel/6366951/monitoring`
     - `relativeUrl = "/live/index.html#/channel/6366951/monitoring"`
   - p2：Dashboard
     - 设 URL 为 `https://console.polyv.net/home/` → `/home/`
   - p4：概览
     - URL：`https://console.polyv.net/live/index.html#/overview`
     - `relativeUrl = "/live/index.html#/overview"`
3. 应用 `single_page` 模式下的 include 逻辑（`includePatterns` 为空）：
   - 自动推导：`baseRelativeUrl = "/live/index.html#/channel"`
   - 判定条件：`relativeUrl.startsWith(baseRelativeUrl)`

于是：

- p3：`"/live/index.html#/channel".startsWith("/live/index.html#/channel")` → ✅ in-scope
- p5：`"/live/index.html#/channel/6366951/".startsWith("/live/index.html#/channel")` → ✅ in-scope
- p6：`"/live/index.html#/channel/6366951/monitoring".startsWith("/live/index.html#/channel")` → ✅ in-scope
- p2：`"/home/".startsWith("/live/index.html#/channel")` → ❌ out-of-scope
- p4：`"/live/index.html#/overview".startsWith("/live/index.html#/channel")` → ❌ out-of-scope

### 3. 生成阶段保留了哪些页面？

在 `test-plan.json` 中：

- `flows[0].pagePath` 只有：
  - `"p3", "p5", "p6"`
- 所有 `cases[*].relatedPageIds` 只引用：
  - p3（列表）、p5（详情）、p6（监控）

也就是说：

- 登录页 p1、Dashboard p2、概览 p4 **仅用于实现登录和导航，不参与最终测试计划**。
- `single_page` 模式下，**“频道管理模块”内的多个路由（列表 + 详情 + 监控）都被认为是“同一页族”**，从而生成：
  - 列表功能用例
  - 从列表进入详情的导航用例
  - 从详情进入监控的导航用例
  - 详情 / 监控自身的功能 / 响应式用例

### 4. 为什么还会看到“多个页面”的用例？

- 由于 `single_page` 的前缀匹配策略，所有 `#/channel` 下的子路由都算作“同一页族”的一部分。
- 所以你会看到：
  - 既有“频道列表”相关用例
  - 也有“频道详情”、“频道监控”等子路由相关用例

这是当前设计下的**预期行为**，不是 bug。

---

## 如何实现“真正只测试一个 URL 页面”

虽然当前代码里 `single_page` 默认会把“相同前缀的子路由”也包含进来，但你可以通过配置收紧 scope，让 Planner 只基于**某一个精确 URL** 生成用例。

### 方法一：通过 includePatterns 精确限制

思路：

- 不改代码，只在 `autoqa.config.json` 中配置 `plan.includePatterns`，
- 不带 `*` 的 pattern 等价于“必须完全等于这个相对 URL”。

以 Polyv 频道列表页为例，如果你只想针对：

- `https://console.polyv.net/live/index.html#/channel`

生成用例，而**不包含详情/监控等页面**，可以在 `autoqa.config.json` 中这样配置：

```jsonc
{
  "plan": {
    "baseUrl": "https://console.polyv.net/live/index.html#/channel",
    "exploreScope": "single_page", // 或 "focused" 也可以
    "includePatterns": [
      "/live/index.html#/channel" // 精确匹配，不带 *
    ]
  }
}
```

这样在 URL scope 判断时：

- 列表页：`relativeUrl = "/live/index.html#/channel"` → 命中 pattern ✅
- 详情页：`relativeUrl = "/live/index.html#/channel/6366951/"` → 不等于 `"/live/index.html#/channel"` → ❌
- 监控页：同理 ❌

最终 Planner 只会基于频道列表页生成用例（功能、导航、响应式等）。

### 方法二：使用前缀通配符控制“模块粒度”

如果你希望“一个模块下所有路由都包括进来”，可以显式使用 `*`：

```jsonc
{
  "plan": {
    "baseUrl": "https://console.polyv.net/live/index.html#/channel",
    "exploreScope": "focused",
    "includePatterns": [
      "/live/index.html#/channel*" // 等价于自动前缀推导的行为
    ]
  }
}
```

这样可以更清晰地表达“我要的是整个频道模块，而不仅仅是 baseUrl 本身”。

---

## 三种模式对比小结

从“生成阶段 URL 过滤”的角度，可以用下表来理解：

| 模式 | 默认行为（无 includePatterns） | 典型用途 |
|------|--------------------------------|----------|
| `site` | 同域内所有 URL（可被 excludePatterns 排除） | 跑一遍整个站点或大范围摸底 |
| `focused` | 以 `baseUrl` 推导前缀，保留该前缀下的所有 URL | 聚焦某个模块（订单、直播、课程等） |
| `single_page` | 与 `focused` 相同的前缀策略，但 Agent 提示更强调“在当前页内做更多交互，不乱跳模块” | 单页/模块的深度交互探索（含其子路由） |

配合 `includePatterns` 使用时：

- 三种模式都会：
  - 先做域名检查 + excludePatterns
  - 再仅保留命中 includePatterns 的 URL
- 区别更多体现在：
  - `site`：语义是“以 includePatterns 筛选整站 URL”
  - `focused`：语义是“指定或推导某个模块的 URL 前缀”
  - `single_page`：语义是“围绕当前页及其子路由族做更细致的交互探索”

---

## 建议的使用模式

- **想要“整站巡检”**：
  - 使用默认 `site`，必要时用 `excludePatterns` 去掉明显无关的区域（如管理后台、统计中心等）。
- **想要“只测某个业务模块”**：
  - 使用 `focused` + `baseUrl = 模块入口 URL`，
  - 根据需要是否声明 `includePatterns`：
    - 不声明 → 自动把该模块前缀下所有子路由包含进来
    - 声明精确 pattern → 精细控制哪些路由参与生成
- **想要“围绕当前单个页面/路由族做细致交互测试”**：
  - 使用 `single_page`，并理解：
    - 默认前缀策略会把“同一前缀下的详情/子页”也算入 scope；
    - 若只想要**某个具体 URL**，请搭配精确 `includePatterns` 使用。

如果之后你希望调整 `single_page` 的实现语义（例如改成“严格只等于 baseUrl 那一条 URL”），可以在不影响 `site` / `focused` 的前提下微调 `src/plan/url-scope.ts` 中的 `isUrlInScope` 逻辑，并增加针对 Polyv 场景的单元测试来防止回归。
