---
title: 全库代码审查（ocr scan，2026-11）
type: query
tags: [审查, ocr, 安全, 并发, 发布]
created: 2026-11-09
updated: 2026-11-09
status: active
---

# 全库代码审查（ocr scan，2026-11）

## 问题

用 open-code-review v1.13.6 对全库做整体审查（非 diff）。扫描 26 个源文件（`src/` 全部、CI/Release 工作流、`package.json`、`tsconfig.json`、`.gitignore`），测试与 Markdown 被 CLI 默认规则排除。会话 `11012276-a003-432d-ac80-8dbd8869143c`，共 94 条意见：0 critical、14 high、约 43 medium，其余 low。原始输出在 `tmp/ocr-scan.txt`（可丢弃）。

环境限制：本机 git 2.34.1 低于 ocr 要求的 2.41.0，`code_search` 工具全部失败（`git grep --max-count` 不支持），审查缺少跨文件检索上下文，结论以单文件为主。

## 高严重度发现（14 条，均已抽查代码确认属实）

### 数据完整性与并发

- `src/elements.ts` 全部导出函数是「读 → 就地改 → 整文件覆盖」，无锁无版本校验；stdio 与无状态 HTTP 并发调用互相覆盖。`src/drawings.ts` `createDrawing` 先查存在再无条件 `writeFile`，同样非原子。
- `src/elements.ts` `updateElement` 先 `saveWithPreview` 落盘、后校验可见性；patch 设 `isDeleted: true` 时前置 `sanitizeScene` 通过、写入完成后才抛错，调用方以为失败但磁盘已改。工具描述「rejected before writing」与实现不符。
- `src/render.ts` `dataOf` 丢弃 `payload.appState`，只保留导出开关；背景色经 `payload.background` 单独传递仍有效，但 theme 等其余 appState 字段失效。

### 渲染器生命周期

- `src/mcp.ts` `withRendererClosed` 先 `await close()` 再 `closeRenderer()`，无 try/finally；close 抛错则 Chrome 进程泄漏。
- `src/render.ts` `withTimeout` 只拒绝外层 Promise，`page.evaluate` 继续在同一 Page 执行，超时后的下一次渲染与之共享页面状态。
- `src/render.ts` `closeRenderer` 不与渲染队列同步，排队任务会在关闭后重新拉起浏览器。

### HTTP 传输

- `src/mcp/http.ts` `void handle(req, res)` 丢弃 Promise；`new URL` 与 `createMcpServer` 在 try 之外，同步抛错即 unhandledRejection（Node 默认杀进程），请求挂起。
- token 用 `!==` 字符串比较（时序侧信道）；token 未配置时不做任何限制，与「非回环必须配 token」的注释不符；无请求体上限、超时与并发限制。

### 输入与路径

- `src/mcp/tools/elements.ts` `patch` 复用 `rawElementSchema`，`{"width": "abc"}` 等非法值穿透到落盘层。
- `src/mcp/tools/media.ts` 截图 `path` 只校验工作区包含，可指向 `scene.json`、`package.json` 等任意文件并被 PNG 覆盖。
- `src/elements.ts` `addImage` MIME 仅按扩展名推断，读文件前无大小上限。

### 发布链路

- `package.json` `exports` 暴露 `./src/*`，但 `files` 只含 `lib/`，安装后该子路径必然解析失败。
- `.github/workflows/release.yml` 顶层 `contents: write` 且 checkout 默认 `persist-credentials: true`，写权限令牌留在 `.git/config`，后续 postinstall/测试可读。

## 中严重度主题（约 43 条）

- **输入校验缺口**：`points` 不限点数与形状、坐标无 `.finite()`、`scene` 字符串无上限、未知 `type` 静默跳过、`ids: []` 与「省略=全部」冲突、空串 workspace/drawing 静默落默认值、plugin 侧 `String(args['path'])` 与 `format` 仅类型断言。
- **错误契约**：`ok` 返回 JSON 而 `fail` 返回裸文本；`src/drawings.ts` 空 `catch {}` 吞掉 EACCES 等真实故障；disposer 循环无错误隔离。
- **场景数据**：删除元素后不 `touch()` 版本、孤立 `files` 不回收、`fileId` 不校验存在、`replace` 拒绝复用旧 id、`String.length` 与 128 KiB 字节上限比较、`EMPTY_SUMMARY` 可变单例。
- **HTTP 其余**：IPv6/通配地址拼 URL 非法、listen 后移除唯一 error 监听、`close()` 立即断在途请求、`transport/server.close()` Promise 被 void 丢弃。
- **CI 硬化**：ci.yml 无 `permissions`/`timeout-minutes`/`concurrency`；第三方 Action 用可变 tag；release 无按版本串行化；Chrome 固定 `stable` 漂移。
- **发布配置**：`noEmitOnError` 未开、无 `prepublishOnly`、无 `engines.node`。
- **路径边界**：`src/mcp.ts` 根目录只 `resolve()` 不解析软链接，`isWithin()` 词法比较可被软链接绕过。

