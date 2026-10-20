---
title: Excalidraw MCP 服务
type: entity
tags: [mcp, excalidraw, 模块, 工具]
created: 2026-10-20
updated: 2026-10-20
sources: [README.md]
status: active
---

# Excalidraw MCP 服务

## 职责

把 Excalidraw 场景能力（读取、写入、导入、绘制、导出）同时暴露给 MCP 客户端与 cordis 宿主。两套接入共用同一套场景逻辑，工具名与参数一致，避免行为分叉。

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/scene.ts` | 场景核心：路径解析、读写、导入、元素展开、修复、预览 SVG 渲染、导出编排、路径越界校验。不依赖宿主框架 |
| `src/render.ts` | 导出渲染器：探测 Chrome、无头启动、桥接页调用 Excalidraw 自带导出、输出 SVG/PNG |
| `src/index.ts` | cordis 插件：解析会话工作区，注册五个工具，委托核心 |
| `src/mcp/tools.ts` | MCP 工具定义：zod 入参、工具描述、错误转 `isError` |
| `src/mcp/server.ts` | 组装 `McpServer`，版本从 `package.json` 读取 |
| `src/mcp/http.ts` | Streamable HTTP 传输，无状态，每请求一组 server/transport |
| `src/mcp.ts` | 命令行入口：参数与环境变量解析、stdio 或 HTTP 启动、退出码 |

构建产物为 `lib/`，命令行入口 `lib/mcp.js`（`bin` 名 `excalidraw-mcp`）。

## 接口

MCP 工具：`excalidraw_read`、`excalidraw_write`、`excalidraw_import`、`excalidraw_draw`、`excalidraw_export`。

- 成功结果：单个文本块，内容为 JSON 文档。
- 业务失败：`isError: true`，文本块为错误原因。
- 场景固定路径 `<workspace>/.agents/excalidraw/scene.json`，可用 `--scene` 覆盖；导出默认写到 `.agents/excalidraw/export.svg`，PNG 写到 `.agents/excalidraw/export.png`，原生文件写到 `.agents/excalidraw/export.excalidraw`。
- `excalidraw_export` 接受 `format`（`svg` / `png` / `excalidraw`）、`scale`（PNG 0.5–4）、`transparent` 与 `path`；结果含 `format`、`bytes`，SVG/PNG 另含 `width`、`height`。`svg` 与 `png` 走 Excalidraw 官方导出，需要本机 Chrome/Chromium；`excalidraw` 直接写原生场景文件，不需要浏览器。
- `excalidraw_import` 读取工作区内 `path` 指向的文件（原生 `.excalidraw` 或裸 `{elements, appState}` JSON），修复元素后整体替换场景，保留 `files` 中的嵌入图片；素材库（`type: "excalidrawlib"`）被拒绝。导入路径与导出路径同样不得越出工作区。
- `excalidraw_draw` 会保留场景中已有的 `files`，不会因追加形状而丢失嵌入图片。
- 单进程多工作区：`WorkspaceScope` 保存允许的根目录，五个工具都接受可选 `workspace` 参数（绝对路径或相对首个根目录），目标必须位于某个根目录内且已存在。
- 场景文件大小无上限：读写均不按体积拒绝；仅 `excalidraw_read` 在超过 128 KB 时省略 `sceneJson` 回显。

命令行：`--workspace`（可重复）、`--scene`（仅单工作区）、`--http`、`--transport`、`--host`、`--port`、`--token`、`--chrome`、`--help`、`--version`；环境变量 `EXCALIDRAW_WORKSPACE`、`EXCALIDRAW_SCENE`、`EXCALIDRAW_MCP_HOST`、`EXCALIDRAW_MCP_PORT`、`EXCALIDRAW_MCP_TOKEN`、`EXCALIDRAW_CHROME`。

## 上下游依赖

- 上游：`@modelcontextprotocol/sdk` 1.32.1（stdio、Streamable HTTP、内存传输测试）、`zod` 4（入参校验与 JSON Schema 生成）。
- 导出：`@excalidraw/utils` 0.1.5（Excalidraw 官方导出实现，prod 包约 19 MB；版本锁定，0.1.6 的接口改为 `exportScene`，升级前须改桥接页）、`playwright-core`（驱动本机浏览器，不下载浏览器）、运行环境需 Chrome/Chromium。
- 可选：`@deepseek-ai/cordis`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-workspace`、`@deepseek-ai/dsh-util-values`，仅插件入口使用，声明为可选 peer。
- 下游：任意 MCP 客户端（Claude Code、Codex、OpenCode）；Web 画布标签页共享同一场景文件。

## 重要变更记录

- 0.2.1-rc.2：仅 cordis 插件，场景逻辑与工具注册混在 `src/index.ts`。
- 0.3.0：抽出 `src/scene.ts`；新增 MCP 服务（stdio + Streamable HTTP）；新增命令入口与 `bin`；修复 SVG 导出透明度单位错误；容器形状带 `text` 时生成绑定文本元素。
- 0.5.0：导出改用 Excalidraw 官方实现，在无头 Chrome 中渲染；新增 PNG 输出与 `scale`、`--chrome`；手绘纹理、嵌入图片与自动换行随官方渲染还原。
- 0.4.0：单进程支持多工作区；工具新增 `workspace` 参数，`--workspace` 可重复传入。
- 0.3.1：场景路径由 `.dsh/excalidraw/scene.json` 改为固定的 `.agents/excalidraw/scene.json`（同工作区所有 agent 共用）；移除写入 1 MB 上限，场景文件大小不设限，读回显仍以 128 KB 为界。
- 0.6.0：新增 `excalidraw_import`，把工作区内的 `.excalidraw` 文件导入为当前场景；`excalidraw_export` 增加 `format: "excalidraw"`，直接写原生场景文件（无需浏览器）；`excalidraw_draw` 保留已有 `files`。

测试覆盖：`tests/excalidraw-tools.spec.ts`（插件）、`tests/mcp-server.spec.ts`（内存传输与导入导出）、`tests/mcp-http.spec.ts`（HTTP 与鉴权）、`tests/mcp-cli.spec.ts`（参数解析）。

相关：[MCP 传输选择](../decisions/mcp-transports.md)、[导出渲染器选择](../decisions/export-renderer.md)、[SVG 导出透明度与容器标签](../queries/svg-export-opacity-and-labels.md)。
