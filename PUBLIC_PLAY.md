# 公网联机说明

当前项目已经把单机版和联网版放在同一个 Node 服务里：

```bash
npm run dev
```

本机访问：

```text
http://127.0.0.1:5173/
http://127.0.0.1:5173/online.html
```

局域网访问：

```text
http://你的局域网IP:5173/online.html
```

## 方案一：临时公网联机

适合临时和朋友玩一两局。用隧道工具把本机 `5173` 暴露到公网。

### ngrok

```bash
ngrok http 5173
```

把输出里的 `https://...ngrok-free.app/online.html` 发给朋友。

### Cloudflare Tunnel

```bash
cloudflared tunnel --url http://127.0.0.1:5173
```

把输出里的 `https://....trycloudflare.com/online.html` 发给朋友。

注意：临时隧道地址每次启动可能变化；电脑关机或终端关闭后房间会消失。

## 方案二：正式公网部署

适合长期使用。把项目部署到支持 Node.js 的平台，例如 VPS、Render、Railway、Fly.io 等。

启动命令：

```bash
npm run dev
```

服务端会读取环境变量 `PORT`，平台分配端口时也能运行：

```bash
PORT=3000 npm run dev
```

部署成功后访问：

```text
https://你的域名/online.html
```

## 当前限制

- 房间状态保存在服务器内存中，服务重启后房间会消失。
- 目前使用 HTTP 轮询同步，已经能公网联机；后续可以升级 WebSocket 降低延迟。
- 还没有账号系统和断线重连保护，只适合熟人房间。
