# Windows + WSL 本地开发踩过的坑

都是会静默失败、报错信息和真实原因完全对不上的那种。

## 1. dev 日志不能放在项目目录里

```
❌ pnpm dev > dev.log 2>&1
✅ pnpm dev > "$TEMP/cx-dev.log" 2>&1
```

Nitro 的 watcher 会检测到项目内文件变动 → 无限重启 → node 直接 segfault（exit 139）。

## 2. 热重启导致的 segfault 139

Nitro 热重启时数据库连接池 / 上游 HTTPS 请求被 reset，会产生没人 await 的 rejection，Node 默认终止进程，Windows 上表现为 segfault 139。`server/plugins/connect.ts` 顶部注册了兜底：

```ts
process.on('unhandledRejection', reason => console.error('[unhandledRejection]', reason))
```

## 3. cheerio 必须写成命名空间导入

```ts
import * as cheerio from 'cheerio'  // ✅
import cheerio from 'cheerio'       // ❌
```

写成 default import 会让整个 Nitro worker 起不来，日志只有
`[worker reload] [worker init] .nuxt/dev/index.mjs failed`，所有接口返回 503，看不出原因。
想看真实报错就手动跑 `PORT=8099 node .nuxt/dev/index.mjs`。

## 4. WSL 重启后 127.0.0.1:5432 消失

`wsl --shutdown` 之后 Windows 侧的镜像网络端口映射不会自动重建，Prisma 报
"Can't reach database server"，dev 服务器开机插件失败甚至整个 worker 起不来。

修法：`wsl --shutdown` → 起 postgres → 立刻挂一个常驻任务防止发行版被回收 → 重启 dev 服务器。
`start-dev.bat` 会把 `service postgresql start; sleep infinity` 开在单独的 WSL 窗口里，
用完关掉那个窗口即停止。

## 5. adb 的 Git Bash 路径坑

在 Git Bash 里 `adb push /sdcard/...` 会被 MSYS 改成 `C:/Program Files/Git/sdcard/...`。
加 `MSYS_NO_PATHCONV=1` 前缀，或者写完整的 `C:/Users/.../x.cer` 风格路径。

## 6. naive-ui 的 `n-qrcode` 在模板里不解析

`n-qrcode` camelize 成 `NQrcode`，而组件注册名是 `NQRCode`，结果渲染成一个未解析的自定义元素、页面上一片空白。
要显示二维码就用服务端 `qrcode` 生成 data URL 再 `<img>`。

## 7. `.client.vue` 里别依赖 `n-modal` 的 `@after-enter`

首屏 hydration 期间不触发。用 `watch(() => props.show)`。

## 8. server middleware 读 uid

`server/middleware/2.cx.ts` 对 POST 默认从 body 取 `uid`；multipart 请求的 body 是文件流，
已经加了分支从 URL 路径正则提取 uid。新增 multipart 接口时注意这一点。

## 9. 不要在项目里新建 debug 目录

诊断接口统一挂在 `server/api/cx/accounts/[uid]/` 下。删文件会让 Nitro 重启时崩，
所以调试完要留档的就写进文档，别留一堆一次性端点。

## 10. 抓包脚本崩溃 = 手机永久断网（最坑的一个）

旧脚本的顺序是：`start mitmdump` → 睡 4 秒 → `adb reverse` → `settings put global http_proxy 127.0.0.1:8080`。
如果 mitmdump 没起来、窗口被关掉、或脚本被 Ctrl+C 中断，**手机代理不会被还原**，
之后手机上所有网页都是 `net::ERR_EMPTY_RESPONSE`（看起来像「网页无法打开」，很容易被误判成证书问题）。

修复：见 `docs/QUICK-SIGN.md`。要点：
- 设代理前先 `Test-Port 8080`，确认 mitmdump 真在监听；
- 主体包在 `try/finally`，抓完/超时/异常都执行 `http_proxy :0` + `adb reverse --remove-all` + 杀 mitmdump；
- 每次启动先自愈一次（清残留代理）；
- 保留 `还原手机网络.bat` 作为手动兜底。

顺带：`adb shell settings get global http_proxy` 如果返回 `127.0.0.1:8080` 而 PC 上 8080 没监听，
就是这个坑；直接 `settings put global http_proxy :0` 即可。

## 11. GET /api/cx/... 必须在 query 里带 uid

`server/middleware/2.cx.ts` 的 GET 分支是 `context.params?.uid || getQuery(event)?.uid`，
middleware 跑在路由参数解析之前，`context.params.uid` 通常是空的——
所以调用方（包括 curl、`PhotoSignModal`）都要显式带 `?uid=xxx`，否则 400「请求账号不存在」。

## 12. 免登录页面用 `definePageMeta({ auth: false })`

`globalAppMiddleware` 开着时所有页面都要 next-auth 会话；手机端自用的签到页用
`definePageMeta({ auth: false, layout: false })` 绕过。它对应的接口别放在 `/api/cx` 下
（那里有鉴权 middleware），放 `/api/quick-sign` 即可。

## 13. 项目路径带中文 → dev 模式前端 JS 404，页面「点了没反应」

