# 贡献指南

## 环境

- Node.js 22（与 CI 一致）
- pnpm 12
- 导出 SVG/PNG 与截图相关改动需要本机 Chrome/Chromium

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## 分支与提交

- `master` 是稳定基线，只接受来自 `develop` 的合并。
- 功能与修复从最新 `develop` 切出 `feature/<kebab-case>`，完成后合回 `develop`。
- 提交信息使用 conventional commits：`type(scope): 摘要`，`type` 取 `feat`、`fix`、`docs`、`chore`、`refactor`、`test`；摘要用中文祈使句。
- 只暂存具体文件，不提交 `lib/`、`tmp/`、`node_modules/` 与本地环境文件。

## 改动要求

- 行为改动先补测试：在 `tests/` 下新增或修改用例，`pnpm test` 全部通过后再提合并。
- 涉及工具参数、返回结构或错误契约的改动，同步更新 README 与 `docs/wiki/`。
- 不引入未使用的依赖；新增依赖时说明用途与维护成本。
- 安全相关问题按 [SECURITY.md](SECURITY.md) 私下报告，不要直接开公开 Issue。

## 提交流程

1. 在 `develop` 或功能分支完成改动并通过 `pnpm typecheck`、`pnpm test`、`pnpm build`。
2. 向 `develop` 发起 PR，描述改动范围、验证方式与兼容性影响。
3. 维护者合并后同步到 `master`。

## 文档

- 用户文档：`README.md`
- 发布说明：`docs/releases/<version>.md`
- 设计与排查记录：`docs/wiki/`（结构见 `docs/wiki/index.md`）
