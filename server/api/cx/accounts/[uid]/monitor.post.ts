import { IMConnectionMap, createIMConnection } from '~~/server/protocol/easemob'
import { handleListen } from '~~/server/utils/monitor'

export default defineEventHandler(async (event) => {
  const { cx, prisma } = event.context
  const uid = cx.user.uid

  if (IMConnectionMap.has(uid))
    return ResOp.success({ data: { mode: 'im', isOpened: true } }, '群聊推送监听已在运行')

  const account = await prisma.cxAccount.findUnique({
    where: { uid },
    include: { courses: true },
  })

  if (!account)
    return createError({ statusCode: 400, message: '账号不存在' })

  // 扫码激活过的账号能拿到环信 token，优先用群消息推送；没激活才退回轮询
  let { uid: imUid, token } = await cx.getWebIM().catch(() => ({ uid: '', token: '' }))

  // /webim/me 只在刚激活时下发 token，重启后拿不到就退回库里那份（24 小时内认它有效）
  const stored = account.setting as any
  if (!token && stored?.imToken && Date.now() - Number(stored.imTokenTime ?? 0) < 24 * 3600_000) {
    imUid = stored.imUid
    token = stored.imToken
    console.log('[群聊监听] 使用库里缓存的环信 token')
  }

  if (token) {
    const client = await createIMConnection()

    try {
      await client.open({ user: imUid, accessToken: token })

      await Promise.race([
        handleListen(client, cx, account),
        new Promise((_, reject) => setTimeout(() => reject(new Error('连接超时')), 20_000)),
      ])
    }
    catch (error: any) {
      return ResOp.error(500, `环信连接失败，仍使用轮询模式：${error?.message ?? error}`)
    }

    stopPoller(uid)

    if (!(account.setting as any)?.monitor) {
      await prisma.cxAccount.update({
        where: { uid },
        data: { setting: { ...(account.setting as any), monitor: true } },
      })
    }

    return ResOp.success({
      data: { mode: 'im', isOpened: IMConnectionMap.get(uid)?.isOpened() ?? false },
    }, '群聊推送监听已开启')
  }

  if (account.courses.length === 0)
    return createError({ statusCode: 400, message: '该账号还没有同步课程，请先在课程页同步后再开启' })

  if (!isPolling(uid))
    startPoller(uid)

  if (!(account.setting as any)?.monitor) {
    await prisma.cxAccount.update({
      where: { uid },
      data: { setting: { ...(account.setting as any), monitor: true } },
    })
  }

  return ResOp.success({
    data: { mode: 'poll', isOpened: true },
  }, '未激活网页版聊天，已开启自动签到轮询')
})