## 与既有决策的关系

- 「场景大小无上限」是 0.3.1 的明确决策（见[实体页](../entities/excalidraw-mcp-server.md)），经用户确认继续保留；审查建议的 `.max(16 MiB)` 未采纳。HTTP 传输层的 64 MiB 请求体上限是传输防护，不改变场景写入本身的无上限决策。
- 「业务失败以 `isError: true` 返回错误文本」原契约经用户确认改为结构化 JSON `{ ok: false, error }`，原始错误同时写入 stderr；客户端需按 JSON 解析错误分支。
- 并发加锁、HTTP 限流属增加复杂度的防护，经用户确认后实施。

## 涉及模块

[Excalidraw MCP 服务](../entities/excalidraw-mcp-server.md)、[MCP 传输选择](../decisions/mcp-transports.md)、[导出渲染器选择](../decisions/export-renderer.md)、[元素级工具面](../decisions/canvas-tools-surface.md)、[CI 与 GitHub Release 流程](ci-release.md)。

## 复发预防

- 本机 git 2.34.1 低于 ocr 最低要求 2.41.0，升级后重跑可恢复 `code_search` 跨文件检索。
- 后续新增写场景的入口必须经过 `withSceneLock`，新增文件写入必须走原子写。

## 修复状态（2026-11-09）

全部 high 与 medium 已修复，72 项测试通过（新增 20 项回归测试，见 `tests/review-fixes.spec.ts` 与 `tests/mcp-http.spec.ts`、`tests/mcp-cli.spec.ts`）。

- 并发与数据完整性：`withSceneLock` 按场景文件串行读改写；整文件写入改为临时文件替换；创建图形用 `flag: "wx"` 排他写入；`updateElement` 在写入前拒绝 `isDeleted`；删除后刷新被清理元素的 `version` 并回收孤立 `files`；`replace` 允许复用旧 id；图片 `fileId` 必须已存在于 `files`。
- 渲染器：`withRendererClosed` 改为 try/finally；`closeRenderer` 增加关闭标记与队列屏障。审查项「超时后两次渲染共享页面」经核实已被 `renderScene` 的「出错丢弃渲染器」逻辑覆盖，未再改动。
- HTTP：请求 Promise 统一 catch 并返回 500；token 改常量时间比较；非回环 host 必须配 token；拒绝非回环 `Origin`；请求体上限 64 MiB、在途上限 32、请求/头部超时；IPv6/通配地址 URL 修正；保留常驻 error 监听。
- 路径：工作区根与工作区参数解析软链接；文件路径解析最深已存在祖先后再校验包含关系；截图路径限定 `.png` 且写入原子化。
- 输入：`patch` schema 校验数值字段并拒绝 `id`/`type`；`points` 限 2–1024 个 `[x,y]`；坐标/尺寸限有限值与范围；未知图形类型与布局 action 直接报错；空串 workspace/drawing 在 schema 层拒绝。
- 发布链路：`exports` 删除 `./src/*`；新增 `prepublishOnly` 与 `noEmitOnError`；CI 增加 `permissions: contents: read`、并发组与超时；第三方 Action 固定到 commit SHA（pnpm/action-setup v6、browser-actions/setup-chrome v2、softprops/action-gh-release v3）；Release 关闭凭据持久化、按版本串行并拒绝已存在的 tag/Release；Chrome 固定 157。
- 其余：`ok` 的 `undefined` 序列化为 `null`；`listDrawings` 复用已加载场景并并发读取；`readScene` 用 UTF-8 字节比较 128 KB；`EMPTY_SUMMARY`（low）与插件样板去重（low）未处理。