---
title: SVG 导出透明度单位与容器标签丢失
type: query
tags: [excalidraw, svg, bug, 渲染]
created: 2026-10-20
updated: 2026-10-20
sources: [src/scene.ts]
status: active
---

# SVG 导出透明度单位与容器标签丢失

## 问题

把场景导出为 SVG 后，所有形状几乎不可见；未带渲染纹理的形状显示为极淡轮廓。另外，`excalidraw_draw` 给矩形、椭圆、菱形设置 `text` 后，画布与导出里都没有文字。

## 根因

**透明度单位错误**：Excalidraw 的 `opacity` 是 0–100 的整数，SVG 的 `opacity` 是 0–1。原实现写成：

```ts
Math.max(0.05, Math.min(1, numOf(element['opacity']) || 100) / 100)
```

`Math.min` 先与 100 取小得到 1，再除以 100 得到 0.01，被下限抬到 0.05。100 与 0 都被压成 0.05，所有形状接近透明。

**容器文字不会渲染**：Excalidraw 只渲染独立的 `text` 元素。容器的 `text` 字段必须通过绑定关系呈现：容器 `boundElements: [{ type: 'text', id }]`，文本元素 `containerId` 指向容器，位置在容器中心。

## 解法

- 透明度改为先用 100 归一化再取上下限：`Math.max(0.05, Math.min(1, (numOf(opacity) || 100) / 100))`。
- 新增 `elementsFromShape()`：容器形状带 `text` 时返回两个元素（容器 + 居中文本），容器写入 `boundElements`，文本写入 `containerId`、`textAlign: 'center'`、`verticalAlign: 'middle'`。`drawScene` 改为调用它，`added` 统计实际元素数。
- 文本宽高按 `fontSize * 0.6 * 字符数` 与行高 1.25 估算；node 侧没有字体度量，只用于居中定位。

## 涉及模块

- `src/scene.ts`：`sceneToSvg`、`elementFromShape`、`elementsFromShape`、`drawScene`。
- 测试：`tests/mcp-server.spec.ts` 增加容器标签与 `opacity="1"` 断言。

## 复发预防

- 导出相关断言不只看元素是否存在，要检查可见属性（透明度、填充、文字内容）。
- 跨模型边界转换单位时（0–100 ↔ 0–1、像素 ↔ 比例），在赋值处写明单位来源。
- 任何"容器 + 内容"的图形，先确认宿主的真实数据契约（绑定关系），不要假设给容器加字段就能显示。
