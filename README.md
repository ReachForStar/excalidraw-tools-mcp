---
description: "Excalidraw 场景工具：以 MCP 服务（stdio / Streamable HTTP）或 cordis 插件形式提供读取、写入、导入、绘制、导出。"
---

# @reachforstar/excalidraw-tools

[English](README.md) | 中文

## 概述

面向模型的 Excalidraw 场景工具，提供两种接入形态：

- **MCP 服务**：`excalidraw-mcp` 命令，供 Claude Code、Codex、OpenCode 等任意 MCP 客户端使用，支持 stdio 与 Streamable HTTP 两种传输。
- **cordis 插件**：默认入口，注入宿主工具注册表，从调用方会话解析工作区。

两种形态共用同一套场景逻辑（`src/scene.ts`），读写同一个场景文件，工具名与参数一致。

## 目录

- [安装](#install)
- [作为 MCP 服务](#mcp)
- [命令行选项](#cli)
- [工具](#tools)
- [场景文件](#scene-file)
- [导出](#export-limits)
- [作为 cordis 插件](#plugin)
- [安全](#security)
- [开发与测试](#dev)
- [已知限制](#known-limitations)

-----

<a id="install"></a>
## 安装

```sh
pnpm install
pnpm run build
```

构建产物在 `lib/`，命令行入口为 `lib/mcp.js`。发布后可直接用 `npx -y @reachforstar/excalidraw-tools`；未发布时使用仓库内的绝对路径。

导出 SVG 与 PNG 由本机 Chrome/Chromium 渲染，`.excalidraw` 导出与导入不需要浏览器。安装后若导出报错提示找不到浏览器，请安装 Google Chrome，或用 `--chrome` / `EXCALIDRAW_CHROME` 指定可执行文件路径。

<a id="mcp"></a>
## 作为 MCP 服务

### stdio（默认）

```sh
node /abs/path/lib/mcp.js --workspace /abs/path/to/project
```

客户端负责拉起进程并通过 stdin/stdout 通信，日志只写 stderr。

Claude Code：

```sh
claude mcp add excalidraw -- node /abs/path/lib/mcp.js --workspace /abs/path/to/project
```

Codex（`~/.codex/config.toml`）：

```toml
[mcp_servers.excalidraw]
command = "node"
args = ["/abs/path/lib/mcp.js", "--workspace", "/abs/path/to/project"]
```

OpenCode（`opencode.json`）：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "excalidraw": {
      "type": "local",
      "command": ["node", "/abs/path/lib/mcp.js", "--workspace", "/abs/path/to/project"],
      "enabled": true
    }
  }
}
```

通用 `.mcp.json`：

```json
{
  "mcpServers": {
    "excalidraw": {
      "command": "node",
      "args": ["/abs/path/lib/mcp.js", "--workspace", "/abs/path/to/project"]
    }
  }
}
```

### Streamable HTTP

```sh
node /abs/path/lib/mcp.js --http --port 7801 --workspace /abs/path/to/project --token "$EXCALIDRAW_MCP_TOKEN"
```

端点固定为 `POST /mcp`，无状态：每个请求独立处理，不保存会话。默认只监听 `127.0.0.1`；设置 `--token` 后要求 `Authorization: Bearer <token>`。

OpenCode 远程配置：

```json
{
  "mcp": {
    "excalidraw": {
      "type": "remote",
      "url": "http://127.0.0.1:7801/mcp",
      "headers": { "Authorization": "Bearer <token>" },
      "enabled": true
    }
  }
}
```

Claude Code：

```sh
claude mcp add --transport http excalidraw http://127.0.0.1:7801/mcp -H "Authorization: Bearer <token>"
```

一个进程可以服务多个工作区：`--workspace` 可重复传入（环境变量用操作系统的路径分隔符连接，Linux/macOS 为 `:`，Windows 为 `;`），每个工具调用用 `workspace` 参数指定目标工作区。省略 `workspace` 时使用第一个根目录。

<a id="cli"></a>
## 命令行选项

| 选项 | 环境变量 | 默认值 | 说明 |
|---|---|---|---|
| `-w, --workspace <dir>` | `EXCALIDRAW_WORKSPACE` | 当前目录 | 工作区根目录，导出路径的边界；可重复传入 |
| `--scene <path>` | `EXCALIDRAW_SCENE` | `.agents/excalidraw/scene.json` | 场景文件，绝对路径或工作区相对路径；仅单工作区可用 |
| `--http` | — | 关闭 | 使用 Streamable HTTP 而非 stdio |
| `--transport <stdio\|http>` | — | `stdio` | 传输方式 |
| `--host <host>` | `EXCALIDRAW_MCP_HOST` | `127.0.0.1` | HTTP 监听地址 |
| `--port <port>` | `EXCALIDRAW_MCP_PORT` | `7801` | HTTP 端口，`0` 表示自动分配 |
| `--token <token>` | `EXCALIDRAW_MCP_TOKEN` | 无 | HTTP 要求 Bearer 令牌 |
| `--chrome <path>` | `EXCALIDRAW_CHROME` | 自动探测 | 导出 SVG/PNG 使用的 Chrome/Chromium 可执行文件 |
| `-h, --help` | — | — | 帮助 |
| `-v, --version` | — | — | 版本 |

工作区不存在或参数非法时以退出码 2 结束，启动失败以 1 结束。同时传入 `--scene` 与多个工作区会被拒绝，因为一个固定场景文件无法描述多个工作区。

<a id="tools"></a>
## 工具

| 工具 | 用途 |
|---|---|
| `excalidraw_read` | 返回场景摘要（按类型统计、文本元素、主题）、紧凑元素列表，文件较小时附带完整场景 JSON |
| `excalidraw_write` | 用完整场景 JSON 字符串覆盖场景，写入前修复缺字段元素 |
| `excalidraw_import` | 读取工作区内的 `.excalidraw` 文件（或任意含 `elements`/`appState` 的 JSON），修复后替换当前场景，保留嵌入图片 |
| `excalidraw_draw` | 用高层描述（`type`、位置、尺寸、可选 text/points/样式）添加或替换形状 |
| `excalidraw_export` | 用 Excalidraw 官方导出把场景渲染成工作区内的 SVG 或 PNG，或写出原生 `.excalidraw` 文件 |

五个工具都接受可选的 `workspace` 参数：工作区目录的绝对路径，或相对第一个根目录的路径。该目录必须位于已允许的根目录之内且已存在，否则调用以 `isError` 拒绝。

`excalidraw_draw` 会补齐 Excalidraw 渲染所需的全部字段（seed、version、index、nonce），调用方无需手写内部元素字段。支持的 `type`：`rectangle`、`ellipse`、`diamond`、`text`、`arrow`、`line`。在 `rectangle`、`ellipse`、`diamond` 上设置 `text` 会生成居中的绑定文本元素，即带标签的方框。

返回值为单个文本块，内容为 JSON 文档：

```json
{"ok":true,"cwd":"/abs/path/to/project","added":2,"totalElements":2,"skipped":0}
```

参数校验失败、路径越界、场景缺失等业务错误以 `isError: true` 返回，文本块内是错误原因，不会中断连接。

<a id="scene-file"></a>
## 场景文件

场景对象是 Excalidraw 持久化的结构：`{ elements, appState, files? }`。固定路径为 `<workspace>/.agents/excalidraw/scene.json`，同工作区的所有 agent 共用一个画布；用 `--scene` 可以指向任意 `.excalidraw` 文件。导出默认写到 `<workspace>/.agents/excalidraw/export.svg`，PNG 写到 `export.png`，原生文件写到 `export.excalidraw`。

场景文件大小不设上限：`excalidraw_write` 与 `excalidraw_draw` 按文件实际大小读写，不因体积拒绝。工具执行以下边界：

| 边界 | 值 |
|---|---|
| `excalidraw_write` / `excalidraw_draw` 场景大小 | 无上限 |
| `excalidraw_read` 完整 JSON 回显上限 | 128 KB（超出时省略 `sceneJson`，摘要与元素列表照常返回） |
| `excalidraw_draw` 每次调用形状数 | 256 |
| 返回的预览 SVG 上限 | 64 KB |
| 导出/导入路径越界 | 拒绝（`..`、前导 `/`、反斜杠、解析后落在工作区外） |

场景文件缺失时读作空画布；场景损坏（非 JSON）时读作空场景并带 `error` 字段，写入只在解析阶段被拒绝。写入前修复 `seed`、`version`、`angle` 等缺失字段，丢弃无法渲染的无文件图片元素。

<a id="export-limits"></a>
## 导出

`excalidraw_export` 调用 Excalidraw 自带的导出实现（`@excalidraw/utils` 的 `exportToSvg` / `exportToBlob`），在本地无头 Chrome 中渲染，输出与 Excalidraw 网页导出一致：

- 还原 roughjs 手绘纹理、填充样式、圆角与箭头形态。
- 按元素宽度自动换行，字体以 woff2 内嵌到 SVG，PNG 使用同一套字体渲染。
- 场景 `files` 中的嵌入图片一并导出。
- SVG 与 PNG 共用 10 px 留白；PNG 可用 `scale` 放大（0.5–4）。

浏览器要求：

- 默认探测 Google Chrome、Chromium 与 Microsoft Edge 的常见安装位置；找不到时导出返回错误并提示安装。
- 用 `--chrome <path>` 或 `EXCALIDRAW_CHROME` 指定可执行文件（多个候选用操作系统路径分隔符连接）。
- `excalidraw_draw` 返回的 `previewSvg` 用于快速预览，仍是 node 内的平直渲染，不代表导出结果。

### 原生 `.excalidraw` 文件

`format: "excalidraw"` 写出原生场景文件（`{type, version, source, elements, appState, files?}`），可直接在 Excalidraw 应用或网页版打开，不需要浏览器。`appState` 只保留 `gridSize` 与 `viewBackgroundColor`，与网页版导出的文件一致；主题等界面状态不写入文件。

`excalidraw_import` 反向读取工作区内的 `.excalidraw` 文件或裸 `{elements, appState}` JSON，逐元素修复后整体替换当前场景；`files` 中的嵌入图片保留，后续 `excalidraw_draw` 不会丢弃它们。Excalidraw 素材库（`type: "excalidrawlib"`）是条目集合而非场景，导入会被拒绝。导入与导出路径同样限制在工作区内。

<a id="plugin"></a>
## 作为 cordis 插件

```yaml
- id: tool-excalidraw
  name: '@reachforstar/excalidraw-tools'
```

插件没有配置字段。它注入 `ctx.tools`，并通过 `ctx.workspaceRegistry` 解析目标工作区；无归属工作区的会话按会话 `cwd` 处理，两者都没有时调用被拒绝。cordis 相关 peer 依赖均为可选，仅使用 MCP 服务时无需安装。

<a id="security"></a>
## 安全

- 场景文件固定在工作区内（`--scene` 由运维显式指定，模型无法设置）；模型传入的导出路径必须保持工作区相对。
- 工具不使用 shell；导出通过 `playwright-core` 拉起本机浏览器进程，场景数据经临时 HTTP 端口传给该进程，模型输入无法到达命令行。
- HTTP 默认绑定回环地址；跨网络暴露时设置 `--token` 并在前面加 TLS 反向代理。
- 不写入密钥；`--token` 建议通过环境变量传入，避免进入 shell 历史。

<a id="dev"></a>
## 开发与测试

```sh
pnpm run typecheck   # 类型检查
pnpm test            # vitest：cordis 工具、MCP 内存传输、HTTP 传输、CLI 参数
pnpm run build
```

`tests/` 覆盖工具注册、场景读写、形状展开、路径越界、HTTP 鉴权与 CLI 解析。

<a id="known-limitations"></a>
## 已知限制

- **导出依赖浏览器**：SVG/PNG 导出需要本机 Chrome/Chromium，没有浏览器时导出不可用；绘制、读取与写入不受影响。
- **预览近似**：`excalidraw_draw` 返回的 `previewSvg` 为平直渲染，不还原手绘纹理与自动换行，仅用于快速确认形状。
- **无画布同步**：工具直接读写场景文件，运行中的浏览器画布需轮询或重新加载才能看到改动。
- **HTTP 无会话**：每个请求独立，服务端不保存客户端状态；需要会话级状态的能力不适用。
