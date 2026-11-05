// 网页版聊天拿不到推送时，用户可以把手机上签到卡片的链接粘过来；这里从链接里解析出活动 id 并查详情。
function extractActivityId(text: string) {
  const patterns = [
    /(?:activePrimaryId|propertyId|activeId|aid)=(\d{6,})/i,
    /signin:aid=(\d{6,})/i,
    /\/(?:pptSign|signDetail|showAction)\/(\d{6,})/i,
  ]

  for (const pattern of patterns) {
    const matched = text.match(pattern)
    if (matched)
      return matched[1]
  }

  return null
}

// 带 chatId 的是普通群里的签到卡片，走 /sign/* 那套接口
function extractChatId(text: string) {
  return text.match(/(?:chatId|chatid)=([^&#\s]+)/i)?.[1] ?? null
}

export default defineEventHandler(async (event) => {
  const { cx } = event.context
  const query = getQuery(event)
  const link = String(query.link ?? '').trim()
  const activityId = String(query.activityId ?? '')
    || (/^\d{6,}$/.test(link) ? link : '')
    || extractActivityId(link)
  const chatId = extractChatId(link)

  if (!activityId)
    return createError({ statusCode: 400, message: '没认出来签到编号，请粘贴学习通签到卡片的完整链接' })

  if (chatId) {
    try {
      const html = await cx.groupSignPage(activityId, chatId)
      const title = html.match(/<title>([^<]*)<\/title>/)?.[1]?.trim() || '群签到'
      const unavailable = !html.includes('stuSignajax')

      return ResOp.success({
        group: true,
        activityId,
        chatId,
        name: title,
        status: unavailable ? 2 : 1,
      })
    }
    catch (error: any) {
      return ResOp.error(500, `群签到页打不开（编号 ${activityId}）：${error?.message ?? error}`)
    }
  }

  let activity: Awaited<ReturnType<typeof cx.getActivityDetail>> | null = null

  try {
    activity = await cx.getActivityDetail(activityId)
  }
  catch (error: any) {
    return ResOp.error(500, `查询活动失败（编号 ${activityId}）：${error?.message ?? error}`)
  }

  if (!activity?.id)
    return ResOp.error(204, `编号 ${activityId} 在学习通里查不到对应活动`)

  return ResOp.success({
    activityId: String(activity.id),
    name: activity.name,
    activeType: activity.activeType,
    status: activity.status,
    ifPhoto: activity.ifPhoto,
    clazzId: activity.clazzId,
    courseid: (activity as any).courseId ?? '',
  })
})
