---
title: MCP 传输选择：stdio 与无状态 Streamable HTTP
type: decision
tags: [mcp, 传输, 架构]
created: 2026-10-20
updated: 2026-11-09
sources: [README.md]
status: active
---

# MCP 传输选择：stdio 与无状态 Streamable HTTP

## 背景（现状与约束）

原有能力只是 cordis 插件，依赖宿主注入 `ctx.tools` 与会话工作区，其他 Agent 无法直接使用。要求转为 MCP 工具后，客户端形态分两类：

- 本机 Agent（Claude Code、Codex、OpenCode）由客户端拉起子进程，标准做法是 stdio。
- 需要常驻或跨进程共享时，客户端通过 URL 连接，需要 HTTP 传输。

场景是单进程内的文件读写，没有跨请求状态，也没有多租户隔离需求。

## 备选方案（各方案优劣）

| 方案 | 优点 | 缺点 |
| --- | --- | --- |
| 仅 stdio | 实现最小，无端口与鉴权问题 | 无法常驻复用；每个客户端各起一个进程 |
| stdio + 有状态 Streamable HTTP | 支持会话级能力、断点重连 | 需要会话表、清理与并发控制，单文件场景无收益 |
| stdio + 无状态 Streamable HTTP | 每请求独立，实现简单，天然并发 | 无会话级能力；每请求重建 server |

## 决策（选定方案）

同时提供 stdio（默认）与**无状态** Streamable HTTP：`POST /mcp`，每个请求新建一组 `McpServer` + `StreamableHTTPServerTransport`（不设置 `sessionIdGenerator`），响应使用 JSON 而非 SSE 流。

HTTP 默认绑定 `127.0.0.1`，端口默认 `7801`；非回环 `--host` 必须配置 `--token`，请求校验 `Authorization: Bearer`（常量时间比较）。携带 `Origin` 的请求只接受回环来源，防止浏览器 DNS rebinding；请求体上限 64 MiB、在途请求上限 32、请求/头部超时 5 分钟/15 秒。

## 理由（决策依据）

- 场景操作是无状态的：一次调用读或写一个文件，不需要会话记忆。
- 无状态实现消除了会话存储、超时清理和并发写会话表的问题，一个进程可服务多个并发客户端。
- stdio 保留为默认，符合本机 Agent 的常规接入方式，也不需要开放端口。
- 双传输共用同一 `createMcpServer(target)` 工厂，行为一致，测试可分别覆盖。

## 后果（影响与后续）

- 一个进程可服务多个工作区；每个工具调用用 `workspace` 指定目标，省略时使用首个根目录。
- 无状态模式不支持依赖会话的能力（采样、进度订阅、服务端主动通知）。
- 模型传入的导出路径仍限制在工作区内（解析软链接后校验）；`--scene` 只由运维设置。
- HTTP 请求体上限（64 MiB）是传输层防护；stdin/stdio 与插件入口不受此限制，场景写入本身仍按决策不设大小上限。
- 若将来需要会话级能力，需改为有状态传输并引入会话存储与过期策略。
