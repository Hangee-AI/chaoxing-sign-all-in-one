import { IMConnectionMap } from '~~/server/protocol/easemob'

export default defineEventHandler(async (event) => {
  const { cx, prisma } = event.context
  const uid = cx.user.uid

  const account = await prisma.cxAccount.findUnique({
    where: {
      uid,
    },
  })

  stopPoller(uid)

  const client = IMConnectionMap.get(uid)
  if (client) {
    try {
      await client.close()
    }
    catch (error: any) {
      console.log(`[群聊监听] 关闭连接时出错: ${error?.message ?? error}`)
    }
    IMConnectionMap.delete(uid)
  }

  if ((account?.setting as any)?.monitor) {
    await prisma.cxAccount.update({
      where: {
        uid,
      },
      data: {
        setting: {
          ...(account?.setting as any),
          monitor: false,
        },
      },
    })
  }

  return ResOp.success({
    data: {
      isOpened: false,
    },
  })
})
