---
title: 多图形存储与命名规则
type: decision
tags: [excalidraw, 多图形, 存储, 决策]
created: 2026-10-20
updated: 2026-10-20
sources: [README.md]
status: active
---

# 多图形存储与命名规则

## 背景（现状与约束）

此前一个工作区只有一个固定场景 `.agents/excalidraw/scene.json`，同工作区的所有 agent 共用一个画布。需求要求在同一工作区内管理多个独立图形，且不能破坏已有场景路径与默认导出路径。图形 id 来自模型输入，必须避免路径穿越、文件名冲突和跨平台非法名称（Windows 设备名、大小写不敏感文件系统）。

## 备选方案（各方案优劣）

| 方案 | 优点 | 缺点 |
| --- | --- | --- |
| 全部图形放进一个 JSON，内部按 id 分节 | 单文件、原子写入 | 破坏已有 `scene.json` 结构；单图形写入要整体重写，文件膨胀；与 Excalidraw 原生文件格式不一致 |
| 每个图形一个文件，默认图形另起路径 | 兼容旧场景；单图形读写独立；可直接用 `.excalidraw` 工具打开 | 需要额外的目录扫描与 id 校验 |
| 只支持命名图形，不做默认图形 | 模型统一 | 破坏现有工具与文档；所有调用都要显式 id |

## 决策（选定方案）

- 默认图形 id 固定为 `default`，路径保持 `.agents/excalidraw/scene.json`；其他图形存 `.agents/excalidraw/drawings/<id>.json`。
- 全部画布类工具新增可选 `drawing` 参数，省略即 `default`；`excalidraw_create_drawing` 省略 id 时自动生成。
- id 必须匹配 `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`，并拒绝 Windows 设备名；含路径分隔符、`..`、前导点或空格的 id 直接报错。
- `default` 允许删除；删除后读为空画布，再次写入即重建。命名图形删除后 `get` 返回 `exists: false`，再次删除报 `drawing not found`。
- 默认导出保持 `export.svg` / `export.png` / `export.excalidraw`；命名图形写 `.agents/excalidraw/exports/<id>.<ext>`。截图默认图形写 `.agents/excalidraw/screenshot.png`，命名图形写 `.agents/excalidraw/screenshots/<id>.png`。
- `--scene` 仅覆盖默认图形；命名图形始终落在工作区的 `drawings/` 下。

## 理由（决策依据）

默认图形沿用旧路径与旧导出名，升级不迁移、不破坏已有调用与脚本。命名图形单独成文件，使单图形写入不必重写其他画布，也让文件可直接作为 `.excalidraw` 打开。严格 id 规则把路径校验放在入口，避免模型输入影响文件系统布局。

## 后果（影响与后续）

- 新增 `src/drawings.ts` 与六个图形管理工具；`scene.ts` 增加 `sceneTarget`、`loadSceneParts`、`saveSceneParts`。
- `listDrawings` 以 `default` 优先排序，其余按 id 排序。
- 大小写不敏感文件系统上，`A` 与 `a` 会指向同一文件；当前不做跨平台 id 归一化，调用方应使用稳定的小写 id。
- 相关：[Excalidraw MCP 服务](../entities/excalidraw-mcp-server.md)、[元素级工具面](canvas-tools-surface.md)。
