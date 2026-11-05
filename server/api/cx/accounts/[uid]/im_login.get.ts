import QRCode from 'qrcode'

export default defineEventHandler(async (event) => {
  const cx = event.context.cx

  const session = await cx.getIMLoginSession()

  if (!session)
    return ResOp.error(500, '未能获取网页版聊天登录会话，可能登录态已失效，请重新登录该账号')

  return ResOp.success({
    ...session,
    qrDataUrl: await QRCode.toDataURL(session.qrText, { errorCorrectionLevel: 'H', margin: 2, width: 420 }),
  })
})
