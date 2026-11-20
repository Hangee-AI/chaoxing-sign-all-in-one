# 给同学的一页说明（可直接转发）

> 这是「超星拍照签到助手」的部署说明。**自己部署一套 = 用你自己的学习通账号签到**，
> 别用别人发你的签到链接（那样签的是链接主人的考勤）。

## 一、三件事（10 分钟）

1. 装 **Node 20+/22** 和 **pnpm**（`corepack enable` 后 `corepack prepare pnpm@9 --activate`），
   再装一个 **PostgreSQL 14+**（最省事是 Docker：`docker run -d --name cx-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16`）。
2. 拿代码、装依赖、建库：

   ```powershell
   git clone https://github.com/Hangee-AI/chaoxing-sign-all-in-one.git
   cd chaoxing-sign-all-in-one
   pnpm install
   copy .env.example .env
   notepad .env      # 改 AUTH_SECRET 和 DATABASE_URL
   npx prisma db push
   pnpm run dev
   ```

3. 打开 <http://localhost:8050> → 注册一个账号（只存在你自己库里）→ 绑定**你自己的**学习通手机号 + 密码。

> ⚠️ 项目目录不要放在带中文的路径里，否则前端脚本会 404（页面能开、按钮点了没反应）。

## 二、群里的拍照签到

群签到不在课程活动表里，必须手动交一次链接：

1. 手机上学通点开那条签到卡片 → 复制链接（或者用路线二的 `一键拍照签到.bat` 自动抓）。
2. 电脑打开 <http://localhost:8050/quick-sign.html>，粘贴链接 → 选一张**你自己的**本地照片 → 提交。
3. 页面会直接显示学通返回的原文（签到成功 / 您已签到过了 / 活动已结束…）。

手机上用：电脑和手机连同一 WiFi，打开 `http://电脑局域网IP:8050/quick-sign.html`（防火墙放行 8050）。

## 三、千万不要

| 别做 | 为什么 |
| --- | --- |
| 转发**签到链接**给别人 | 链接里带 `uid=<链接主人的超星 uid>`，谁点谁就是把考勤记到链接主人名下（对方会看到「怎么签的是别人的数据」） |
| 转发 `.env` / 数据库备份 | 里面有数据库密码、学习通账号密码和 cookies，等于把账号交出去 |
| 多人共用一套服务 | 容易触发超星异地登录风控 |

正确做法：**发这个仓库链接，让对方自己部署一套、自己抓自己的链接。**
现在服务端会校验链接里的 `uid` 和自己的账号是否一致，不一致会直接拒绝并提示。

## 四、常见报错

| 现象 | 处理 |
| --- | --- |
| `找不到 adb / 找不到 mitmdump / 找不到 node` | 路线二才需要 adb 和 mitmproxy；只用「粘链接」的路线一不需要。装了但还报，重开一个终端让 PATH 生效 |
| 提交后 `internal server error` | 数据库没连上：确认 PostgreSQL 在跑（`pg_isready`），WSL 里的库别让它休眠 |
| `群签到页拿不到提交入口，活动可能已结束或链接不对` | 学习通 cookies 过期了；新版会自动用库里密码重登一次，仍失败就去面板重新绑定一次 |
| `这条签到链接属于另一个学习通账号…` | 你粘的是别人的链接，换成自己的 |
| 手机所有网页都打不开 | 抓包脚本残留代理；双击 `还原手机网络.bat` |

更多细节见 `docs/INSTALL.md`、`docs/PITFALLS.md`。