现象：页面能打开、SSR 内容正常，但**所有按钮点了都没反应**；「选择照片」还能弹相册，
因为那是浏览器原生 `<input type=file>` 的行为，不需要 JS。

定位：`curl http://127.0.0.1:8050/quick-sign` 的 HTML 里，入口脚本是
`/_nuxt/C:/Users/.../超星群聊拍照签到/node_modules/.../app/entry.js` 这种**带绝对路径的 URL**，
取回来是 **404**，于是 Nuxt 客户端永远不会 hydration（连 `nuxt build` 也会在 prerender 阶段报
`The argument 'filename' must be a file URL object ... Received 'file:///_entry.js'`）。

绕开：手机端要用的页面写成 `public/quick-sign.html`（纯静态 + 原生 JS + `fetch`），
由 Nitro 直接当静态文件吐出去，完全不经过 Vue hydration。

根治：把项目目录改成**纯 ASCII 路径**（例如 `C:\Users\18007\Desktop\chaoxing-sign`），
然后重装依赖（pnpm 在 Windows 用 junction，移动后要 `pnpm install` 重建）并重新 `nuxi dev`。

## 14. `.ps1` 脚本必须带 UTF-8 BOM，否则 PowerShell 5.1 会整篇语法报错

症状（双击 `一键拍照签到.bat` 跑出来的）：

```
Unexpected token '}' in expression or statement.
The Try statement is missing its Catch or Finally block.
The string is missing the terminator: ".
```

而且报错行里出现乱码（`itmdump 埋靶 8080 …`）。

原因：Windows PowerShell 5.1 读**没有 BOM 的** `.ps1` 时按系统 ANSI（中文系统是 GBK）解码，
脚本里的中文注释/提示先被解成乱码，引号和花括号配对随之崩掉。PowerShell 7（pwsh）默认按 UTF-8 读，
所以「开发机上好好的、发给别人就炸」，或者「`where pwsh` 没找到退回 powershell.exe 就炸」。

规矩：

- `capture-tool/*.ps1` 一律保存为 **UTF-8 with BOM**；
- 用编辑器/脚本改完这些文件后，重新补一次 BOM；
- 提交前验证：`powershell.exe -NoProfile -Command "$null=[scriptblock]::Create((Get-Content -Raw 'capture-tool\quick-sign.ps1')); 'OK'"`
  （PS 5.1 能解析 = BOM 正确）；
- `.bat` 反而是 **CRLF + 无 BOM**（`chcp 65001` 后面直接写 UTF-8 中文）。

## 15. 冷启动 dev 要 ~100 秒，且必须等 PostgreSQL 真的起来

现象：双击 `一键拍照签到.bat` 后脚本打印「签到工具没在跑，先启动它」，然后干等，
最后报 `等不到 http://127.0.0.1:8050 起来`；`%TEMP%\cx-dev.log` 里是
`Can't reach database server at 127.0.0.1:5432`。

原因：WSL 里 PostgreSQL 冷启动要几十秒，旧脚本只等 30 秒就放弃并直接起 dev，
dev 连不上库 → Nitro 进程退出 → 之后一直等一个永远不会起来的端口。

修法（`capture-tool\quick-sign.ps1`）：
- `Ensure-Postgres` 等到 90 秒，还连不上直接抛错（不要带病启动 dev）；
- `Start-DevServer` 用 `-RedirectStandardOutput/Error` 把日志写到
  `%TEMP%\cx-dev.log` / `%TEMP%\cx-dev.err.log`，失败时能直接看到原因；
- `Wait-WebServer` 给到 240 秒（实测冷启动 90~100 秒），超时时把日志最后几行打进异常。

排查结论：`.nuxt` 存在时冷启动约 100 秒，属于正常，不是卡死。

## 16. 把脚本发给别人：两层坑（写死路径 + 转发签到链接）

**坑 A：脚本写死了我本机的路径**，别人电脑上必然报「找不到 adb / 找不到 mitmdump / 找不到 node」。
已改成自动探测：
- adb：`PATH` → `%ANDROID_HOME%\platform-tools\adb.exe` → `%LOCALAPPDATA%\Android\Sdk\...` → `C:\Tools\adb\...`
- mitmdump：`PATH` → 常见 Python Scripts 目录 → `python -m mitmdump` 同目录
- dev：有 `pnpm` 用 pnpm，没有用 `corepack pnpm`，再没有用 `npx nuxi`

**坑 B：把签到链接转发给别人 = 别人签的是链接主人的签到**。
群签到链接里带 `uid=<链接主人的超星 uid>`，例如
`...&activeId=22677254&chatId=325091583918082&...&uid=462657756&ut=s`。
对方如果直接拿这条链接去签，签到记录就挂到那个 uid 名下（看着像「怎么用的是你的数据」）。
已在 `server/api/quick-sign.post.ts` 加校验：链接里的 `uid` 和当前登录账号不一致时直接报
「这条签到链接属于另一个学习通账号…请用自己的手机抓自己的链接」。

**给别人用的正确姿势**：发 zip 或 GitHub 链接，让对方按 `docs/INSTALL.md` 自己装、
用自己的学习通账号登录、用自己的手机抓自己的卡片链接。**不要转发签到链接，也不要转发 `.env` 和数据库。**
