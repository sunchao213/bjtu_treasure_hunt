# Ubuntu 云服务器部署

适用于 Ubuntu 24.04 x86_64。网页、账号接口与 WebSocket 使用同一个 ASP.NET 服务，保留现有的同源登录方式。服务器无需安装 Node 或 .NET SDK，只安装 ASP.NET Core 8 运行时。

## 1. 在开发电脑打包

在仓库根目录使用 PowerShell 运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/package-ubuntu.ps1
```

脚本执行 `npm run check` 并发布后端，在 `artifacts/ubuntu/` 生成带时间戳的 ZIP 和 SHA256 文件。包内有 `server/`、`dist/`、安装脚本、部署说明和 `release.json`。只包含程序与资源，不包含本机数据库、账号或环境配置。

每个包是一个固定快照，包含当前未提交的源码修改。打包前后若发现源码发生变化，脚本会停止，不生成 ZIP；等修改结束再重试。建议在准备发布时记录一个已验证的 Git 提交。打包不会上传、提交或推送代码，现有运行版本也不会随工作区的编辑改变。

## 2. 在服务器安装运行时

通过阿里云 Workbench 登录，在服务器终端执行：

```bash
sudo apt-get update
sudo apt-get install -y aspnetcore-runtime-8.0 unzip curl python3
dotnet --list-runtimes
```

输出需包含 `Microsoft.AspNetCore.App 8.0.x`。Ubuntu 24.04 从 Ubuntu 软件源提供 .NET 8，安装最新可用补丁。当前项目目标是 .NET 8，其官方支持至 2026-11-10；正式长期运行前安排升级到受支持的 LTS 版本，再更新打包和运行时版本。

## 3. 上传并安装部署包

通过 Workbench 文件上传，将 ZIP 和 SHA256 上传到用户主目录。若当前 Workbench 不提供上传入口，也可以在本机使用配置好 SSH 的 `scp` 上传；不要将 ZIP 上传到 GitHub Pages。

在服务器终端运行，先将文件名替换为实际上传的文件名：

```bash
cd ~
sha256sum -c bjtu-game-实际时间戳.zip.sha256
mkdir bjtu-upload-01
unzip bjtu-game-实际时间戳.zip -d bjtu-upload-01
cd bjtu-upload-01
sudo bash deploy/ubuntu/install.sh
curl --fail http://127.0.0.1:5080/health
```

仅在校验通过后安装。每次更新使用新的解压目录。

安装脚本创建专用的 `bjtu-game` 用户和 systemd 服务，配置开机启动与异常重启。服务监听服务器本机 `127.0.0.1:5080`。程序位于 `/opt/bjtu-game/releases/`，`/opt/bjtu-game/current` 指向正在运行的版本；账号和进度位于独立的 `/var/lib/bjtu-game/game.db`，更新不会覆盖这个目录。每次更新已有数据库时会先创建一致性备份。启动检查失败会切回上一份代码，保留数据库与备份；不自动回退数据库结构。

## 4. 没有域名时先验证

公网 HTTP IP 地址不具备游戏需要的 Web Locks 安全上下文。先通过 SSH 把服务器端口转发到本机，再用 `localhost` 打开游戏，可以验证完整登录、云存档和联机，无需修改浏览器安全设置或放开公网 5080 端口。

先在云控制台为可 SSH 登录的用户配置密码或公钥，并确保允许你的电脑连接 SSH 22 端口。在本机 PowerShell 运行（替换公网 IP 和实际 SSH 用户；Workbench 的免密登录不代表本机 SSH 已配置）：

```powershell
ssh -N -L 127.0.0.1:5080:127.0.0.1:5080 admin@服务器公网IP
```

保持 SSH 窗口打开，在浏览器访问 `http://localhost:5080`。两位测试者可以分别在自己的电脑建立隧道，以不同账号登录同一房间，验证位置同步。也可以在一台电脑的两个独立浏览器中使用不同账号验证。

SSH 隧道只是初次验证方式。公开游玩时配置 HTTPS 后，玩家只需打开网址，发布者的电脑和 SSH 窗口均无需运行。

## 5. 正式公开访问

