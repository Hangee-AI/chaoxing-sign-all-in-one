// Nitro 热重启时，数据库连接池和上游 HTTPS 请求会被 reset，产生没人 await 的 rejection。
// Node 默认会直接终止进程（Windows 上表现为 segfault 139），这里兜住只打日志。
process.on('unhandledRejection', (reason: any) => {
  console.error('[unhandledRejection]', reason?.message ?? reason)
})

export default defineNitroPlugin(async (_nitroApp) => {
  // 开机时恢复上次开启过的自动签到轮询。
  // 原先这里跑的是环信 IM 长连接(initIMConnection)，但学习通网页版聊天需要手机扫码激活，
  // 未激活时拿不到 token，所以先用轮询班级活动列表兜底。
  try {
    const accounts = await prisma.cxAccount.findMany({
      where: {
        setting: {
          path: ['monitor'],
          equals: true,
        },
      },
    })

    for (const account of accounts) {
      startPoller(account.uid)
    }

    if (accounts.length > 0)
      console.log(`[自动签到] 已为 ${accounts.length} 个账号恢复轮询`)
  }
  catch (error: any) {
    // 数据库没起来时只记录，不要让 Nitro 因 unhandledRejection 崩掉
    console.error('[自动签到] 开机恢复轮询失败（数据库不可用？）:', error?.message ?? error)
  }
})
