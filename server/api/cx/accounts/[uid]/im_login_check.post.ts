import { createIMConnection, IMConnectionMap } from '~~/server/protocol/easemob'

interface Body {
  uid: string
  id: string
}

export default defineEventHandler(async (event) => {
  const { cx, prisma } = event.context
  const { id } = await readBody<Body>(event)

  if (!id)
    return createError({ statusCode: 400, message: '缺少会话 id，请先请求 im_login' })

  const status = await cx.checkIMLogin(id)

  // 1002 = 还在等待手机确认
  if (status?.code !== '0000') {
    return ResOp.success({
      activated: false,
      code: status?.code ?? null,
    })
  }

  const { uid, token, status: webIMStatus } = await cx.getWebIM()

  if (!token) {
    return ResOp.success({
      activated: true,
      imReady: false,
      // 手机确认成功但 /webim/me 仍是维护页，说明网页版聊天没为这个账号开放
      webIMStatus,
    }, '手机已确认，但聊天会话仍未下发 token')
  }

  const account = await prisma.cxAccount.findUnique({ where: { uid: cx.user.uid } })

  // 环信 token 只在内存会话里，dev 热重启后 /webim/me 又变回维护页，落库一份才能撑过重启
  await prisma.cxAccount.update({
    where: { uid: cx.user.uid },
    data: {
      setting: {
        ...(account?.setting as any),
        imUid: uid,
        imToken: token,
        imTokenTime: Date.now(),
      },
    },
  })

  const client = await createIMConnection()

  try {
    await client.open({ user: uid, accessToken: token })

    // handleListen 的 promise 要到 onOpened 才 resolve，加超时避免请求挂死
    await Promise.race([
      handleListen(client, cx, account!),
      new Promise((_, reject) => setTimeout(() => reject(new Error('连接超时')), 20_000)),
    ])
  }
  catch (error: any) {
    return ResOp.error(500, `环信连接失败，仍使用轮询模式：${error?.message ?? error}`)
  }

  // 推送监听已就绪，关掉轮询，避免两个引擎同时跑
  stopPoller(cx.user.uid)

  await prisma.cxAccount.update({
    where: { uid: cx.user.uid },
    data: {
      setting: {
        ...(account?.setting as any),
        monitor: true,
      },
    },
  })

  return ResOp.success({
    activated: true,
    imReady: true,
    isOpened: IMConnectionMap.get(cx.user.uid)?.isOpened() ?? false,
  }, '群聊监听已开启')
})
