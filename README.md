---
description: "使用面向模型的 Excalidraw 工具读取、写入、绘制并导出工作区白板场景。"
---

# @reachforstar/dsh-tool-excalidraw-copy

[English](README.md) | 中文

## 概述

`@reachforstar/dsh-tool-excalidraw` 的独立副本，供 DeepSeek Harness 单仓之外的项目使用。工具把场景和导出路径限制在所属工作区内，并返回有界摘要，避免无界场景数据进入结果。

## 目录

- [使用本包](#use-this-package)
- [场景工具](#scene-tools)
- [场景文件](#scene-file)
- [安全](#security)
- [模型体验](#model-experience)
- [已知限制](#known-limitations)

-----

<a id="use-this-package"></a>
## 使用本包

```sh
pnpm install
pnpm run build
```

把插件挂载到会话归属已知工作区的 agent preset：

```yaml
- id: tool-excalidraw-copy
  name: '@reachforstar/dsh-tool-excalidraw-copy'
```

插件没有配置字段。它注入 `ctx.tools`，并通过 `ctx.workspaceRegistry` 解析目标工作区。

## 场景工具

本包围绕同一个工作区场景文件注册四个模型面向的工具：

| 工具 | 用途 |
|---|---|
| `excalidraw_read` | 返回场景摘要（按类型统计的元素数、文本元素、主题）；文件较小时附带完整场景 JSON |
| `excalidraw_write` | 用完整场景 JSON 字符串覆盖场景 |
| `excalidraw_draw` | 用高层描述（`type`、位置、尺寸、可选 text/points/样式）添加或替换形状 |
| `excalidraw_export` | 把场景渲染成工作区内的 SVG 文件 |

`excalidraw_draw` 会补齐 Excalidraw 渲染所需的全部字段（seed、version、index、nonce），调用方无需手写内部元素字段；它只接受文档化的形状词汇，拒绝未知元素类型。

## 场景文件

四个工具读写同一个文件：`<workspace>/.<agents_dir>/excalidraw/scene.json`（`SCENE_RELATIVE`），即含 `elements` 数组与 `appState` 对象的 Excalidraw 场景对象。若同一部署还运行 `@reachforstar/dsh-client-ui-polish` 的 Web 画布标签页，该标签页通过 `/scene` 路由渲染同一文件，因此模型绘制会出现在白板上，画布编辑也是下次工具调用读到的内容。

场景是普通 JSON，工具执行以下边界：

| 边界 | 值 |
|---|---|
| `excalidraw_read` 完整 JSON 回显上限 | 128 KB |
| `excalidraw_write` 场景大小上限 | 1 MB |
| `excalidraw_draw` 每次调用元素数 | 256 |
| 导出路径越界 | 拒绝（`..`、前导 `/`、反斜杠） |

场景文件缺失时读作空画布；场景损坏（非 JSON）时读作空场景并带 `error` 字段，写入只在解析阶段被拒绝。

## 安全

场景与导出路径都解析在调用方的工作区内：`excalidraw_export` 的 `path` 参数必须保持工作区相对，场景文件本身固定为工作区相对的 `SCENE_RELATIVE`。工具使用 node 的 `fs/promises`，不涉及 shell，因此调用方提供的路径无法逃出工作区，也无法到达 shell。

-----

<a id="model-experience"></a>
## 模型体验

`excalidraw_read` 返回有界摘要，仅在 128 KB 上限内回显完整场景 JSON；`excalidraw_write` 回显元素数量而非内容；拒绝时返回错误串。工具不注册提示段，因此不影响系统提示，schema 在部署内固定。

## 已知限制

- **工作区要求**——没有归属工作区的 agent 会话时，调用被拒绝。
