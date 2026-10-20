---
title: 元素级工具面与布局语义
type: decision
tags: [excalidraw, 元素, 布局, 截图, 决策]
created: 2026-10-20
updated: 2026-10-20
sources: [README.md]
status: active
---

# 元素级工具面与布局语义

## 背景（现状与约束）

此前的工具面只有场景级操作：整份 JSON 覆盖、导入、按高层描述绘制、导出。模型要修改单个元素、移动一组元素或插入图片时，只能重写整份场景。需求要求元素级增删改查、对齐/分布/分组/锁定/复制、外部图片、画布文字描述与截图；同时不能削弱既有场景工具，也不能让 MCP 与 cordis 插件行为分叉。

## 备选方案（各方案优劣）

| 方案 | 优点 | 缺点 |
| --- | --- | --- |
| 扩展 `excalidraw_draw` 的 `action` 字段承载全部操作 | 工具数量少 | 参数空间混杂；描述与校验难；模型容易选错动作 |
| 按功能拆成独立工具，共用核心模块 | 参数与描述聚焦；MCP/插件可复用；易于测试 | 工具数量增加，客户端需处理更长列表 |
| 只做批量 JSON 补丁 | 实现简单 | 仍需模型理解完整元素结构；删除绑定关系、分组重映射等语义无法保证 |

## 决策（选定方案）

- 按功能拆分工具，全部使用 `excalidraw_` 前缀：场景 5 个、图形管理 6 个、元素 4 个、布局 1 个、媒体 2 个，共 18 个。
- 元素创建接受原始 Excalidraw 元素，可自带 id；只补齐身份与必需字段，其余交给 `sanitizeScene`。重复 id 整体拒绝。
- 元素更新为浅合并补丁，`id` 与 `type` 不可变；合并后不可渲染则拒绝写入。
- 删除容器元素时连带删除绑定文本，并清理剩余元素的 `boundElements`、`startBinding`/`endBinding`、`containerId`。
- 布局选区省略 `ids` 时取全部可见元素；选区自动扩展到完整分组与绑定文本。`duplicate` 重新映射分组、绑定文本和箭头绑定。
- 图片只通过 `excalidraw_add_image` 创建：按文件头读尺寸，二进制写入场景 `files`；`excalidraw_element_create` 拒绝没有 `fileId` 的图片。
- 截图复用导出渲染器；MCP 返回文本元数据加 `image/png` 内容块，cordis 插件只返回路径与元数据。
- 画布描述由核心生成，`excalidraw_read` 与 `excalidraw_get_drawing` 都返回 `description`；超过 300 个元素或 64 KB 时截断。

## 理由（决策依据）

独立工具让每个参数和错误信息只服务一个动作，模型不需要在巨型 action 枚举里判断上下文。原始元素入口保留 Excalidraw 的全部字段，避免高层描述丢失样式；严格的 id/图片校验把不可渲染状态挡在写入前。绑定关系清理与复制重映射放在核心，保证 MCP 与插件结果一致。

## 后果（影响与后续）

- 新增 `src/elements.ts`、`src/drawings.ts`；`src/mcp/tools/` 与 `src/plugin/` 按功能拆成多个模块，`src/index.ts` 只做汇总注册。
- 工具结果统一包含 `cwd`、`drawing`；写入类结果附带 `previewSvg`（未超限时）。
- 预览 SVG 仍是平直渲染，不代表最终导出效果；截图与 SVG/PNG 导出需要本机 Chrome。
- 元素级工具直接暴露 Excalidraw 内部字段，模型写错字段时可能产生不渲染的元素；`sanitizeScene` 与更新后的可渲染校验只覆盖已识别的问题。
- 相关：[多图形存储](multi-drawing-storage.md)、[Excalidraw MCP 服务](../entities/excalidraw-mcp-server.md)、[导出渲染器选择](export-renderer.md)。
