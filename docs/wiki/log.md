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
