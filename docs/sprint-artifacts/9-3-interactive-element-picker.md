# Story 9.3: 页面元素选择器（Interactive Element Picker）

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a QA 工程师,
I want 在修复模式中点击页面上的元素，自动生成 Playwright locator 代码,
So that 我不需要手动编写 CSS selector 或 XPath，系统会自动生成多个候选 locator 并按优先级排序供我选择。

## Acceptance Criteria

**Given** 进入交互式修复模式，浏览器已打开并重放到失败步骤的页面状态
**When** 用户选择"启动元素选择器"选项
**Then** 系统应向页面注入元素选择脚本，在鼠标悬停时高亮显示元素
**And** 高亮框应跟随鼠标移动，显示当前悬停元素的边界

**Given** 元素选择模式已启用，鼠标悬停在某个元素上
**When** 用户点击该元素
**Then** 系统应分析元素属性，生成多个 Playwright locator 候选
**And** 每个候选应标注 locator 类型（如 `page.locator('#submit-btn')`）
**And** 候选列表应按优先级排序（data-testid > role > id > text > class > tag）

**Given** 系统生成了多个 locator 候选
**When** 显示候选列表时
**Then** 每个候选应标注唯一性验证结果（如"唯一"或"3 个匹配"）
**And** 应推荐唯一性最佳的 locator
**And** 用户可选择使用推荐的 locator 或输入其他序号选择

## Tasks / Subtasks

