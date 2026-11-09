# Wiki 操作日志

> 只追加、不修改历史。可用 `grep "^## \[" docs/wiki/log.md | tail -5` 看最近记录。
> 前缀格式：`## [YYYY-MM-DD] <init|feat|fix|query|lint|chore> | <简述>`

## [2026-10-20] init | wiki-memory hook 自动创建知识库骨架

## [2026-10-20] chore | 新增项目级 AGENTS.md 分支规则（master + develop）
- 创建 AGENTS.md：分支模型、分支清理审计、开发与合并流程、强制约束四节。
- 新增 docs/wiki/decisions/branch-model.md 并登记到 index。
- 现状：仓库无任何提交，远程无分支，暂无可删除分支。

## [2026-10-20] feat | 新增 MCP 服务（stdio + Streamable HTTP）并抽出场景核心
- 建立基线提交 `343c7e5`，创建 `develop` 分支并推送 `master`、`develop`。
- 新增 `src/scene.ts`（无宿主依赖的场景核心）、`src/mcp.ts`（CLI）、`src/mcp/{tools,server,http}.ts`。
- 引入依赖 `@modelcontextprotocol/sdk` 1.32.1、`zod` 4.6.7；版本提升到 0.3.0，新增 `bin` 与 `./mcp` 导出。
- 修复 SVG 导出透明度单位错误；容器形状带 `text` 生成绑定文本元素。
- 新增测试：MCP 内存传输、HTTP 与鉴权、CLI 参数，共 27 项通过。
- 新增 wiki：entities/excalidraw-mcp-server.md、decisions/mcp-transports.md、queries/svg-export-opacity-and-labels.md。

## [2026-10-20] feat | 场景路径固定为 .agents 并取消写入大小上限
- `SCENE_RELATIVE` 改为 `.agents/excalidraw/scene.json`，导出默认 `.agents/excalidraw/export.svg`；同工作区所有 agent 共用一个画布。
- 移除 `WRITE_SCENE_MAX_BYTES` 与写入体积校验；`excalidraw_read` 的 128 KB 回显上限保留。
- 新增测试：默认路径解析、导出默认路径、1.3 MB 场景写入与超大回显省略。
- 版本提升到 0.3.1；README 与实体页同步。

## [2026-10-20] chore | 包名改为 @reachforstar/dsh-tool-excalidraw
- 包名与 cordis 插件名去掉 `-copy` 后缀：`@reachforstar/dsh-tool-excalidraw`、`tool-excalidraw`。
- README 与模块注释同步；构建产物与 `excalidraw-mcp` bin 不变。

## [2026-10-20] chore | 包名改为 @reachforstar/excalidraw-tools
- 包名由 `@reachforstar/dsh-tool-excalidraw` 改为 `@reachforstar/excalidraw-tools`，与仓库目录名一致。
- cordis 插件名保持 `tool-excalidraw`，MCP 服务名 `excalidraw-mcp` 与 bin 名不变。

## [2026-10-20] feat | 单进程支持多工作区
- `WorkspaceScope`（根目录集合）替代单一场景目标；`targetFor(scope, workspace)` 解析并校验每次调用的工作区。
- 四个 MCP 工具新增可选 `workspace` 参数；`--workspace` 可重复，环境变量按操作系统路径分隔符拆分。
- `--scene` 仅允许单工作区；工作区必须位于允许根目录内且已存在。
- 新增多工作区与越界拒绝测试，共 32 项通过；版本 0.4.0。

## [2026-10-20] feat | 导出改用 Excalidraw 官方渲染并支持 PNG
- 新增 `src/render.ts`：探测本机 Chrome，无头启动，桥接页调用 `@excalidraw/utils` 的 `exportToSvg` / `exportToBlob`。
- `excalidraw_export` 新增 `format`（svg/png）、`scale`（0.5–4），结果返回 `width` / `height`；默认 PNG 路径 `.agents/excalidraw/export.png`。
- 命令行新增 `--chrome` / `EXCALIDRAW_CHROME`；找不到浏览器时导出报错，不回退近似渲染。
- 渲染串行化并在服务关闭时释放浏览器；导出测试在无浏览器环境自动跳过，共 35 项通过。
- 版本 0.5.0；新增决策页 `decisions/export-renderer.md`。

## [2026-10-20] feat | 新增 .excalidraw 导入与导出
- `excalidraw_export` 新增 `format: "excalidraw"`，直接写原生场景文件 `.agents/excalidraw/export.excalidraw`，不需要浏览器；`appState` 仅保留 `gridSize` 与 `viewBackgroundColor`。
- 新增 `excalidraw_import`：读取工作区内的 `.excalidraw` 或裸 `{elements, appState}` JSON，修复元素后整体替换场景，保留 `files` 中的嵌入图片；素材库被拒绝。
- `excalidraw_draw` 读写时保留场景已有的 `files`，追加形状不再丢失嵌入图片。
- 导出/导入共用 `resolveWorkspacePath` 做越界校验；MCP 与 cordis 插件同步新增第五个工具。
- 测试增至 39 项（含原生文件往返、图片保留、错误分支）；版本 0.6.0。

