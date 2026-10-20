# 项目规则

> 本文件是项目级规则，与全局 `~/.config/opencode/AGENTS.md` 叠加执行。同一事项在全局规则中要求更严格时，按更严格的条款执行。

## 1. 分支模型

项目长期保留两条分支：

| 分支 | 定位 | 允许的变更来源 |
| --- | --- | --- |
| `master` | 主分支，唯一稳定基线，随时可构建与交付 | `develop` 的合并、仓库初始化提交 |
| `develop` | 集成分支，所有功能开发的落点 | 日常提交、`feature/*` 合并、`master` 的同步 |

- 远程主分支若使用 `main`，以远程实际名称为准，本节中的 `master` 同步替换；不得同时保留 `master` 与 `main`。
- 功能分支按需创建，命名为 `feature/<简短描述>`，从最新 `develop` 切出，完成后合回 `develop` 并删除。
- 不保留第三条集成分支，不按人员维护副本分支。

```mermaid
gitGraph
    commit id: "基线"
    branch develop
    checkout develop
    commit id: "功能提交"
    commit id: "验证通过"
    checkout master
    merge develop
```

## 2. 分支清理

删除分支前先审计，不得直接删除。

1. 同步远程状态并列出全部分支：

```bash
git fetch --prune
git branch -vv
git branch -r
```

2. 对每个非 `master` 分支记录三项事实：最后提交时间与作者、相对 `master` 的独有提交、与 `master` 的文件差异。

```bash
git log --oneline --date=short --format='%h %ad %an %s' master..<branch>
git diff --stat master...<branch>
```

3. 按审计结果分类处理：

| 情况 | 处理 |
| --- | --- |
| 提交已全部合入 `master`，无独有改动 | 直接删除 |
| 有独有改动且仍有价值 | 先合入 `master` 或 `develop`，验证通过后删除 |
| 有独有改动但已废弃 | 记录结论与理由，获得用户确认后删除 |
| 无法判断用途 | 暂不删除，在 `docs/wiki/queries/` 记录待确认项 |

4. 执行删除：

```bash
git switch master
git branch --merged master          # 先确认目标分支已在列表中
git branch -d <branch>              # -d 只删除已合并进当前分支的本地分支
git push origin --delete <branch>   # 删除远程分支，属危险操作，执行前必须获得用户明确确认
```

- `git branch -d` 判断的是「已合并进当前所在分支」，因此删除前先切到 `master`；否则已合入主分支的分支会被误判为未合并。
- 禁止用 `git branch -D` 强删含未合并提交的分支；此类分支先建标签或临时分支备份。
- 禁止批量删除；禁止删除 `master`；禁止删除当前所在分支。
- 清理结论与删除清单写入 `docs/wiki/log.md`。

## 3. 开发流程

1. **建立基线**：确认 `master` 已包含现有全部代码，且构建、测试通过。基线不完整时先补齐并提交，再创建 `develop`。
2. **创建 `develop`**：

```bash
git switch master
git pull --ff-only
git switch -c develop        # 已存在时执行 git switch develop
git push -u origin develop
```

3. **开工前同步**：`develop` 落后于 `master` 时先合并主分支，再开始新功能。

```bash
git switch develop
git merge --ff-only master   # 无法快进时执行 git merge master 并解决冲突
```

4. **开发**：功能改动只在 `develop` 或从 `develop` 切出的 `feature/*` 上进行，不直接向 `master` 提交功能代码。
5. **合并前验证**：在 `develop` 上完成构建、测试与实际复现，全部通过后才进入合并。
6. **合并到主分支**：保留合并记录，不压缩开发过程。

```bash
git switch master
git merge --no-ff develop -m "合并 develop 到主分支"
```

7. **合并后验证**：在 `master` 上重新执行构建与测试。失败时用 `git revert -m 1 <merge-commit>` 撤回本次合并，不把失败状态留在主分支。
8. **推送**：先推 `master`，再推 `develop`。推送失败时保留本地提交并报告，不反复重试，不强推。
9. **收尾**：删除已合并的 `feature/*` 分支，汇报变更范围、验证结果与残留风险。

## 4. 强制约束

- 禁止直接向 `master` 提交功能代码；紧急修复同样在 `develop` 完成，走相同合并路径。
- 禁止 `git push --force`、`git push --force-with-lease`、`git rebase`、`git reset --hard`。
- 合并冲突就地解决，并在提交信息中说明取舍；禁止用 `-X ours` 或 `-X theirs` 整体丢弃一方改动。
- 未完成第 3 节第 5 步验证的改动不得合并到 `master`。
- 分支名主体使用 kebab-case（如 `fix-export-path`），前缀只允许 `feature/` 与 `fix/`；不使用中文与空格。
- `master` 与 `develop` 的删除、远程分支删除、历史改写均属危险操作，执行前说明影响并取得用户确认。