- [x] Task 1: 创建元素选择器核心模块 (AC: #1)
  - [x] Subtask 1.1: 创建 `src/repair/element-picker.ts` 文件
  - [x] Subtask 1.2: 实现 `injectElementPicker()` 函数，注入高亮框和 tooltip
  - [x] Subtask 1.3: 实现 `removeElementPicker()` 函数，清理注入的 DOM 元素和事件监听器
  - [x] Subtask 1.4: 在页面上下文中实现 `analyzeElement()` 函数，提取元素属性
- [x] Task 2: 实现 locator 生成逻辑 (AC: #2)
  - [x] Subtask 2.1: 实现 `generateLocatorCandidates()` 函数，按优先级生成候选列表
  - [x] Subtask 2.2: 支持 data-testid、data-test、data-cy 属性（优先级 100-90）
  - [x] Subtask 2.3: 支持 ID、Role+Name、Placeholder 属性（优先级 80-60）
  - [x] Subtask 2.4: 支持 Text、ARIA Label、Name 属性（优先级 50-30）
  - [x] Subtask 2.5: 支持 CSS Class、Tag 作为备用选项（优先级 20-10）
- [x] Task 3: 实现 locator 唯一性验证 (AC: #3)
  - [x] Subtask 3.1: 实现 `validateLocatorUniqueness()` 函数，使用 `page.locator(selector).count()` 验证
  - [x] Subtask 3.2: 将验证结果附加到每个候选（`isUnique`, `matchCount`）
  - [x] Subtask 3.3: 实现推荐算法，优先选择 `isUnique: true` 且优先级最高的候选
- [x] Task 4: 集成到 RepairCoordinator (AC: #1, #2, #3)
  - [x] Subtask 4.1: 修改 `coordinator.ts`，添加 `enableElementPicker()` 方法
  - [x] Subtask 4.2: 实现 `waitForElementSelection()` 方法，监听元素选择事件
  - [x] Subtask 4.3: 实现用户交互循环：显示候选 -> 用户选择 -> 返回 `LocatorCandidate`
- [x] Task 5: 实现 CLI 用户交互界面 (AC: #2, #3)
  - [x] Subtask 5.1: 实现候选列表格式化输出函数
  - [x] Subtask 5.2: 实现用户输入解析（支持 Y/n、序号选择）
  - [x] Subtask 5.3: 添加"跳过"、"退出"等命令处理
- [x] Task 6: 添加单元测试
  - [x] Subtask 6.1: 测试元素属性提取逻辑
  - [x] Subtask 6.2: 测试 locator 候选生成优先级
  - [x] Subtask 6.3: 测试唯一性验证逻辑

## Dev Notes

### 架构上下文

本故事是 Epic 9 的第三个故事，负责实现页面元素选择器功能。用户在修复模式下点击页面元素，系统自动生成 Playwright locator 代码。

**依赖关系：**
- Story 9.1 (done): 提供了 RepairCoordinator 基础框架
- Story 9.2 (done): 提供了 IR 重放功能，确保页面状态正确恢复
- 本故事扩展 RepairCoordinator，添加元素选择能力

**参考实现：**
`examples/repair-dashboard/playwright-picker.ts` 是一个完整的元素选择器参考实现，包含：
- 高亮框和 tooltip 的注入脚本
- 元素属性提取逻辑
- Locator 候选生成优先级算法
- 唯一性验证逻辑

### 现有代码分析

**RepairCoordinator (`src/repair/coordinator.ts`)：**
- `startRepairMode()` 已经实现了浏览器启动和 IR 重放
- 重放成功后，`this.state.page` 可用于注入元素选择器
- 需要添加新方法：
  - `enableElementPicker()`: 注入选择脚本并启动监听
  - `waitForElementSelection()`: 等待用户点击元素并返回候选

**IR 类型 (`src/ir/types.ts`)：**
- `LocatorCandidate` 类型已定义：
  ```typescript
  export type LocatorCandidate = {
    kind: LocatorKind
    value: string
    code: string
    validation: LocatorValidation
  }
  ```
- `LocatorKind` 枚举已定义：`getByTestId`, `getByRole`, `getByLabel`, `getByPlaceholder`, `cssId`, `cssAttr`, `cssSelector`, `textExact`, `text`
- `LocatorValidation` 类型已定义：`unique`, `visible`, `enabled`, `editable`

### Locator 生成优先级（按 Tech Spec 规范）

| 优先级 | 来源 | 示例 | LocatorKind |
|--------|------|------|-------------|
| 100 | data-testid | `page.getByTestId('submit-btn')` | getByTestId |
| 95 | data-test | `page.getByTestId('submit')` | getByTestId |
| 90 | data-cy | `page.getByTestId('cy-submit')` | getByTestId |
| 80 | ID | `page.locator('#submit')` | cssId |
| 70 | Role + Name | `page.getByRole('button', { name: 'Submit' })` | getByRole |
| 60 | Placeholder | `page.getByPlaceholder('Email')` | getByPlaceholder |
| 50 | Exact Text | `page.getByText('Submit', { exact: true })` | textExact |
| 40 | Partial Text | `page.getByText('Sub')` | text |
| 30 | ARIA Label | `page.getByLabel('Email')` | getByLabel |
| 20 | Name 属性 | `page.locator('[name="email"]')` | cssAttr |
| 10 | CSS Class | `page.locator('.btn')` | cssSelector |
| 5 | Tag | `page.locator('button')` | cssSelector |

### 实现约束

1. **页面注入脚本：**
   - 使用 `page.evaluate()` 向页面注入 DOM 元素和事件监听器
   - 高亮框使用固定定位（`position: fixed`），`z-index: 999999`
   - 事件监听器使用捕获阶段（`useCapture: true`）以确保优先捕获

2. **事件通信：**
   - 页面内的点击事件通过 `console.log('__AUTOQA_SELECTED__:' + JSON.stringify(info))` 发送
   - Node.js 端通过 `page.on('console', ...)` 监听并解析消息
   - 或者使用 `page.exposeFunction()` 实现双向通信

3. **唯一性验证：**
   - 使用 `page.locator(selector).count()` 获取匹配数量
   - `count === 1` 表示唯一
   - 对于 `getByRole` 等复杂 locator，需要提取内部 selector 进行验证

4. **错误处理：**
   - 元素选择器注入失败不应影响修复模式退出
   - 提供 `removeElementPicker()` 清理函数，确保资源释放

5. **可观测性：**
   - 使用 pino 日志记录元素选择事件
   - 日志字段：`runId`, `specPath`, `stepIndex`, `selectedElement`, `generatedCandidates`

### 项目结构说明

**新增文件：**
```
src/repair/
└── element-picker.ts    # 元素选择器核心逻辑

tests/unit/repair/
└── element-picker.test.ts  # 元素选择器单元测试
```

**修改文件：**
```
src/repair/
├── coordinator.ts        # 添加 enableElementPicker(), waitForElementSelection()
└── index.ts              # 导出 element-picker 模块
```

### 技术栈

- TypeScript 5.9.3
- Playwright 1.57.0（页面注入和 locator 验证）
- Pino 10.1.0（日志）
- Node.js readline（CLI 用户交互）

### 测试标准

- 单元测试：`tests/unit/repair/element-picker.test.ts`
- 测试元素属性提取（tagName, id, className, text, role, etc.）
- 测试 locator 候选生成优先级排序
- 测试唯一性验证逻辑
- Mock Page 对象进行测试

### 参考

- Tech Spec: [Source: docs/sprint-artifacts/epic-9-interactive-repair-mode.md#Element Picker]
- 参考实现: [Source: examples/repair-dashboard/playwright-picker.ts]
- IR 类型: [Source: src/ir/types.ts]
- Story 9.1: [Source: docs/sprint-artifacts/9-1-export-failure-auto-start-repair-mode.md]
- Story 9.2: [Source: docs/sprint-artifacts/9-2-ir-replay-to-failed-step.md]
- Epic 9 故事定义: [Source: docs/epics.md#Epic 9]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

### Completion Notes List

- 实现了完整的元素选择器核心模块 (`src/repair/element-picker.ts`)：
  - `injectElementPicker()`: 注入高亮框和 tooltip，监听鼠标悬停和点击事件
  - `removeElementPicker()`: 清理注入的 DOM 元素和事件监听器
  - `generateLocatorCandidates()`: 按优先级生成 locator 候选（100-5）
  - `validateLocatorUniqueness()`: 使用 `page.locator(selector).count()` 验证唯一性
  - `generateAndValidateLocators()`: 组合生成和验证流程
  - `recommendBestLocator()`: 推荐最佳 locator（优先唯一且高优先级）
  - `waitForElementSelection()`: 等待用户选择元素
  - `formatLocatorCandidates()`: 格式化候选列表供 CLI 显示
- 扩展了 `RepairCoordinator` 接口和实现：
  - 添加 `enableElementPicker()` 方法启用元素选择器
  - 添加 `disableElementPicker()` 方法禁用元素选择器
  - 添加 `waitForElementSelection()` 方法等待用户选择
  - 添加 `promptLocatorChoice()` 方法显示候选并获取用户选择
  - 更新 `cleanup()` 方法确保元素选择器被正确清理
- 添加了完整的单元测试覆盖（33 个测试）：
  - 测试所有 11 种 locator 优先级生成逻辑
  - 测试 ID 过滤规则（跳过数字 ID 和过长 ID）
  - 测试 CSS class 过滤规则（跳过状态类）
  - 测试 locator 代码到 CSS selector 的转换
  - 测试推荐算法逻辑
  - 测试候选列表格式化输出
- 所有 744 个测试通过，无回归
- 构建成功，无 TypeScript 错误

### File List
- src/repair/element-picker.ts (new)
- src/repair/coordinator.ts (modified: added element picker integration)
- src/repair/index.ts (modified: added element-picker export)
- tests/unit/repair/element-picker.test.ts (new)
