# 发布指南

本项目配置了自动发布到 NPM 的 GitHub Actions。

## 快速发布（推荐）

最简单的方式，一键发布新版本：

```bash
# 发布补丁版本（0.0.1 -> 0.0.2）
npm run release:patch

# 发布次要版本（0.0.1 -> 0.1.0）
npm run release:minor

# 发布主要版本（0.0.1 -> 1.0.0）
npm run release:major

# 发布预发布版本（0.0.1 -> 0.0.2-0）
npm run pre-release
```

这个命令会自动：
1. 更新 package.json 版本号
2. 创建 Git 标签
3. 推送到 GitHub

然后 **GitHub Actions 会自动**：
- 运行测试
- 构建项目
- 发布到 NPM
- 创建 GitHub Release

## 手动发布

```bash
# 只构建和发布（不更新版本号）
npm run release

# 发布 beta 版本
npm run release:beta
```

## GitHub Actions CI/CD

### 自动触发
- **Pull Request**: 自动运行测试
- **Push to main/master**: 自动运行测试和构建
- **Release Published**: 自动发布到 NPM

### 使用 GitHub Release 发布

1. 在 GitHub 创建新的 Release
2. GitHub Actions 会自动检测并发布到 NPM

## 开发流程

1. **开发阶段**
   ```bash
   # 运行测试
   npm test

   # 构建项目
   npm run build
   ```

2. **发布阶段**
   ```bash
   # 选择一个命令执行
   npm run release:patch  # 补丁版本
   npm run release:minor  # 次要版本
   npm run release:major  # 主要版本
   ```

## 前置条件

1. **本地发布需要**：
   - 登录 NPM：`npm login`
   - 有发布权限

2. **GitHub Actions 发布需要**：
   - 在 GitHub 仓库设置中配置 `NPM_TOKEN` secret
   - 详见 [docs/npm-publish-setup.md](docs/npm-publish-setup.md)

## 查看发布状态

- GitHub Actions: https://github.com/nickcmay/autoqa-agent/actions
- NPM 包页面: https://www.npmjs.com/package/autoqa-agent

## 注意事项

- 本地发布会立即推送到 NPM
- 通过 GitHub Release 发布会更安全，有 CI 验证
- 建议使用 `npm run release:patch` 等命令进行本地发布
- 重要版本建议通过 GitHub Release 流程发布