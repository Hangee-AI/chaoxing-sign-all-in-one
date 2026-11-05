import type { CxAccount } from '@prisma/client'
import { Cookie } from 'tough-cookie'
import { CXMap, Cx } from '~~/server/protocol/cx'

/** 从数据库账号行还原一个已登录的 Cx 实例（复用 cookies），并按 uid 缓存。 */
export function resolveCx(account: CxAccount): Cx {
  const cached = CXMap.get(account.uid)
  if (cached)
    return cached

  const cx = new Cx(account.info as unknown as CX.User)
  cx.setting = account.setting as unknown as CX.Setting

  for (const cookieStr of account.cookies) {
    const cookie = Cookie.fromJSON(cookieStr as object)
    if (cookie)
      cx.cookieJar.setCookie(cookie!, `https://${cookie.domain}`)
  }

  CXMap.set(account.uid, cx)
  return cx
}