可以使用域名 HTTPS，也可以使用受浏览器信任的公网 IP HTTPS。两种方式都通过服务器上的 Nginx 反向代理到 `http://127.0.0.1:5080`；游戏服务与网页使用同一个访问地址，玩家不需要 SSH。关闭发布者电脑或终端不影响这个公网入口。

### 公网 IP HTTPS

Let's Encrypt 现已支持 [IP 地址证书](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability/)。IP 证书使用 `shortlived` 配置，有效期 160 小时，必须配置自动续期。使用 [Certbot 5.4 或更高版本](https://letsencrypt.org/2026/03/11/shorter-certs-certbot)的 webroot 方式签发，发行版自带的旧 Certbot 可能不支持。

先在云控制台开放 TCP 80、443，服务器上执行（将 IP 替换为实际公网 IPv4）：

```bash
sudo apt-get install -y nginx python3-venv
sudo bash deploy/ubuntu/ip-https.sh prepare 123.57.160.49
```

`prepare` 配置 HTTP 证书验证目录，并在独立 Python 环境安装 Certbot。从其他电脑确认以下地址返回 `bjtu-acme-ready` 后继续：

```text
http://123.57.160.49/.well-known/acme-challenge/bjtu-connectivity-check
```

```bash
sudo bash deploy/ubuntu/ip-https.sh issue 123.57.160.49
```

`issue` 先在独立目录测试签发，再申请正式证书，启用 HTTPS 与 WebSocket 代理；HTTP 游戏请求重定向至 HTTPS，证书验证路径保留在 HTTP。脚本安装 `bjtu-certbot-renew.timer`，每 6 小时检查续期，成功后自动重载 Nginx。80 端口需要持续可达，以便后续证书验证。5080 始终只监听回环。

```bash
sudo systemctl list-timers bjtu-certbot-renew.timer --all
sudo journalctl -u bjtu-certbot-renew.service -n 30 --no-pager

# 模拟续期并验证 Nginx 重载钩子
sudo /opt/bjtu-certbot/bin/certbot renew --cert-name bjtu-game-ip --dry-run --run-deploy-hooks
```

2026-11-04 已验证的游戏入口为 [https://123.57.160.49](https://123.57.160.49)。正式证书通过系统和浏览器校验；真实浏览器验证了安全上下文、Web Locks、注册、Secure/HttpOnly Cookie、云进度初始化、两个独立账号的 WSS 房间与位置同步。模拟续期及 Nginx 重载通过，验证用账号与存档已清理。

### 域名 HTTPS

准备域名、按云厂商要求完成北京等中国大陆节点的网站备案和接入流程，再把域名解析到服务器公网 IP。使用 Nginx 或 Caddy 在 443 提供 HTTPS；配置 WebSocket Upgrade，并保留原始 Host 和 `X-Forwarded-Proto`。反向代理需与游戏进程位于同一台主机，通过回环地址访问。后端只信任回环代理，不能任意放开可信代理列表。

部署完成后可在 GitHub Pages 介绍页放置新版游戏链接。程序更新仍沿用下一节的部署流程，独立安装的 Nginx、证书和续期任务继续保留。

## 6. 后续更新、备份与诊断

代码变化后重新打包、上传并执行安装脚本即可；服务器和系统无需重新购买或安装。更新会中断在线会话和正在进行的探索，安排在玩家退出后执行。已经确认保存的账号进度继续保留，异常中断局沿用游戏的失败规则。

```bash
# 运行状态与日志
sudo systemctl status bjtu-game --no-pager
sudo journalctl -u bjtu-game -n 80 --no-pager

# 创建可在服务运行时执行的一致性数据库备份
sudo bjtu-game-backup
sudo ls -lh /var/backups/bjtu-game

# 查看正在运行的代码版本
sudo cat /opt/bjtu-game/current/release.json
```

备份包含账号和玩家进度，定期另存到服务器以外的受控位置。仅替换程序文件，不删除 `/var/lib/bjtu-game`。恢复数据库需先停止服务，并按数据库说明处理 WAL/SHM 文件，见 [数据库说明](database.md)。

当前联机同步房间内玩家位置；共享敌人、战斗、掉落和撤离结算仍未实现，部署不会增加这些能力。
