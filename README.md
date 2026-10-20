---
description: "Excalidraw 场景工具：以 MCP 服务（stdio / Streamable HTTP）或 cordis 插件形式提供读取、写入、绘制、导出。"
---

# @reachforstar/dsh-tool-excalidraw

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
- [导出限制](#export-limits)
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

构建产物在 `lib/`，命令行入口为 `lib/mcp.js`。发布后可直接用 `npx -y @reachforstar/dsh-tool-excalidraw`；未发布时使用仓库内的绝对路径。

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

一个进程只绑定一个场景目标。需要同时服务多个工作区时，按工作区各起一个进程（stdio 方式天然如此）。

<a id="cli"></a>
## 命令行选项

| 选项 | 环境变量 | 默认值 | 说明 |
|---|---|---|---|
| `-w, --workspace <dir>` | `EXCALIDRAW_WORKSPACE` | 当前目录 | 工作区根目录，导出路径的边界 |
| `--scene <path>` | `EXCALIDRAW_SCENE` | `.agents/excalidraw/scene.json` | 场景文件，绝对路径或工作区相对路径 |
| `--http` | — | 关闭 | 使用 Streamable HTTP 而非 stdio |
| `--transport <stdio\|http>` | — | `stdio` | 传输方式 |
| `--host <host>` | `EXCALIDRAW_MCP_HOST` | `127.0.0.1` | HTTP 监听地址 |
| `--port <port>` | `EXCALIDRAW_MCP_PORT` | `7801` | HTTP 端口，`0` 表示自动分配 |
| `--token <token>` | `EXCALIDRAW_MCP_TOKEN` | 无 | HTTP 要求 Bearer 令牌 |
| `-h, --help` | — | — | 帮助 |
| `-v, --version` | — | — | 版本 |

工作区不存在或参数非法时以退出码 2 结束，启动失败以 1 结束。

<a id="tools"></a>
## 工具

| 工具 | 用途 |
|---|---|
| `excalidraw_read` | 返回场景摘要（按类型统计、文本元素、主题）、紧凑元素列表，文件较小时附带完整场景 JSON |
| `excalidraw_write` | 用完整场景 JSON 字符串覆盖场景，写入前修复缺字段元素 |
| `excalidraw_draw` | 用高层描述（`type`、位置、尺寸、可选 text/points/样式）添加或替换形状 |
| `excalidraw_export` | 把场景渲染成工作区内的 SVG 文件 |

`excalidraw_draw` 会补齐 Excalidraw 渲染所需的全部字段（seed、version、index、nonce），调用方无需手写内部元素字段。支持的 `type`：`rectangle`、`ellipse`、`diamond`、`text`、`arrow`、`line`。在 `rectangle`、`ellipse`、`diamond` 上设置 `text` 会生成居中的绑定文本元素，即带标签的方框。

返回值为单个文本块，内容为 JSON 文档：

```json
{"ok":true,"cwd":"/abs/path/to/project","added":2,"totalElements":2,"skipped":0}
```

参数校验失败、路径越界、场景缺失等业务错误以 `isError: true` 返回，文本块内是错误原因，不会中断连接。

<a id="scene-file"></a>
## 场景文件

场景对象是 Excalidraw 持久化的结构：`{ elements, appState, files? }`。固定路径为 `<workspace>/.agents/excalidraw/scene.json`，同工作区的所有 agent 共用一个画布；用 `--scene` 可以指向任意 `.excalidraw` 文件。导出默认写到 `<workspace>/.agents/excalidraw/export.svg`。

场景文件大小不设上限：`excalidraw_write` 与 `excalidraw_draw` 按文件实际大小读写，不因体积拒绝。工具执行以下边界：

| 边界 | 值 |
|---|---|
| `excalidraw_write` / `excalidraw_draw` 场景大小 | 无上限 |
| `excalidraw_read` 完整 JSON 回显上限 | 128 KB（超出时省略 `sceneJson`，摘要与元素列表照常返回） |
| `excalidraw_draw` 每次调用形状数 | 256 |
| 返回的预览 SVG 上限 | 64 KB |
| 导出路径越界 | 拒绝（`..`、前导 `/`、反斜杠、解析后落在工作区外） |

场景文件缺失时读作空画布；场景损坏（非 JSON）时读作空场景并带 `error` 字段，写入只在解析阶段被拒绝。写入前修复 `seed`、`version`、`angle` 等缺失字段，丢弃无法渲染的无文件图片元素。

<a id="export-limits"></a>
## 导出限制

导出在 node 内完成，不需要浏览器，也不依赖 Excalidraw 的 canvas：

- 支持 `rectangle`、`ellipse`、`diamond`、`text`、`line`、`arrow`、`freedraw`。
- 使用平直描边与填充，不还原 roughjs 手绘纹理。
- 文本按单行输出，不做自动换行与字体回退；嵌入图片不导出。
- 需要与画布完全一致的渲染时，使用 Excalidraw 官方导出。

<a id="plugin"></a>
## 作为 cordis 插件

```yaml
- id: tool-excalidraw
  name: '@reachforstar/dsh-tool-excalidraw'
```

插件没有配置字段。它注入 `ctx.tools`，并通过 `ctx.workspaceRegistry` 解析目标工作区；无归属工作区的会话按会话 `cwd` 处理，两者都没有时调用被拒绝。cordis 相关 peer 依赖均为可选，仅使用 MCP 服务时无需安装。

<a id="security"></a>
## 安全

- 场景文件固定在工作区内（`--scene` 由运维显式指定，模型无法设置）；模型传入的导出路径必须保持工作区相对。
- 工具只使用 node 的 `fs/promises`，不涉及 shell，模型输入无法到达命令行。
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

- **单工作区**：一个 MCP 进程只服务一个场景目标，多工作区需多进程。
- **无画布同步**：工具直接读写场景文件，运行中的浏览器画布需轮询或重新加载才能看到改动。
- **HTTP 无会话**：每个请求独立，服务端不保存客户端状态；需要会话级状态的能力不适用。
- **导出近似**：SVG 为平直渲染，不还原手绘纹理、图片与自动换行。
