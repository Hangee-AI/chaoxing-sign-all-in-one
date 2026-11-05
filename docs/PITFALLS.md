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