## [2026-10-20] feat | 新增多图形、元素、布局、图片与截图工具
- 新增 `src/elements.ts`（元素增删改查、对齐/分布/分组/锁定/复制、图片插入）与 `src/drawings.ts`（图形管理）。
- `src/scene.ts` 增加图形目标解析、`loadSceneParts`/`saveSceneParts`、画布描述、截图与按图形区分的默认导出路径。
- 工具从 5 个扩展到 18 个：场景 5、图形管理 6、元素 4、布局 1、媒体 2；MCP 与 cordis 插件按功能拆分模块。
- `excalidraw_screenshot` 在 MCP 返回文本元数据加 `image/png` 内容块；`excalidraw_add_image` 用 `image-size` 读尺寸并写入场景 `files`。
- `excalidraw_read` / `get_drawing` 新增 `description`；删除元素时清理绑定文本与箭头绑定。
- 新增测试覆盖图形 CRUD、元素 CRUD、布局、图片、描述与截图，共 49 项通过；版本号按发布指令保持不变。
- 新增决策页 `decisions/multi-drawing-storage.md`、`decisions/canvas-tools-surface.md`；更新实体页与 README。

## [2026-10-20] chore | 部署 MCP 到 mcp.togithub.icu
- 远程单租户部署：`excalidraw-mcp.service` 监听 `127.0.0.1:7801`，独立 `excalidraw-proxy.service` 监听 80/443；系统 Nginx 保持 disable。
- 包安装在 `/opt/excalidraw-tools`，工作区 `/srv/excalidraw/workspace`，运行用户 `excalidraw`，Chrome 155 用于 PNG/截图。
- 证书改用 DNS-01（境外访问被禁用，HTTP-01 超时），当前有效期至 2027-01-18；续期需人工添加 TXT 或后续接入阿里云 DNS API。
- 验证通过：GET 405、无 token 401、18 个工具、draw/read/export/screenshot 均成功。
- 记录遗留问题：bin 符号链接入口静默退出、证书续期需人工、工作区保留验证文件。
- 新增 `queries/deploy-mcp-togithub.md`，更新 index 与实体页链接。

## [2026-10-20] fix | 修复 bin 符号链接入口静默退出
- 入口判断改为 `realpathSync(entry) === fileURLToPath(import.meta.url)`，兼容 npm 全局安装的 bin 符号链接。
- 新增 `tests/mcp-entry.spec.ts`，覆盖符号链接、真实路径、缺失路径与无关路径；测试 52 项通过。
- 重新打包部署到 `/opt/excalidraw-tools`；systemd 改用 `bin/excalidraw-mcp`，远程 `--version` 与工具调用验证通过。
- 更新部署页与实体页，移除 bin 遗留问题。

## [2026-10-20] chore | 新增 CI 与 Release 工作流
- 新增 `.github/workflows/ci.yml`：push/PR 执行 typecheck、52 项测试、构建与 `pnpm pack`，上传 tarball artifact。
- 新增 `.github/workflows/release.yml`：推送 `v*` tag 后重新验证，读取 `docs/releases/<tag>.md` 发布说明并上传 tarball 到 GitHub Release。
- `develop` CI run `39434107935` 通过；README 增加 CI 徽章与 Release 下载说明。
- 新增 `queries/ci-release.md`，更新 index。

## [2026-10-20] chore | 发布 v0.1.0
- CI 工作流显示名称改为 `Test`，push/PR 自动触发；Release 改为 `workflow_dispatch` 手动指定版本触发，不再监听 tag push。
- `master` Test run `39435310828` 通过；Release run `39435517529` 创建 `v0.1.0`，发布说明与 tarball 已上传。
- 发布说明文件约定为 `docs/releases/<version>.md`，当前为 `docs/releases/v0.1.0.md`。
- 清理项目 `tmp/`、根目录临时 tarball 与远程部署临时文件。

## [2026-10-20] chore | 注册 Excalidraw MCP 到四个客户端
- Pi、Codex、Claude Code、OpenCode 写入远程 Streamable HTTP 配置，统一指向 `https://mcp.togithub.icu/mcp`。
- Pi 返回 18 个工具；Claude Code 显示已连接；Codex 配置为 `enabled` 与 `streamable_http`；OpenCode 用干净环境临时服务验证为已连接。
- 本机代理会拦截该国内端点，新增 `NO_PROXY` 到 `.bashrc`、`environment.d` 与 Claude `settings.json`；常驻客户端需重启以读取新环境。
- 卸载此前为验证 Release 安装的全局包，移除 `excalidraw-mcp` 命令。
- 新增 `queries/mcp-clients-install.md`，更新部署页与 index。
- `develop` Test run `39438655744` 与 `master` run `39438685151` 均通过。

