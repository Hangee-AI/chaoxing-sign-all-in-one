# 学习通自动签到 · 全类型 · 全功能 · 含群聊拍照签到

Chaoxing (学习通) auto sign-in · all sign types · full features · including group-chat photo sign-in

<a href="https://www.npmjs.com/package/nuxt/v/rc"><img alt="size" src="https://img.shields.io/github/package-json/dependency-version/kuizuo/chaoxing-sign/dev/nuxt?style=flat&colorA=002438&colorB=28CF8D"></a>  <a href="https://github.com/kuizuo/chaoxing-sign/tree/HEAD/LICENSED"><img alt="License" src="https://img.shields.io/github/license/kuizuo/chaoxing-sign?style=flat&colorA=002438&colorB=28CF8D" /></a>

> Fork 自 [kuizuo/chaoxing-sign](https://github.com/kuizuo/chaoxing-sign)（MIT）。在上游基础上补齐了**普通群（自建群 / 院系群 / 纯通知群）里的拍照签到**——这类签到不在班级活动表里，走的是另一套 `/sign/*` 接口，上游完全覆盖不到；同时附赠一个 20 秒把签到链接从手机端抓到剪贴板的双击工具。

在这里你可以在摆脱客户端繁琐的签到流程，让签到不再是你的烦恼。

## ✨功能

- [x] 普通签到
- [x] 拍照签到
- [x] 位置签到
- [x] 手势签到
- [x] 签到码签到
- [x] 二维码签到
- [x] 监听签到任务,自动完成
- [x] 支持多用户批量签到

## 🆕 这个分支额外做的（上游没有）

- [x] **普通群签到**：自建群 / 院系群 / 纯通知群里老师发的签到。这类活动不在班级活动表里，`newsign/signDetail` 查不到，走的是完全另一套 `/sign/*` 接口
- [x] **服务端直传照片**：拍照签到不再依赖手机摄像头和 App 的 WebView（它用的是原生 JSBridge，压根没有 `<input type=file>`），照片由服务端传云盘拿 `objectId` 后提交
- [x] **粘链接识别签到**：把签到页链接贴进弹窗就能识别出活动
- [x] **`capture-tool/` 双击脚本**：20 秒把手机端签到链接抓到剪贴板
- [x] **监听改成 60s 轮询**：学习通网页版 IM / 环信 token 已被服务端永久关停（扫码确认后仍返回"系统维护中"），长连接这条路是死的

接口逆向结论、抓包配方和环境踩坑都在文档里：

- [docs/GROUP-SIGN.md](./docs/GROUP-SIGN.md) —— 群签到协议、为什么必须人工交一次链接
- [docs/PITFALLS.md](./docs/PITFALLS.md) —— Windows + WSL 下会静默失败的那些坑

[更多帮助](./content/help.md)

## 🛠 运行

```shell
git clone https://github.com/kuizuo/chaoxing-sign.git
cd chaoxing-sign
pnpm install
```

你需要一个 PostgreSQL 数据库地址（用于存储账号信息以及自动监控签到），然后将项目根目录下 `.env.example` 文件更改成 `.env` 并替换 `DATABASE_URL` 为数据库地址(通常是远程地址)。运行如下命令用于同步数据库：

```shell
npx prisma db push
```

```shell
pnpm run dev
```

### Windows 本地一键启动

双击 `start-dev.bat`：它会在 WSL 里拉起 PostgreSQL 并保持发行版不被回收（`wsl --shutdown` 之后 Windows 侧的 `127.0.0.1:5432` 镜像映射会消失，Prisma 直接连不上，所以这个常驻窗口是必须的），然后开 dev 服务器，等 8050 通了再打开浏览器。前提是 WSL 的 Ubuntu 里已配好免密 sudo 和 `chaoxing` 数据库。

打包

```shell
pnpm run build
pnpm run preview
```

## 部署

### PM2 + Nginx (推荐)

本项目已经编写好了 `ecosystem.config.js` 文件，具体请根据实际情况修改环境变量，你可以直接使用 PM2 来启动项目。

```shell
npm run start:pm2
```

此时已经启动好了本地端口为 `8050` 的服务，要注意，如果你使用了 Nginx 的反向代理，那么你需要将 `AUTH_ORIGIN` 环境变量设置为你的域名，否则将无法正常使用。并在 Nginx 中添加如下配置：

```nginx
    location / {
      proxy_pass http://127.0.0.1:8050;
    }
```

此外可能还需要配置 SSL 证书，因为要调用摄像头权限就必须是在安全环境下（即https下），否则你将无法使用扫一扫功能，这也是无奈之举。

### Docker

本项目已经编写好了 docker 相关文件，你可以直接使用 Docker 来启动项目。

> ⚠️ 注意: 需要将 node_modules 复制到镜像内, 因为 prisma client 产物存在 node_modules 内.

如果你有自己的 postgresql (远程)数据库，那么你需要在 Dockerfile 中修改 `DATABASE_URL` 环境变量为你的数据库地址，执行下方命令即可构建镜像。

```shell
docker buildx build . -t chaoxing-sign:latest
```

### Vercel or Netlify（不推荐）

由于采用 Nuxt.js 框架，所以非常容易部署在 Vercel 或 Netlify 等平台上，但还是不推荐部署，理由如下：

Vercel 或 Netlify 的服务器设立在国外，用户需要通过一些特殊手段能够访问，并且由于某星的服务器设立在国内，数据请求需要多一道障碍来访问，将导致响应速度过慢，网站体验效果极其不佳，已亲测，因此不推荐使用（无奈之举）。

## 📷 群拍照签到怎么用

课程里的签到不用管这一步——活动列表能自动列出来。只有**老师发在普通群里的签到**需要人工交一次链接，因为超星服务端根本没有暴露任何群签到的 HTTP 列表接口（详见 [docs/GROUP-SIGN.md](./docs/GROUP-SIGN.md)）。

**推荐用新的一键流程**（详见 [docs/QUICK-SIGN.md](./docs/QUICK-SIGN.md)）：

```
每次：
  双击 一键拍照签到.bat
  → 脚本先自愈（清上次残留的手机代理）、必要时自动拉起 8050 服务
  → 手机上点开那条签到卡片（进入拍照签到页即可）
  → 抓到链接后立刻恢复手机网络，并自动在手机浏览器打开签到页
  → 手机上「选择照片」→「提交签到」→ 页面直接显示学习通返回结果
```

抓包脚本的关键修复：**先确认 mitmdump 真的在 8080 监听才设代理**，并且整个流程包在 `try/finally` 里，抓完 / 超时 / 出错都会 `http_proxy :0` + `adb reverse --remove-all` + 关 mitmdump。以前窗口一关就会把手机留在死代理上（`net::ERR_EMPTY_RESPONSE`，所有网页都打不开）。手动兜底：双击 **`还原手机网络.bat`**。

```
已拿到链接时跳过抓包：
  capture-tool\quick-sign.ps1 -Link "<签到链接>"
首次（换新手机才需要）：装一次抓包 CA —— 手机浏览器打开 http://mitm.it 按提示安装
```

学习通 App 信任用户 CA，没有证书校验，所以证书装一次长期有效。

**另外提醒两点：**

1. 应用会把学习通账号的 **Cookie 明文存进你自己的 PostgreSQL**（`CxAccount.cookies`），`.env` 里有数据库口令。不要把这套服务部署到公网，也不要提交 `.env`。
2. 抓包工具会临时接管手机流量，代理挂着的时间段里 App 会报网络异常，所以顺序必须是"先装证书、再开代理、再点卡片"，用完立刻撤销（脚本已自动处理）。

## 🤝 免责声明

本项目仅作为个人技术专研，仅供学习参考。不得用于商业用途。

## 📝 License

MIT License © 2023-PRESENT Kuizuo
