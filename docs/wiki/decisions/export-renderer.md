---
title: 导出渲染器选择：本机 Chrome 与 Excalidraw 官方导出
type: decision
tags: [excalidraw, 导出, svg, png, chrome, playwright]
created: 2026-10-20
updated: 2026-10-20
sources: [src/render.ts, src/scene.ts, README.md]
status: active
---

# 导出渲染器选择：本机 Chrome 与 Excalidraw 官方导出

## 背景（现状与约束）

0.4.0 之前 `excalidraw_export` 在 node 内用 `sceneToSvg` 自绘 SVG：只能输出平直描边与填充，不还原 roughjs 手绘纹理，文本按单行输出、不做自动换行，嵌入图片直接丢弃。用户需要 PNG，并要求与 Excalidraw 网页导出一致。

Excalidraw 的导出依赖真实 DOM、canvas 文本度量与字体加载：

- SVG 由 `exportToSvg` 构建 DOM 并内嵌 woff2 字体。
- PNG 由 `exportToBlob` 经 canvas 光栅化，需要 2D 上下文。
- 自动换行与文本尺寸依赖浏览器的字体度量，node 侧无法等价复现。

## 备选方案

| 方案 | 优点 | 缺点 |
| --- | --- | --- |
| A. 本机 Chrome（`playwright-core` + 已安装浏览器） | 与网页导出完全一致；不下载浏览器；PNG 原生支持 | 要求本机有 Chrome/Chromium；没有浏览器时导出不可用 |
| B. 纯 node（`jsdom` + `canvas` 原生模块） | 不依赖浏览器 | 依赖约 100 MB 且含原生模块；字体度量与图片加载与浏览器存在差异，需自行处理 `FontFace`、`ToBlob` |
| C. A 优先、B 回退 | 兼容性最好 | 两套渲染路径，输出不一致，维护成本翻倍 |

## 决策（选定方案）

采用方案 A：`@excalidraw/utils` 提供官方导出函数，`playwright-core` 在本地无头 Chrome 中执行。

- 浏览器懒启动，进程内复用；全部渲染串行，避免共享页面上的字体与 canvas 状态互相污染。
- 桥接页由 `src/render.ts` 内置的 HTML 字符串提供，通过回环地址上的临时 HTTP 服务加载 `@excalidraw/utils` 的 prod 包。
- 浏览器关闭挂在服务关闭路径上（stdio 随进程退出，HTTP 在 `close()` 时释放）。
- 找不到浏览器时导出直接失败并提示安装，不用近似渲染冒充官方输出。

## 理由（决策依据）

- 用户要求“使用自带的导出图片功能”，只有真实浏览器能完整复现纹理、图片与换行。
- 方案 B 的核心难点正是浏览器独占的文本度量与光栅化，模拟难免偏差，等于没解决问题。
- 方案 C 会让同一次导出的结果取决于机器环境，排查与回归都失去确定性。

## 后果（影响与后续）

- 新增依赖 `@excalidraw/utils`（prod 包约 19 MB，解包约 97 MB）与 `playwright-core`（不下载浏览器）。
- 导出第一次调用需启动浏览器（约 1–2 秒）；导出测试在没有浏览器的机器上自动跳过。
- `excalidraw_draw` 的 `previewSvg` 仍用 `sceneToSvg` 平直渲染，保持快速预览；文档已注明它不代表导出结果。
- 需要继续跟踪 `@excalidraw/utils` 的接口变化：0.1.5 的 `exportToSvg` / `exportToBlob` 已改为 `{ data, config }` 签名，后续版本可能再变。
