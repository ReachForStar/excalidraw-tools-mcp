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

把 Excalidraw 画布能力同时暴露给 MCP 客户端与 cordis 宿主：场景读写与导入导出、多图形管理、元素级增删改查、布局变换、外部图片插入、画布描述与 PNG 截图。两套接入共用 `src/scene.ts`、`src/elements.ts`、`src/drawings.ts`，工具名与参数一致，避免行为分叉。

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/scene.ts` | 场景核心：路径与图形 id 校验、场景读写、描述生成、元素修复、导入、导出编排、截图、路径越界校验。不依赖宿主框架 |
| `src/elements.ts` | 元素级操作：创建/读取/更新/删除、布局（对齐/分布/分组/锁定/复制）、外部图片插入 |
| `src/drawings.ts` | 图形管理：创建/读取/更新/删除/列表/原生 JSON 导出 |
| `src/render.ts` | 导出渲染器：探测 Chrome、无头启动、桥接页调用 Excalidraw 自带导出、输出 SVG/PNG |
| `src/plugin/` | cordis 插件工具注册，按场景、图形、元素、布局、媒体拆分；`shared.ts` 解析目标与公共参数 |
| `src/index.ts` | cordis 插件入口：汇总五个注册模块，导出核心常量与函数 |
| `src/mcp/tools/` | MCP 工具定义，按场景、图形、元素、布局、媒体拆分；`common.ts` 负责结果包装与 workspace/drawing 目标解析 |
| `src/mcp/tools.ts` | 注册全部 18 个 MCP 工具的 barrel |
| `src/mcp/server.ts` | 组装 `McpServer`，版本从 `package.json` 读取 |
| `src/mcp/http.ts` | Streamable HTTP 传输，无状态，每请求一组 server/transport |
| `src/mcp.ts` | 命令行入口：参数与环境变量解析、stdio 或 HTTP 启动、退出码 |

构建产物为 `lib/`，命令行入口 `lib/mcp.js`（`bin` 名 `excalidraw-mcp`）。

## 接口

### 工具面

| 类别 | 工具 |
| --- | --- |
| 场景 | `excalidraw_read`、`excalidraw_write`、`excalidraw_import`、`excalidraw_draw`、`excalidraw_export` |
| 图形管理 | `excalidraw_create_drawing`、`excalidraw_get_drawing`、`excalidraw_update_drawing`、`excalidraw_delete_drawing`、`excalidraw_list_drawings`、`excalidraw_export_to_json` |
| 元素 | `excalidraw_element_create`、`excalidraw_element_get`、`excalidraw_element_update`、`excalidraw_element_delete` |
| 布局 | `excalidraw_layout` |
| 媒体 | `excalidraw_add_image`、`excalidraw_screenshot` |

- 成功结果：MCP 返回单个文本块，内容为 JSON 文档；`excalidraw_screenshot` 额外返回 `image/png` 内容块。cordis 插件返回结构化对象。
- 业务失败：MCP 以 `isError: true` 返回错误原因，不中断连接。
- 全部工具接受可选 `workspace`（绝对路径或相对首个根目录）；画布类工具接受可选 `drawing`，省略时为 `default`。
- 默认图形路径 `<workspace>/.agents/excalidraw/scene.json`，命名图形 `<workspace>/.agents/excalidraw/drawings/<id>.json`；`--scene` 只覆盖默认图形。
- 图形 id 匹配 `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`，拒绝 Windows 设备名与路径穿越。
- 导出默认路径：默认图形 `.agents/excalidraw/export.svg` / `export.png` / `export.excalidraw`；命名图形 `.agents/excalidraw/exports/<id>.<ext>`。截图默认路径：默认图形 `.agents/excalidraw/screenshot.png`，命名图形 `.agents/excalidraw/screenshots/<id>.png`。
- 场景文件大小无上限；仅 `excalidraw_read` 在超过 128 KB 时省略 `sceneJson` 回显，摘要、元素列表与 `description` 照常返回。
- 描述超过 300 个元素或 64 KB 时截断；预览 SVG 上限 64 KB。

### 关键行为

- `excalidraw_read` / `excalidraw_get_drawing` 返回 `cwd`、`drawing`、`path`、`exists`、`summary`、`elements`、`description`，文件较小时附 `sceneJson`。
- `excalidraw_element_create` 可自带 id，重复 id 整体拒绝；图片元素必须有 `fileId`，应改用 `excalidraw_add_image`。
- `excalidraw_element_update` 浅合并补丁，`id` 与 `type` 不可改；合并后不可渲染则拒绝写入。
- `excalidraw_element_delete` 连带删除容器绑定的文本，并清理剩余元素的绑定字段。
- `excalidraw_layout` 省略 `ids` 时选择全部可见元素；选区扩展到完整分组与绑定文本；复制时重新映射分组、绑定文本与箭头绑定。
- `excalidraw_add_image` 支持 png/jpeg/gif/webp/svg，按文件头读尺寸，二进制写入场景 `files`；只给一个尺寸时保持宽高比。
- `excalidraw_screenshot` 与 SVG/PNG 导出共用 Chrome 渲染；`scale` 取 0.5–4，`transparent` 控制背景。
- `excalidraw_export` 的 `svg`/`png` 与截图需要本机 Chrome/Chromium；`excalidraw` 格式与 `excalidraw_import` 不需要浏览器。导入保留 `files`，拒绝素材库。
- 单进程多工作区：`WorkspaceScope` 保存允许的根目录与可选默认场景路径，目标必须位于某个根目录内且已存在。

### 命令行

`--workspace`（可重复）、`--scene`（仅单工作区）、`--http`、`--transport`、`--host`、`--port`、`--token`、`--chrome`、`--help`、`--version`；环境变量 `EXCALIDRAW_WORKSPACE`、`EXCALIDRAW_SCENE`、`EXCALIDRAW_MCP_HOST`、`EXCALIDRAW_MCP_PORT`、`EXCALIDRAW_MCP_TOKEN`、`EXCALIDRAW_CHROME`。

## 上下游依赖

- 上游：`@modelcontextprotocol/sdk` 1.32.1（stdio、Streamable HTTP、内存传输测试）、`zod` 4（入参校验与 JSON Schema 生成）。
- 导出：`@excalidraw/utils` 0.1.5（Excalidraw 官方导出实现，prod 包约 19 MB；版本锁定，0.1.6 的接口改为 `exportScene`，升级前须改桥接页）、`playwright-core`（驱动本机浏览器，不下载浏览器）、运行环境需 Chrome/Chromium。
- 图片：`image-size` 2.0.4 读取 PNG/JPEG/GIF/WebP/SVG 的原始尺寸。
- 可选：`@deepseek-ai/cordis`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-workspace`、`@deepseek-ai/dsh-util-values`，仅插件入口使用，声明为可选 peer。
- 下游：任意 MCP 客户端（Claude Code、Codex、OpenCode）；Web 画布标签页共享同一批场景文件。

