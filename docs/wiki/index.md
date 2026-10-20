---
type: index
updated: 2026-10-20
---

# Wiki 索引

> 人工/Agent 显式查阅用的完整目录；会话中的导航由 wiki-memory hook 注入的目录树提供。
> 格式：`[页面标题](相对路径) — 一行摘要`。

## 实体 entities

- [Excalidraw MCP 服务](entities/excalidraw-mcp-server.md) — MCP（stdio + Streamable HTTP）与 cordis 插件共用的画布工具（场景、多图形、元素、布局、图片、截图、导出），核心在 `src/scene.ts`、`src/elements.ts`、`src/drawings.ts`。

## 概念 concepts

## 源总结 sources

## 决策 decisions

- [分支模型与开发流程](decisions/branch-model.md) — `master` + `develop` 两层分支，功能分支按需切出并合回。
- [MCP 传输选择](decisions/mcp-transports.md) — 默认 stdio，HTTP 采用无状态 Streamable HTTP。
- [导出渲染器选择](decisions/export-renderer.md) — 导出改用 Excalidraw 官方实现，在本机无头 Chrome 中渲染 SVG/PNG。
- [多图形存储与命名规则](decisions/multi-drawing-storage.md) — 默认图形沿用 `scene.json`，命名图形存 `drawings/<id>.json`，严格校验 id 与默认导出路径。
- [元素级工具面与布局语义](decisions/canvas-tools-surface.md) — 按功能拆成 18 个工具；元素补丁、布局选区扩展、图片嵌入与截图返回形态。

## 查询沉淀 queries

- [SVG 导出透明度单位与容器标签丢失](queries/svg-export-opacity-and-labels.md) — 0–100 与 0–1 单位混用导致形状近透明；容器文字需绑定文本元素（现仅影响预览渲染）。
- [部署 MCP 到 mcp.togithub.icu](queries/deploy-mcp-togithub.md) — 单租户公网部署：独立 Nginx、systemd、Chrome、DNS-01 证书、验证结果与续期注意事项。
- [CI 与 GitHub Release 流程](queries/ci-release.md) — push/PR 验证 typecheck、test、build、pack；`v*` tag 自动发布说明与 tarball。
