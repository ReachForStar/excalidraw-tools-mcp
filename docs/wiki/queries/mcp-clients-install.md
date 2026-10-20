---
title: 在四个客户端注册 Excalidraw MCP
type: query
tags: [mcp, 客户端, pi, codex, claude-code, opencode, 代理]
created: 2026-10-20
updated: 2026-10-20
sources: []
status: active
---

# 在四个客户端注册 Excalidraw MCP

## 问题

把公网 MCP 服务 `https://mcp.togithub.icu/mcp` 注册到本机的 Pi、Codex、Claude Code 与 OpenCode，并用客户端命令确认配置可加载、服务可连接。

## 结论

四个客户端都保存同一组远程配置：Streamable HTTP，URL 为 `https://mcp.togithub.icu/mcp`，请求头带 `Authorization: Bearer <token>`。Token 不在本页记录，实际值只存在各客户端配置文件中。

| 客户端 | 配置文件 | 配置形态 | 验证结果 |
| --- | --- | --- | --- |
| Pi | `~/.pi/agent/mcp.json` | `mcpServers.excalidraw`，`type=http`、`url`、`headers.Authorization`、`enabled=true` | `pi mcp list --json` 返回 `connected`，18 个工具 |
| Codex | `~/.codex/config.toml` | `[mcp_servers.excalidraw]` 的 `url`，以及 `[mcp_servers.excalidraw.http_headers]` 的 `Authorization` | `codex mcp get excalidraw` 显示 `enabled: true`、`transport: streamable_http` |
| Claude Code | `~/.claude.json` | 用户级 `mcpServers.excalidraw`，`type=http`、`url`、`headers.Authorization` | `claude mcp list` 返回 `✔ Connected` |
| OpenCode | `~/.config/opencode/opencode.json` | `mcp.excalidraw`，`type=remote`、`url`、`headers.Authorization`、`enabled=true` | 独立干净环境启动的临时服务返回 `connected`；当前常驻服务需重启后生效 |

## 关键点

### 远程配置不依赖全局安装

四个客户端都直接连接公网服务，不需要在本机安装 `@reachforstar/excalidraw-tools`。此前为验证 Release tarball 做的全局安装已卸载，`excalidraw-mcp` 命令已移除。

### 代理会拦截国内端点

本机默认代理为 `127.0.0.1:7890`，访问 `mcp.togithub.icu` 会超时。`mcp.togithub.icu` 只允许国内直连，必须绕过代理。处理方式：

- `~/.bashrc`：把 `mcp.togithub.icu` 加入 `NO_PROXY`，并同步 `no_proxy`。新终端启动的 CLI 客户端直接生效。
- `~/.config/environment.d/90-mcp-no-proxy.conf`：为下次登录的桌面会话和 systemd 用户服务设置同一组 `NO_PROXY`。
- `~/.claude/settings.json`：在 `env` 中加入 `NO_PROXY` 与 `no_proxy`，即使外部环境重新开启代理，Claude Code 仍直连该域名。

已在显式设置代理变量的情况下验证 Pi 与 Claude Code：两者依据 `NO_PROXY` 仍能连接。

### 常驻进程需要重启

代理变量在进程启动时读取。当前正在运行的 OpenCode 服务启动于代理开启期间，进程环境仍含 `HTTPS_PROXY`，因此 `opencode mcp list` 显示 `ConnectionRefused`。用干净环境启动的临时 OpenCode 服务返回 `excalidraw connected`，证明配置本身正确。

关闭并重新打开 OpenCode、Pi 与 Codex，使新进程继承更新后的 `NO_PROXY`，配置即可生效。Claude Code 在加入 `settings.json` 的 `NO_PROXY` 后已连接，不需要等待会话重启。

## 验证命令

```bash
pi mcp list --json
claude mcp list
codex mcp get excalidraw
opencode mcp list
```

`pi mcp list` 与 `claude mcp list` 会实际建立连接；`codex mcp get` 只读取配置；`opencode mcp list` 通过常驻服务查询，需在重启后执行。

相关：[部署 MCP 到 mcp.togithub.icu](deploy-mcp-togithub.md)、[Excalidraw MCP 服务](../entities/excalidraw-mcp-server.md)、[MCP 传输选择](../decisions/mcp-transports.md)。
