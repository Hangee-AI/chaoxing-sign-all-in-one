import { ActivityStatusEnum, ActivityTypeEnum, SignMode } from '~/constants/cx'

const MAX_PHOTO_SIZE = 10 * 1024 * 1024

export default defineEventHandler(async (event) => {
  const parts = await readMultipartFormData(event)

  const field = (name: string) => parts?.find(part => part.name === name && !part.filename)?.data.toString()
  const photo = parts?.find(part => part.name === 'photo' && part.filename)

  const courseId = field('courseId')
  const activityId = field('activityId')
  const chatId = field('chatId')

  if (!activityId)
    return ResOp.error(400, '缺少活动 ID')

  if (!photo?.data?.length)
    return ResOp.error(400, '请选择一张照片')

  if (photo.data.length > MAX_PHOTO_SIZE)
    return ResOp.error(400, '照片超过 10MB，请换一张小一点的')

  // 群签到：接口和课程签到是两套，也没有活动详情可查
  if (chatId) {
    let groupResult = ''
    try {
      const status = await event.context.cx.preSignGroup(activityId, chatId)
      groupResult = status || await event.context.cx.signPhotoGroup(
        activityId,
        await event.context.cx.uploadPhotoToPan(photo.data, photo.filename || 'photo.jpg'),
        photo.filename || 'photo.jpg',
      )
    }
    catch (error: any) {
      groupResult = error?.message ?? '签到失败'
    }

    await event.context.prisma.signLog.create({
      data: {
        activityId,
        activityName: '群签到',
        type: 5,
        mode: SignMode.Manual,
        result: groupResult,
        time: new Date(),
        accountId: event.context.cx.user.uid,
      },
    })

    return ResOp.success({
      activity: null,
      result: groupResult,
    })
  }

  const activity = await event.context.cx.getActivityDetail(Number(activityId)).catch(() => null)

  if (!activity)
    return ResOp.error(204, '活动不存在或已结束，请重新打开弹窗刷新活动列表')

  if (!(activity.activeType === ActivityTypeEnum.Sign && activity.status === ActivityStatusEnum.Doing)) {
    return ResOp.success({
      activity,
      result: '不是签到活动或活动已结束',
    })
  }

  const course = {
    classId: activity.clazzId,
    courseId,
  }

  let result = ''
  try {
    const status = await event.context.cx.preSign(course as unknown as CX.Course, activity)

    if (status) {
      result = status
    }
    else {
      const objectId = await event.context.cx.uploadPhotoToPan(photo.data, photo.filename || 'photo.jpg')
      result = await event.context.cx.signPhoto(activity, objectId)
    }
  }
  catch (error: any) {
    result = error?.message ?? '签到失败'
  }

  await event.context.prisma.signLog.create({
    data: {
      activityId: String(activity.id),
      activityName: activity.name,
      type: activity.otherId,
      mode: SignMode.Manual,
      result,
      time: new Date(),
      accountId: event.context.cx.user.uid,
    },
  })

  return ResOp.success({
    activity,
    result,
  })
})
