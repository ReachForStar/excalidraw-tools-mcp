---
type: index
updated: 2026-10-20
---

# Wiki 索引

> 人工/Agent 显式查阅用的完整目录；会话中的导航由 wiki-memory hook 注入的目录树提供。
> 格式：`[页面标题](相对路径) — 一行摘要`。

## 实体 entities

- [Excalidraw MCP 服务](entities/excalidraw-mcp-server.md) — MCP（stdio + Streamable HTTP）与 cordis 插件共用的场景工具，核心在 `src/scene.ts`。

## 概念 concepts

## 源总结 sources

## 决策 decisions

- [分支模型与开发流程](decisions/branch-model.md) — `master` + `develop` 两层分支，功能分支按需切出并合回。
- [MCP 传输选择](decisions/mcp-transports.md) — 默认 stdio，HTTP 采用无状态 Streamable HTTP。
- [导出渲染器选择](decisions/export-renderer.md) — 导出改用 Excalidraw 官方实现，在本机无头 Chrome 中渲染 SVG/PNG。

## 查询沉淀 queries

- [SVG 导出透明度单位与容器标签丢失](queries/svg-export-opacity-and-labels.md) — 0–100 与 0–1 单位混用导致形状近透明；容器文字需绑定文本元素（现仅影响预览渲染）。
