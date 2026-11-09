import { SignMode } from '~/constants/cx'
import { prisma } from '~~/server/utils/db'
import { resolveCx } from '~~/server/utils/cx-instance'

// 手机浏览器上传照片的一键拍照签到接口。
// 不走 /api/cx（那里要求 next-auth 登录态），因为是本机自用工具：链接 + 照片就够了。
// 账号默认取数据库里最近登录过的那个学习通账号。

const MAX_PHOTO_SIZE = 10 * 1024 * 1024

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

function extractChatId(text: string) {
  return text.match(/(?:chatId|chatid)=([^&#\s]+)/i)?.[1] ?? null
}

export default defineEventHandler(async (event) => {
  const parts = await readMultipartFormData(event)
  const field = (name: string) => parts?.find(part => part.name === name && !part.filename)?.data.toString()
  const photo = parts?.find(part => part.name === 'photo' && part.filename)

  const link = String(field('link') ?? '').trim()
  const activityId = String(field('activityId') ?? '') || extractActivityId(link) || ''
  const chatId = String(field('chatId') ?? '') || extractChatId(link) || ''
  const uidInput = String(field('uid') ?? '').trim()

  if (!activityId)
    return ResOp.error(400, '没认出来签到编号：请把学习通签到卡片里的完整链接粘贴进来')

  if (!chatId)
    return ResOp.error(400, '这个链接里没有 chatId，一键接口目前只处理「群里的拍照签到」')

  if (!photo?.data?.length)
    return ResOp.error(400, '请先选一张照片')

  if (photo.data.length > MAX_PHOTO_SIZE)
    return ResOp.error(400, '照片超过 10MB，请换一张小一点的')

  const account = uidInput
    ? await prisma.cxAccount.findUnique({ where: { uid: uidInput } })
    : await prisma.cxAccount.findFirst({ orderBy: { lastLoginTime: 'desc' } })

  if (!account)
    return ResOp.error(400, '数据库里没有学习通账号，请先正常登录一次后面板')

  const cx = resolveCx(account)
  const filename = photo.filename || 'photo.jpg'

  let result = ''
  try {
    // 先问一次状态：空串代表还能签，非空就是「您已签到过了」「签到已结束」之类的提示
    const status = await cx.preSignGroup(activityId, chatId)
    result = status || await cx.signPhotoGroup(
      activityId,
      await cx.uploadPhotoToPan(photo.data, filename),
      filename,
    )
  }
  catch (error: any) {
    result = error?.message ?? '签到失败'
  }

  await prisma.signLog.create({
    data: {
      activityId,
      activityName: '群签到',
      type: 5,
      mode: SignMode.Manual,
      result,
      time: new Date(),
      accountId: account.uid,
    },
  }).catch(() => {})

  return ResOp.success({ uid: account.uid, activityId, chatId, result })
})
