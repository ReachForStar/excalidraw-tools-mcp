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
