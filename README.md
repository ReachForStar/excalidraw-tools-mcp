---
description: "Excalidraw 画布工具：以 MCP 服务（stdio / Streamable HTTP）或 cordis 插件形式提供场景读写、多图形管理、元素与布局操作、图片插入、截图与导出。"
---

# @reachforstar/excalidraw-tools

[![Test](https://github.com/ReachForStar/excalidraw-tools-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/ReachForStar/excalidraw-tools-mcp/actions/workflows/ci.yml)

简体中文

## 概述

面向模型的 Excalidraw 场景工具，提供两种接入形态：

- **MCP 服务**：`excalidraw-mcp` 命令，供 Claude Code、Codex、OpenCode 等任意 MCP 客户端使用，支持 stdio 与 Streamable HTTP 两种传输。
- **cordis 插件**：默认入口，注入宿主工具注册表，从调用方会话解析工作区。

两种形态共用同一套核心逻辑（`src/scene.ts`、`src/elements.ts`、`src/drawings.ts`），读写同一批场景文件，工具名与参数一致。除场景级工具外，还支持多图形管理、元素级增删改查、对齐/分布/分组/锁定/复制布局、外部图片插入与 PNG 截图。

## 目录

- [安装](#install)
- [作为 MCP 服务](#mcp)
- [自托管与公网访问](#deployment)
- [命令行选项](#cli)
- [工具](#tools)
- [场景文件](#scene-file)
- [多图形](#drawings)
- [元素与布局](#elements-layout)
- [图片与截图](#media)
- [导出](#export-limits)
- [作为 cordis 插件](#plugin)
- [安全](#security)
- [故障排查](#troubleshooting)
- [开发与测试](#dev)
- [已知限制](#known-limitations)
- [许可证](#license)

-----

<a id="install"></a>
## 安装

### 从源码运行

```sh
pnpm install
pnpm run build
node lib/mcp.js --version
```

构建产物在 `lib/`，命令行入口为 `lib/mcp.js`。

### 全局安装

从源码打包：

```sh
pnpm pack
npm install -g ./reachforstar-excalidraw-tools-0.1.0.tgz
excalidraw-mcp --version
```

也可以从 [GitHub Release](https://github.com/ReachForStar/excalidraw-tools-mcp/releases/tag/v0.1.0) 下载同一版本的 tarball，再执行 `npm install -g`。

npm 会把 `bin/excalidraw-mcp` 安装为指向 `lib/mcp.js` 的符号链接。当前入口会先解析真实路径再判断是否为主模块，因此直接执行 `excalidraw-mcp` 可以正常启动。

### 使用 npx

包发布到 npm 后可以直接运行：

```sh
npx -y @reachforstar/excalidraw-tools --workspace /abs/path/to/project
```

当前版本未发布到 npm，请使用源码或本地 tarball。

### 浏览器要求

导出 SVG、PNG 与截图由本机 Chrome/Chromium 渲染，`.excalidraw` 导出与导入不需要浏览器。安装后若报错提示找不到浏览器，请安装 Google Chrome，或用 `--chrome` / `EXCALIDRAW_CHROME` 指定可执行文件路径。

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

<a id="deployment"></a>
## 自托管与公网访问

生产环境建议只监听回环地址，由 Nginx、Caddy 等反向代理终止 TLS，并只转发 `/mcp`。生成随机 token 后启动：

```sh
export EXCALIDRAW_MCP_TOKEN="$(openssl rand -hex 32)"
excalidraw-mcp --http --host 127.0.0.1 --port 7801 \
  --workspace /srv/excalidraw/workspace \
  --token "$EXCALIDRAW_MCP_TOKEN"
```

Nginx 只暴露 MCP 端点：

```nginx
location = /mcp {
    proxy_pass http://127.0.0.1:7801;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_read_timeout 180s;
    proxy_send_timeout 180s;
    client_max_body_size 64m;
}
```

systemd 单元示例：

```ini
[Service]
User=excalidraw
Group=excalidraw
WorkingDirectory=/srv/excalidraw
EnvironmentFile=/etc/excalidraw-mcp.env
ExecStart=/usr/local/bin/excalidraw-mcp --http --host 127.0.0.1 --port 7801 --workspace /srv/excalidraw/workspace
Restart=on-failure
RestartSec=3
```

`ExecStart` 的路径按实际安装位置调整；用 `npm install --global --prefix` 安装时，命令通常位于 `<prefix>/bin/excalidraw-mcp`。

部署要点：

- 公网必须使用 HTTPS。明文 HTTP 会暴露 Bearer token。
- 只放行 `POST /mcp`；直接 `GET /mcp` 返回 405 是正常行为。
- 服务用户需要工作区读写权限，以及可执行的 Chrome/Chromium。
- 证书可使用任意 ACME 客户端。若服务器网络环境使 HTTP-01 不可达，改用 DNS-01。
- 大图导出可能持续数十秒；反向代理的读超时不要低于 180 秒。

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
| `excalidraw_read` | 返回场景摘要（按类型统计、文本元素、主题）、紧凑元素列表与可读的 `description`，文件较小时附带完整场景 JSON |
| `excalidraw_write` | 用完整场景 JSON 字符串覆盖场景，写入前修复缺字段元素 |
| `excalidraw_import` | 读取工作区内的 `.excalidraw` 文件（或任意含 `elements`/`appState` 的 JSON），修复后替换当前场景，保留嵌入图片 |
| `excalidraw_draw` | 用高层描述（`type`、位置、尺寸、可选 text/points/样式）添加或替换形状 |
| `excalidraw_export` | 用 Excalidraw 官方导出把场景渲染成工作区内的 SVG 或 PNG，或写出原生 `.excalidraw` 文件 |
| `excalidraw_create_drawing` | 新建图形（可带初始场景）；省略 id 时自动生成 |
| `excalidraw_get_drawing` | 读取指定图形的摘要、元素列表、描述与完整 JSON |
| `excalidraw_update_drawing` | 用完整场景 JSON 覆盖指定图形 |
| `excalidraw_delete_drawing` | 删除指定图形文件；默认图形删除后按空画布读取 |
| `excalidraw_list_drawings` | 列出工作区内全部图形及其元素数量、修改时间 |
| `excalidraw_export_to_json` | 把指定图形写成原生 `.excalidraw` 文件 |
| `excalidraw_element_create` | 直接创建元素（可带自定义 id），补齐渲染字段 |
| `excalidraw_element_get` | 按 id 读取单个元素及其索引 |
| `excalidraw_element_update` | 按 id 合并字段补丁并递增版本 |
| `excalidraw_element_delete` | 按 id 删除元素，并清理绑定文本与箭头绑定 |
| `excalidraw_layout` | 对齐、等距分布、分组/解组、锁定/解锁、复制选定元素 |
| `excalidraw_add_image` | 把工作区内的 PNG/JPEG/GIF/WebP/SVG 作为图片元素插入场景 |
| `excalidraw_screenshot` | 用无头 Chrome 把图形渲染为工作区内的 PNG 截图 |

全部工具都接受可选的 `workspace` 参数：工作区目录的绝对路径，或相对第一个根目录的路径。该目录必须位于已允许的根目录之内且已存在，否则调用以 `isError` 拒绝。画布类工具还接受可选的 `drawing` 参数，省略时操作默认图形 `default`。

`excalidraw_draw` 会补齐 Excalidraw 渲染所需的全部字段（seed、version、index、nonce），调用方无需手写内部元素字段。支持的 `type`：`rectangle`、`ellipse`、`diamond`、`text`、`arrow`、`line`。在 `rectangle`、`ellipse`、`diamond` 上设置 `text` 会生成居中的绑定文本元素，即带标签的方框。

返回值为单个文本块，内容为 JSON 文档：

```json
{"ok":true,"cwd":"/abs/path/to/project","drawing":"default","added":2,"totalElements":2,"skipped":0}
```

参数校验失败、路径越界、场景缺失等业务错误以 `isError: true` 返回，文本块内是错误原因，不会中断连接。

<a id="scene-file"></a>
## 场景文件

场景对象是 Excalidraw 持久化的结构：`{ elements, appState, files? }`。默认图形固定为 `<workspace>/.agents/excalidraw/scene.json`，同工作区的所有 agent 共用一个画布；改用 `drawing` 参数可操作其他图形。用 `--scene` 可以指向任意 `.excalidraw` 文件作为默认图形。默认图形的导出默认写到 `<workspace>/.agents/excalidraw/export.svg`，PNG 写到 `export.png`，原生文件写到 `export.excalidraw`；命名图形写到 `.agents/excalidraw/exports/<id>.<ext>`。

场景文件大小不设上限：`excalidraw_write` 与 `excalidraw_draw` 按文件实际大小读写，不因体积拒绝。工具执行以下边界：

| 边界 | 值 |
|---|---|
| `excalidraw_write` / `excalidraw_draw` 场景大小 | 无上限 |
| `excalidraw_read` 完整 JSON 回显上限 | 128 KB（超出时省略 `sceneJson`，摘要与元素列表照常返回） |
| `excalidraw_draw` 每次调用形状数 | 256 |
| 返回的预览 SVG 上限 | 64 KB |
| 导出/导入/图片/截图路径越界 | 拒绝（`..`、前导 `/`、反斜杠、解析后落在工作区外） |

场景文件缺失时读作空画布；场景损坏（非 JSON）时读作空场景并带 `error` 字段，写入只在解析阶段被拒绝。写入前修复 `seed`、`version`、`angle` 等缺失字段，丢弃无法渲染的无文件图片元素。

<a id="drawings"></a>
## 多图形

一个工作区可保存多个独立画布。默认图形 id 为 `default`，对应 `.agents/excalidraw/scene.json`；其他图形存 `.agents/excalidraw/drawings/<id>.json`。所有画布类工具都接受可选 `drawing` 参数，省略即操作 `default`。

- id 必须匹配 `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`，且不能是 Windows 设备名（如 `con`、`nul`）；含 `..`、路径分隔符或前导点会被拒绝。
- `excalidraw_create_drawing` 在图形已存在时报错；省略 id 时自动生成。可传 `scene` 作为初始场景。
- `excalidraw_update_drawing` 要求图形已存在，用完整场景 JSON 覆盖。
- `excalidraw_delete_drawing` 删除对应文件。`default` 也可以删除，之后按空画布读取，再次写入即重建。
- `excalidraw_list_drawings` 返回 id、元素数量、修改时间与路径，`default` 排在最前。
- `excalidraw_export_to_json` 与 `excalidraw_export` 的 `format: "excalidraw"` 输出一致；默认图形写 `.agents/excalidraw/export.excalidraw`，命名图形写 `.agents/excalidraw/exports/<id>.excalidraw`。

<a id="elements-layout"></a>
## 元素与布局

`excalidraw_read` 与 `excalidraw_get_drawing` 除结构化字段外还返回 `description`：逐元素列出类型、id、位置、尺寸、文本内容与容器标签关系，便于模型直接理解画布。元素超过 300 个或描述超过 64 KB 时截断并注明。

元素级工具直接操作原始 Excalidraw 元素：

- `excalidraw_element_create` 接受 `elements` 数组与可选 `action`（`append` 默认，或 `replace`）。可自带 `id`；与现有元素或同批元素重复时整体拒绝。缺失的 id、`x/y/width/height`、`index`、`updated` 会补齐，其余渲染字段在保存时修复。每次最多 256 个。
- `excalidraw_element_get` 按 id 返回完整元素对象与在列表中的索引。
- `excalidraw_element_update` 把 `patch` 浅合并进元素；`id` 与 `type` 不可改，版本、nonce 与更新时间会递增，合并后无法渲染时拒绝写入。
- `excalidraw_element_delete` 按 id 删除；删除容器会连带删除其绑定文本，并清理剩余元素的 `boundElements`、`startBinding`/`endBinding`、`containerId`。不存在的 id 会列在 `missing` 中。

`excalidraw_layout` 的 `action` 取值：

| 类别 | 取值 | 说明 |
|---|---|---|
| 对齐 | `align-left`、`align-center-h`、`align-right`、`align-top`、`align-middle`、`align-bottom` | 以选区边界为基准移动元素 |
| 分布 | `distribute-h`、`distribute-v` | 首尾元素不动，中间元素等间距 |
| 分组 | `group`、`ungroup` | `group` 返回新 `groupId`；`ungroup` 可指定 `groupIds`，省略时移除选区全部组 |
| 锁定 | `lock`、`unlock` | 设置元素的 `locked` |
| 复制 | `duplicate` | 按 `offsetX`/`offsetY`（默认 20）偏移复制 |

省略 `ids` 时选择全部可见元素。选区会自动扩展到完整分组及其绑定文本；复制时分组、绑定文本和箭头绑定都会重新映射到副本。

<a id="media"></a>
## 图片与截图

`excalidraw_add_image` 读取工作区内的图片文件，按文件头识别尺寸，创建原生 `image` 元素，并把二进制以 data URL 写入场景 `files`，因此画布自包含、导出时不会丢图。支持 `png`、`jpeg`、`gif`、`webp`、`svg`。只给 `width` 或只给 `height` 时按原始宽高比缩放；都不给时使用原始尺寸。图片元素必须通过该工具创建，`excalidraw_element_create` 不接受没有 `fileId` 的图片。

`excalidraw_screenshot` 与 SVG/PNG 导出共用本机无头 Chrome 的官方渲染，输出 PNG 文件并返回路径与像素尺寸。默认路径：默认图形 `.agents/excalidraw/screenshot.png`，命名图形 `.agents/excalidraw/screenshots/<id>.png`；可用 `path` 覆盖，`scale` 取 0.5–4，`transparent` 控制透明背景。MCP 返回结果还附带 `image/png` 内容块，客户端可直接显示图片；cordis 插件只返回路径与元数据。

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
- `excalidraw_draw`、元素创建/更新与布局工具返回的 `previewSvg` 用于快速预览，仍是 node 内的平直渲染，不代表导出结果。

### 原生 `.excalidraw` 文件

`format: "excalidraw"` 写出原生场景文件（`{type, version, source, elements, appState, files?}`），可直接在 Excalidraw 应用或网页版打开，不需要浏览器。`appState` 只保留 `gridSize` 与 `viewBackgroundColor`，与网页版导出的文件一致；主题等界面状态不写入文件。默认图形的默认路径为 `.agents/excalidraw/export.excalidraw`，命名图形为 `.agents/excalidraw/exports/<id>.excalidraw`。

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

<a id="troubleshooting"></a>
## 故障排查

| 现象 | 处理 |
| --- | --- |
| HTTP 返回 401 | 检查请求头是否为 `Authorization: Bearer <token>`，并确认 token 与 `EXCALIDRAW_MCP_TOKEN` 一致；修改环境变量后重启服务 |
| HTTP 返回 405 | `/mcp` 只接受 `POST`；`GET` 返回 405 属正常，响应头会带 `Allow: POST` |
| HTTP 返回 404 | 路径必须是 `/mcp`，不要加尾斜杠；检查反向代理是否使用 `location = /mcp` |
| HTTP 返回 413 | 请求体超过反向代理限制；调大 `client_max_body_size`，大场景建议 64 MB 或更高 |
| 导出超时或 504 | Chrome 首次启动较慢；把 `proxy_read_timeout` 调到 180 秒以上，并检查内存是否充足 |
| 提示找不到浏览器 | 安装 Google Chrome，或用 `--chrome` / `EXCALIDRAW_CHROME` 指定可执行文件 |
| 服务用户启动 Chrome 报沙箱错误 | 确认 `chrome-sandbox` 权限为 4755，或允许非特权用户命名空间；不建议长期关闭沙箱 |
| 执行 `excalidraw-mcp` 无输出且退出码 0 | 当前构建已修复符号链接入口；若仍出现，确认安装的是最新 tarball，并用 `readlink -f "$(command -v excalidraw-mcp)"` 检查是否指向 `lib/mcp.js` |
| 工作区路径被拒绝 | 工作区必须已存在，且位于启动时传入的 `--workspace` 根目录内 |

<a id="dev"></a>
## 开发与测试

```sh
pnpm run typecheck   # 类型检查
pnpm test            # vitest：cordis 工具、MCP 内存传输、HTTP 传输、CLI 与入口识别
pnpm run build
```

`tests/` 覆盖工具注册、场景读写、多图形增删改查、元素增删改查、布局、图片插入、形状展开、路径越界、截图、HTTP 鉴权、CLI 参数与符号链接入口识别，共 52 项。

CI 在 push 和 pull request 时执行 typecheck、test、build 与 `pnpm pack`；推送 `v*` tag 时，Release workflow 重新验证并将 tarball 附加到 GitHub Release。

<a id="known-limitations"></a>
## 已知限制

- **导出依赖浏览器**：SVG/PNG 导出需要本机 Chrome/Chromium，没有浏览器时导出不可用；绘制、读取与写入不受影响。
- **预览近似**：`excalidraw_draw` 返回的 `previewSvg` 为平直渲染，不还原手绘纹理与自动换行，仅用于快速确认形状。
- **无画布同步**：工具直接读写场景文件，运行中的浏览器画布需轮询或重新加载才能看到改动。
- **HTTP 无会话**：每个请求独立，服务端不保存客户端状态；需要会话级状态的能力不适用。

<a id="license"></a>
## 许可证

MIT
