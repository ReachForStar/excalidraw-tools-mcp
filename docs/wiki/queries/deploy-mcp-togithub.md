---
title: 部署 MCP 到 mcp.togithub.icu
type: query
tags: [部署, mcp, nginx, certbot, 阿里云, systemd]
created: 2026-10-20
updated: 2026-11-09
sources: []
status: active
---

# 部署 MCP 到 mcp.togithub.icu

## 问题与目标

把 `@reachforstar/excalidraw-tools` 0.1.0 以单租户方式部署到 `https://mcp.togithub.icu/mcp`，供 MCP 客户端通过 Bearer token 调用。一个进程、一个工作区、一个 token，不启用多工作区。

服务器：`ssh -p 21266 root@togithub.icu`，Ubuntu 22.04，公网 IP `118.178.90.168`。网络策略只允许国内访问，境外访问被禁用。

## 架构

| 组件 | 位置 | 说明 |
| --- | --- | --- |
| MCP 服务 | `excalidraw-mcp.service` | 以 `excalidraw` 系统用户运行，仅监听 `127.0.0.1:7801` |
| 反向代理 | `excalidraw-proxy.service` | 独立 Nginx 实例，读取 `/etc/nginx/nginx-mcp.conf`，监听 80/443 |
| 证书 | `/etc/letsencrypt/live/mcp.togithub.icu/` | Let's Encrypt，DNS-01 签发 |
| 工作区 | `/srv/excalidraw/workspace` | 唯一允许的根目录 |
| 包安装目录 | `/opt/excalidraw-tools` | `npm install --global --prefix` 安装本地 tarball |
| 环境文件 | `/etc/excalidraw-mcp.env` | 权限 600，保存 token 与 Chrome 路径 |
| 系统 Nginx | `nginx.service` | 已 `disable`，避免重启时抢占 80/443；现有其他站点不随之启动 |

公网只开放 80/443；MCP 端口 7801 不对外。

## 关键配置

服务单元：

```ini
[Service]
User=excalidraw
Group=excalidraw
WorkingDirectory=/opt/excalidraw-tools
EnvironmentFile=/etc/excalidraw-mcp.env
ExecStart=/usr/bin/node /opt/excalidraw-tools/bin/excalidraw-mcp --http --host 127.0.0.1 --port 7801 --workspace /srv/excalidraw/workspace
Restart=on-failure
RestartSec=3
```

说明：包内 `bin/excalidraw-mcp` 是指向 `lib/mcp.js` 的符号链接。入口判断先解析真实路径，再与 `import.meta.url` 比较，因此直接执行 bin 可以正常启动。systemd 使用 bin 入口，便于与本地 `npx`/全局安装保持一致。

代理只转发 `/mcp`：

```nginx
location = /mcp {
    proxy_pass http://127.0.0.1:7801;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Authorization $http_authorization;
    proxy_buffering off;
    proxy_read_timeout 300s;
}
```

说明：服务端请求超时为 5 分钟，代理读写超时不要低于 300 秒；请求体上限与服务端一致（64 MiB），需要时同步调整 `client_max_body_size`。

HTTP 站点把其他请求 301 到 HTTPS；`/.well-known/acme-challenge/` 保留给未来可能的 webroot 验证。

## 证书与续期

境外访问被禁用，Let's Encrypt 的 HTTP-01 验证从境外发起，实际返回连接超时，因此改用 DNS-01：

1. `certbot` 的 `manual` 认证钩子 `/usr/local/bin/certbot-dns-auth.sh` 把 `CERTBOT_VALIDATION` 写入 `/run/certbot-dns-challenge.txt`。
2. 在阿里云 DNS 添加 TXT：主机记录 `_acme-challenge.mcp`，值为钩子输出的验证串。
3. 钩子轮询 `dns27.hichina.com` / `dns28.hichina.com`，查到记录后退出，certbot 完成签发。
4. 续期后由 `/etc/letsencrypt/renewal-hooks/deploy/reload-excalidraw-proxy.sh` 重载代理。

当前证书有效期至 2027-01-18。**自动续期仍需要人工添加 TXT 记录**；如需全自动，需要配置阿里云 DNS API 凭据（RAM 用户 + DNS 权限），改用 `certbot-dns-aliyun` 或 `acme.sh` 的阿里云 DNS 模式。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| `GET https://mcp.togithub.icu/mcp` | 405，`Allow: POST` |
| 无 token `POST /mcp` | 401 |
| 带 token `initialize` | 返回 `serverInfo.name=excalidraw-mcp`、`version=0.1.0` |
| `tools/list` | 18 个工具 |
| `excalidraw_draw` | 写入矩形、绑定文本与椭圆 |
| `excalidraw_read` | 读回 3 个元素，含 `description` |
| `excalidraw_export` PNG | 成功，760×280，107108 字节 |
| `excalidraw_screenshot` | 成功，380×140，40775 字节，返回 `image/png` |
| 全局 bin `--version` | `@reachforstar/excalidraw-tools 0.1.0` |

## 客户端配置

```json
{
  "mcpServers": {
    "excalidraw": {
      "type": "http",
      "url": "https://mcp.togithub.icu/mcp",
      "headers": {
        "Authorization": "Bearer <token>"
      }
    }
  }
}
```

Token 只存放在服务器 `/etc/excalidraw-mcp.env`，不在 wiki 中记录。轮换 token 时修改该文件并执行 `systemctl restart excalidraw-mcp`。

四个本机客户端的配置路径、代理绕过与验证结果见[在四个客户端注册 Excalidraw MCP](mcp-clients-install.md)。

## 运维命令

```bash
systemctl status excalidraw-mcp excalidraw-proxy
journalctl -u excalidraw-mcp -f
systemctl restart excalidraw-mcp
systemctl reload excalidraw-proxy
certbot renew
```

## 导出文件的落地位置

远程服务的所有写入（`excalidraw_export`、`excalidraw_screenshot`、`excalidraw_export_to_json`）都相对服务器工作区 `/srv/excalidraw/workspace` 解析，`path` 参数只能用工作区内相对路径。工具返回值里的 `path` 是服务器绝对路径，本机 `ls` 该路径为 `No such file or directory`。`excalidraw_screenshot` 例外：它在结果中附带 `image/png` 图片内容，可直接查看；`excalidraw_export` 只返回元数据。

需要把导出图交到本地时，两条路径：

1. 用 `excalidraw_screenshot` 拿内联 PNG，再落盘。
2. 本地跑本仓库构建产物，工作区指向项目目录：`sceneTarget('<项目根>')` → `drawScene` → `exportScene`（`format: 'png'`、`scale` 0.5–4）。渲染器 `src/render.ts` 用 `playwright-core` 驱动本机 Chrome，无需远程服务。验证过 `node lib/mcp.js --version` 与 `/usr/bin/google-chrome` 可用。

远程工作区是共享画布：`excalidraw_draw` 的 `action: "replace"` 会清空他人留下的元素。改远程画布前先 `excalidraw_read`，用完恢复原状。


## 遗留问题

- 证书自动续期需要人工配合添加 TXT；可改为阿里云 DNS API 自动续期。
- 工作区保留了验证用文件：`mcp-smoke.png`、`mcp-smoke-shot.png` 与默认画布场景，可按需清理。
- 服务器只有 1.6 GiB 内存，大图导出可能触发 swap；当前 4 GiB swap 可用。

相关：[Excalidraw MCP 服务](../entities/excalidraw-mcp-server.md)、[MCP 传输选择](../decisions/mcp-transports.md)、[导出渲染器选择](../decisions/export-renderer.md)。
