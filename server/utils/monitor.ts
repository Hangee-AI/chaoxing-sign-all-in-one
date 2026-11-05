import { sleep } from '@kuizuo/utils'
import type { CxAccount } from '@prisma/client'
import type { EasemobChat } from 'easemob-websdk'
import { ActivityTypeEnum, SignMode } from '~/constants/cx'
import { Cx } from '~~/server/protocol/cx'

import { IMConnectionMap, createIMConnection } from '~~/server/protocol/easemob'

export async function handleMessage(message: EasemobChat.TextMsgBody, cx: Cx) {
  if (!message?.ext?.attachment)
    return

  const chatCourse = message.ext.attachment?.att_chat_course as CX.AttChatCourse

  if (!chatCourse?.atype)
    return

  // 群聊报文结构因群类型而异，先留原始数据，出问题时按日志对症处理
  console.log('[群聊监听] 收到活动消息:', JSON.stringify(chatCourse))

  // 如果是签到任务，则进行处理
  if (chatCourse.atype === ActivityTypeEnum.Sign) {
    const activity = await cx.getActivityDetail(chatCourse.aid)
    // 自建群/院系群的签到卡片可能没有 courseInfo，preSign 允许空 courseId/classId
    const info = chatCourse.courseInfo ?? {} as CX.AttChatCourse['courseInfo']
    const course = {
      courseId: info.courseid ?? '',
      classId: info.classid ?? '',
      name: info.coursename ?? chatCourse.title ?? '群聊签到',
      image: info.imageUrl,
      teacher: info.teacherfactor,
    } as any

    // 拍照签到不自动提交，收进收件箱等用户在网页上传照片
    if (activity.ifPhoto === 1) {
      pushGroupSign({
        uid: cx.user.uid,
        activityId: String(activity.id),
        title: activity.name ?? chatCourse.title ?? '拍照签到',
        groupName: info.coursename ?? chatCourse.title ?? '群聊',
        receivedAt: Date.now(),
      })
      console.log(`[群聊监听] 拍照签到已收进待处理列表: ${activity.name}`)
    }

    await sleep(cx.setting?.delay || Math.floor(Math.random() * (8000 - 3000 + 1) + 3000))

    const result = await cx.handleSign(course, activity, cx.setting)

    console.log(`课程: ${course.name} 活动: ${activity.name} 签到结果: ${result}`)

    await prisma.signLog.create({
      data: {
        activityId: String(activity.id),
        activityName: activity.name,
        type: activity.otherId,
        result,
        time: new Date(),
        mode: SignMode.Auto,
        accountId: cx.user.uid,
      },
    })
  }
}

export async function handleListen(client: EasemobChat.Connection, cx: Cx, account: CxAccount): Promise<void> {
  await new Promise((resolve, reject) => {
    client.listen({
      onOpened: async () => {
        console.log(cx.user.username, account.setting)
        await prisma.cxAccount.update({
          where: {
            uid: cx.user.uid,
          },
          data: {
            setting: {
              ...(account.setting as any),
              monitor: true,
            },
          },
        })
        IMConnectionMap.set(cx.user.uid, client)
        resolve(true)
      },
      onClosed: async () => {
        // 用户主动关闭监听时 unmonitor 会先把连接从 map 里摘掉，此时不能重连
        if (!IMConnectionMap.has(cx.user.uid)) {
          console.log(`[群聊监听] 账号 ${cx.user.uid} 已主动关闭，不再重连`)
          return
        }

        // retry connect
        // 如果用户在监听中更改设置后，然后在关闭监听时会导致 account 获取的是未设置前的数据
        // 因此这里重新从数据库中获取 新的 account 信息
        const account = await prisma.cxAccount.findUnique({
          where: {
            uid: cx.user.uid,
          },
        })

        try {
          await handleListen(client, cx, account)
        }
        catch (error) {
          await prisma.cxAccount.update({
            where: {
              uid: cx.user.uid,
            },
            data: {
              setting: {
                ...(account.setting as any),
                monitor: false,
              },
            },
          })
          IMConnectionMap.delete(cx.user.uid)
        }
      },
      onError: (error) => {
        reject(error)
      },
      onTextMessage: async (message) => {
        console.log('[群聊监听] text 消息:', JSON.stringify(message).slice(0, 800))
        await handleMessage(message, cx)
      },
      onCustomMessage: (message) => {
        console.log('[群聊监听] custom 消息:', JSON.stringify(message).slice(0, 800))
      },
      onCmdMessage: (message) => {
        console.log('[群聊监听] cmd 消息:', JSON.stringify(message).slice(0, 800))
      },
    })
  })
}

export async function initIMConnection() {
  const toMonitorAccounts = await prisma.cxAccount.findMany({
    where: {
      setting: {
        path: ['monitor'],
        equals: true,
      },
    },
  })

  for await (const account of toMonitorAccounts) {
    const cx = new Cx({ username: account.username, password: account.password })

    await cx.login()

    await prisma.cxAccount.update({
      where: {
        uid: cx.user.uid,
      },
      data: {
        lastLoginTime: new Date(),
      },
    })

    const { uid, token } = await cx.getWebIM()

    const client = await createIMConnection()
    await client.open({
      user: uid,
      accessToken: token,
    })

    await handleListen(client, cx, account)
  }

  return toMonitorAccounts
}
