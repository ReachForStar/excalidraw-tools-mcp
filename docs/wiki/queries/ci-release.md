---
title: CI 与 GitHub Release 流程
type: query
tags: [ci, github-actions, release, pnpm]
created: 2026-10-20
updated: 2026-10-20
sources: []
status: active
---

# CI 与 GitHub Release 流程

## 目标

每次 push 和 pull request 自动验证类型、测试、构建与打包；发布时手动指定版本号触发 Release，重新验证后把 tarball 和发布说明发布到 GitHub Release。

## Test

文件：`.github/workflows/ci.yml`，工作流显示名称为 `Test`。

触发：

- push 到 `master`、`develop`
- pull request
- 手动 `workflow_dispatch`

步骤：

1. `actions/checkout@v7`
2. `pnpm/action-setup@v6`（pnpm 12）
3. `actions/setup-node@v7`（Node.js 22，pnpm 缓存）
4. `pnpm install --frozen-lockfile`
5. `browser-actions/setup-chrome@v2` 安装 Chrome for Testing，输出路径写入 `EXCALIDRAW_CHROME`
6. `pnpm typecheck`
7. `pnpm test`
8. `pnpm build`
9. `pnpm pack`
10. `actions/upload-artifact@v7` 上传 `reachforstar-excalidraw-tools-*.tgz`

`EXCALIDRAW_CHROME` 必须指向 action 的 `chrome-path` 输出；否则依赖 Chrome 的导出与截图测试会被 `it.skipIf` 跳过，CI 仍会通过但覆盖不完整。

## Release

文件：`.github/workflows/release.yml`

触发：手动 `workflow_dispatch`，输入 `version`（例如 `v0.1.0`）。不监听 tag push，避免普通提交或补推 tag 自动发布。

与 Test 相同的验证步骤，并增加版本校验：

1. 输入必须匹配 `^v[0-9]+\.[0-9]+\.[0-9]+`。
2. 输入必须等于 `package.json` 的 `version` 加 `v` 前缀；不一致时任务失败。
3. 读取 `docs/releases/<version>.md` 作为发布说明；缺失时写入通用说明。
4. `softprops/action-gh-release@v3` 以 `target_commitish: github.sha` 创建或更新 Release，上传 tarball。

工作流需要 `permissions: contents: write`；`GITHUB_TOKEN` 使用仓库默认 token。

发布说明文件命名必须与版本一致，例如 `v0.1.0` 对应 `docs/releases/v0.1.0.md`。发布说明不进入 npm tarball，因为 `package.json` 的 `files` 只包含 `lib/`、README 与 package.json。

## 发布步骤

先更新 `package.json` 版本并完成合并，再手动触发：

```bash
git switch master
git pull --ff-only
gh workflow run release.yml -f version=v0.1.0
```

工作流完成后观察：

```bash
gh run list --workflow release.yml --limit 5
gh run watch <run-id> --exit-status
gh release view v0.1.0
```

Release 工作流会在当前提交上创建或更新 `v0.1.0` tag；不需要手动推送 tag。

## 验证记录

- `develop` CI：run `39434107935`，52 项测试通过，tarball 已上传为 artifact。
- `v0.1.0` Release：待推送 tag 后验证发布说明与 tarball。
- `ubuntu-latest` 当前会提示将在 2026-10-19 后迁移到 Ubuntu 26；升级前复核 Chrome 依赖参数。

## 相关

- [Excalidraw MCP 服务](../entities/excalidraw-mcp-server.md)
- [部署 MCP 到 mcp.togithub.icu](deploy-mcp-togithub.md)
