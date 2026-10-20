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

把 Excalidraw 场景能力（读取、写入、绘制、导出）同时暴露给 MCP 客户端与 cordis 宿主。两套接入共用同一套场景逻辑，工具名与参数一致，避免行为分叉。

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/scene.ts` | 场景核心：路径解析、读写、元素展开、修复、SVG 渲染、路径越界校验。不依赖宿主框架 |
| `src/index.ts` | cordis 插件：解析会话工作区，注册四个工具，委托核心 |
| `src/mcp/tools.ts` | MCP 工具定义：zod 入参、工具描述、错误转 `isError` |
| `src/mcp/server.ts` | 组装 `McpServer`，版本从 `package.json` 读取 |
| `src/mcp/http.ts` | Streamable HTTP 传输，无状态，每请求一组 server/transport |
| `src/mcp.ts` | 命令行入口：参数与环境变量解析、stdio 或 HTTP 启动、退出码 |

构建产物为 `lib/`，命令行入口 `lib/mcp.js`（`bin` 名 `excalidraw-mcp`）。

## 接口

MCP 工具：`excalidraw_read`、`excalidraw_write`、`excalidraw_draw`、`excalidraw_export`。

- 成功结果：单个文本块，内容为 JSON 文档。
- 业务失败：`isError: true`，文本块为错误原因。
- 场景默认路径 `<workspace>/.dsh/excalidraw/scene.json`，可用 `--scene` 覆盖。

命令行：`--workspace`、`--scene`、`--http`、`--transport`、`--host`、`--port`、`--token`、`--help`、`--version`；环境变量 `EXCALIDRAW_WORKSPACE`、`EXCALIDRAW_SCENE`、`EXCALIDRAW_MCP_HOST`、`EXCALIDRAW_MCP_PORT`、`EXCALIDRAW_MCP_TOKEN`。

## 上下游依赖

- 上游：`@modelcontextprotocol/sdk` 1.32.1（stdio、Streamable HTTP、内存传输测试）、`zod` 4（入参校验与 JSON Schema 生成）。
- 可选：`@deepseek-ai/cordis`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-workspace`、`@deepseek-ai/dsh-util-values`，仅插件入口使用，声明为可选 peer。
- 下游：任意 MCP 客户端（Claude Code、Codex、OpenCode）；Web 画布标签页共享同一场景文件。

## 重要变更记录

- 0.2.1-rc.2：仅 cordis 插件，场景逻辑与工具注册混在 `src/index.ts`。
- 0.3.0：抽出 `src/scene.ts`；新增 MCP 服务（stdio + Streamable HTTP）；新增命令入口与 `bin`；修复 SVG 导出透明度单位错误；容器形状带 `text` 时生成绑定文本元素。

测试覆盖：`tests/excalidraw-tools.spec.ts`（插件）、`tests/mcp-server.spec.ts`（内存传输）、`tests/mcp-http.spec.ts`（HTTP 与鉴权）、`tests/mcp-cli.spec.ts`（参数解析）。

相关：[MCP 传输选择](../decisions/mcp-transports.md)、[SVG 导出透明度与容器标签](../queries/svg-export-opacity-and-labels.md)。