## [2026-10-20] query | 绘制 Hello World 并导出 PNG
- 用远程 MCP 的 `excalidraw_draw` 与 `excalidraw_export` 试过：导出成功但文件落在服务器 `/srv/excalidraw/workspace/hello-world.png`，本地不可取；远程默认画布被 `replace` 清空后已恢复为原有两个元素。
- 改用本仓库构建产物本地生成：`tmp/gen-hello.mjs` 调 `sceneTarget('tmp/ws')` → `drawScene` → `exportScene`，`format: 'png'`、`scale: 2`，产物 1400×360、33247 字节，拷到 `out/hello-world.png`。
- 验证：`image-size` 确认 PNG 尺寸；ImageMagick 唯一色列表包含文字色 `#1e1e1e`、边框色 `#1971c2` 与浅蓝填充，手绘纹理正常。
- 部署页新增「导出文件的落地位置」一节：远程写入路径与本地两条取图路径，及共享画布慎用 `replace` 的注意事项。

## [2026-11-09] query | 全库代码审查（ocr scan）
- 工作区干净，经用户确认改用 `ocr scan` 全库扫描：26 个源文件、94 条意见（0 critical、14 high、约 43 medium），会话 `11012276-a003-432d-ac80-8dbd8869143c`，原始输出 `tmp/ocr-scan.txt`。
- 14 条 high 均抽查代码确认：读改写无锁、updateElement 先写后校验、渲染器关闭/超时竞态、HTTP unhandledRejection 与鉴权缺口、截图路径可覆盖任意工作区文件、patch 校验穿透、`exports ./src/*` 发布断链、release 令牌持久化。
- 本机 git 2.34.1 低于 ocr 最低要求 2.41.0，`code_search` 全部失败，审查缺少跨文件检索上下文。
- 新增 `queries/ocr-full-scan-2026-11.md`，更新 index；修复范围待用户确认。

## [2026-11-09] fix | 修复全库审查的 high 与 medium 问题
- 核心数据完整性：场景读改写按文件进程内加锁，整文件写入改为临时文件替换，创建图形用 `flag: "wx"` 排他写；`updateElement` 写入前拒绝 `isDeleted`；删除后刷新被清理元素的 `version` 并回收孤立 `files`；`replace` 可复用旧 id；图片 `fileId` 必须存在于场景。
- 安全与传输：非回环 HTTP host 强制 token，token 常量时间比较，拒绝非回环 `Origin`；请求体上限 64 MiB、在途上限 32、请求/头部超时；截图路径限定 `.png`，图片上限 10 MiB 并交叉校验 MIME；文件与工作区路径解析软链接后校验包含关系。
- 渲染与结果：`withRendererClosed` 改 try/finally，`closeRenderer` 增加关闭标记与队列屏障；失败结果改为 `{ ok: false, error }` JSON 并写 stderr；`ok(undefined)` 返回 `null`。
- 发布配置：删除 `exports ./src/*`；新增 `prepublishOnly`、`noEmitOnError`；CI 加最小权限、并发组与超时；三方 Action 固定到 commit SHA；Release 关闭凭据持久化、按版本串行并拒绝已存在 tag/Release；Chrome 固定 157。
- 用户决策：场景写入大小保持无上限（0.3.1 决策不推翻）；失败结果格式改为结构化 JSON。
- 验证：`pnpm typecheck`、`pnpm build` 通过，72 项测试通过（含 20 项新增回归测试）。
- 未处理（low）：`EMPTY_SUMMARY` 可变单例、插件样板去重、工具名缩写说明等。

## [2026-11-09] docs | 完善 README 与 MCP 服务文档
- README 新增「快速开始」（本地 HTTP + curl initialize / tools/call 示例，已实测），补充 Node.js 版本说明。
- 「作为 MCP 服务」扩写：stdio 与 HTTP 传输对比、客户端配置、协议行为（无状态、必需请求头、状态码表）、鉴权与限流、多工作区规则。
- 同步新行为：非回环必须 token、64 MiB 请求体上限、64/72 项测试、截图 `.png` 限制、图片 10 MiB 与 MIME 校验、软链接越界、失败结果结构化 JSON、代理超时 300 秒。
- 更新 `queries/ci-release.md`（SHA 固定、权限、并发、Release 拒绝覆盖）与 `queries/deploy-mcp-togithub.md`（代理超时）；实体页测试数改为 72。