## 重要变更记录

- 0.2.1-rc.2：仅 cordis 插件，场景逻辑与工具注册混在 `src/index.ts`。
- 0.3.0：抽出 `src/scene.ts`；新增 MCP 服务（stdio + Streamable HTTP）；新增命令入口与 `bin`；修复 SVG 导出透明度单位错误；容器形状带 `text` 时生成绑定文本元素。
- 0.3.1：场景路径由 `.dsh/excalidraw/scene.json` 改为固定的 `.agents/excalidraw/scene.json`；移除写入 1 MB 上限，读回显仍以 128 KB 为界。
- 0.4.0：单进程支持多工作区；工具新增 `workspace` 参数，`--workspace` 可重复传入。
- 0.5.0：导出改用 Excalidraw 官方实现，在无头 Chrome 中渲染；新增 PNG 输出与 `scale`、`--chrome`。
- 0.6.0：新增 `excalidraw_import` 与 `format: "excalidraw"` 原生导出；`excalidraw_draw` 保留已有 `files`。
- 本次：新增多图形管理、元素级增删改查、布局变换、外部图片插入、画布描述与 PNG 截图；工具从 5 个扩展到 18 个；插件与 MCP 工具按功能拆分模块；引入 `image-size`。
测试覆盖：`tests/excalidraw-tools.spec.ts`（插件）、`tests/mcp-server.spec.ts`（内存传输、图形/元素/布局/图片/截图）、`tests/mcp-http.spec.ts`（HTTP 与鉴权）、`tests/mcp-cli.spec.ts`（参数解析），共 49 项。

相关：[多图形存储](../decisions/multi-drawing-storage.md)、[元素级工具面](../decisions/canvas-tools-surface.md)、[MCP 传输选择](../decisions/mcp-transports.md)、[导出渲染器选择](../decisions/export-renderer.md)、[SVG 导出透明度与容器标签](../queries/svg-export-opacity-and-labels.md)。
