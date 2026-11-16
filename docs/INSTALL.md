# 部署 / 分享给别人

> 这份文档是写给**没碰过这个项目的人**的：从一台干净的电脑开始，30 分钟内能到自己能用的状态。
>
> 想省事的话看「路线一」就够了；「路线二」才需要 Android 手机 + 抓包工具。

---

## 两条路线，先选一条

| | 路线一：只装服务（推荐给同学） | 路线二：全自动抓链接（自己用着爽） |
| --- | --- | --- |
| 能签什么 | 课程活动表里的签到（普通/拍照/位置/手势/签到码/二维码）+ **手动粘贴链接的群签到** | 全部 + 手机端一键把群签到链接抓到签到页 |
| 电脑要装 | Node.js、pnpm、PostgreSQL（或 Docker） | 路线一 + adb + Python + mitmproxy |
| 手机要装 | 什么都不用装，浏览器打开电脑的局域网地址即可 | 装 mitmproxy 证书、开 USB 调试 |
| 适合谁 | 只想要签到功能、不想折腾 | 经常被群签到打断、愿意花 20 分钟配一次 |

---

## 路线一：只装服务

### 0. 前置条件

- Windows 10/11（macOS/Linux 同理，路径换成对应命令）
- Node.js **20 或 22**（16 不行）
- PostgreSQL **14+**（本机、Docker、或任何能连上的远程库都行）

### 1. 装 Node.js 和 pnpm

```powershell
winget install OpenJS.NodeJS.LTS
# 新开一个终端，让 PATH 生效
corepack enable
corepack prepare pnpm@9 --activate
pnpm -v
```

> 不想用 corepack：`npm i -g pnpm` 也可以。

### 2. 起一个 PostgreSQL

最省事的是 Docker：

```powershell
docker run -d --name cx-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
docker exec -it cx-pg createdb -U postgres chaoxing
```

没有 Docker 就装 Windows 版 PostgreSQL，然后在 pgAdmin 里新建一个数据库 `chaoxing`。

### 3. 拿代码、装依赖

```powershell
git clone https://github.com/Hangee-AI/chaoxing-sign-all-in-one.git
cd chaoxing-sign-all-in-one
pnpm install
```

> **项目路径必须是纯英文/数字**。放在 `C:\Users\你\Desktop\超星群聊拍照签到` 这种带中文的目录里，
> dev 模式下前端脚本会 404，表现为「页面能打开但按钮点了没反应」（详见 `docs/PITFALLS.md` #13）。

### 4. 配 `.env`

```powershell
copy .env.example .env
notepad .env
```

至少改这三行：

```ini
AUTH_SECRET="随便一串长随机字符"
AUTH_ORIGIN="http://localhost:8050"
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/chaoxing"
```

### 5. 同步数据库表

```powershell
npx prisma db push
```

如果后面启动报 `@prisma/client did not initialize yet`，补一句 `npx prisma generate` 再启动。

### 6. 启动

```powershell
pnpm run dev
```

浏览器打开 <http://localhost:8050> → 注册一个账号（邮箱+密码，只存在你自己的库里）→ 绑定学习通手机号和密码。
绑定成功后，课程和签到活动就会开始轮询，能签的会自动签。

### 7. 群签到（拍照签到）怎么用

群里的签到不在课程活动表里，必须**手动交一次链接**。拿到链接后打开：

```
http://localhost:8050/quick-sign.html
```

把链接粘进输入框 → 选一张本地照片 → 点「提交签到」。
页面会直接显示学习通的返回原文（签到成功 / 您已签到过了 / 签到已结束…）。

如果给手机用：电脑和手机连同一个 WiFi，用 `http://电脑局域网IP:8050/quick-sign.html`
（电脑防火墙要放行 8050；IP 用 `ipconfig` 看）。

---

## 路线二：手机一键抓链接（可选）

1. 装 `adb`（Android platform-tools）和 Python：
   ```powershell
   python -m pip install mitmproxy
   ```
2. 手机开「开发者选项 → USB 调试」，用数据线连电脑，`adb devices` 能看到设备。
3. 手机浏览器打开 <http://mitm.it> 装 mitmproxy 的 CA 证书（设置里信任一次，长期有效）。
4. 双击项目根目录的 **`一键拍照签到.bat`**：
   - 脚本先自愈（清掉上次可能残留的手机代理）
   - 必要时自动拉起 8050 服务和数据库
   - 等 mitmdump 真的在 8080 监听**之后**才给手机设代理
   - 你去手机上点开那条签到卡片 → 抓到链接 → **立刻恢复手机网络** → 自动在手机浏览器打开上传页
5. 手机页面选照片 → 提交签到。

> 手机突然上不了网（网页报 `net::ERR_EMPTY_RESPONSE`）：双击 **`还原手机网络.bat`**，
> 或者手动 `adb shell settings put global http_proxy :0`。

没有 Android 手机 / 不想装证书：跳过路线二，用任意方式在手机上复制签到链接，粘到上面那个页面即可。

---

## 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| 页面能开，但按钮点了没反应 | 项目路径带中文导致 dev 前端脚本 404；用 `public/quick-sign.html` 静态页，或把项目移到纯英文路径 |
| `prisma` 连不上数据库 | PostgreSQL 没起；WSL 里注意 `networkingMode=mirrored` 在本机会失效，改 `NAT` 并保活 |
| 手机打不开 `127.0.0.1:8050` | `127.0.0.1` 指手机自己；USB 用 `adb reverse tcp:8050 tcp:8050`，否则用电脑局域网 IP |
| 手机所有网页都打不开 | 抓包脚本残留代理；`还原手机网络.bat` 或 `adb shell settings put global http_proxy :0` |
| 提交后照片不是自己选的 | 超星的拍照签到一般不能重签，需要老师撤销 |
| `pnpm install` 缺 rollup 二进制 | 别加 `--no-optional`，完整重跑 `pnpm install` |

---

## 什么不能分享

分享代码没问题，但**这些别发出去**（等于把你的账号交出去）：

- `.env` —— 数据库密码、`AUTH_SECRET`
- 数据库导出 / `prisma/data` —— 里面有 `CxAccount.cookies`，等于你的学习通登录态
- `node_modules`、`.nuxt`、`.output` —— 体积大、且和本机路径绑定

---

## 合规提醒

- 只用它签**自己**的账号；把服务给同学用（尤其是多人共用一套）容易触发超星的风控（异地登录、异常设备）。
- 想分享给同学，最稳的是让他**自己部署一套**（把这份文档和仓库链接发给他）。
- 上游项目是 MIT 协议，分发时保留 `LICENSE` 和 README 里的 fork 说明。
