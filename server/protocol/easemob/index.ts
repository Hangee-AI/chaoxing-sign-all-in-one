import type { EasemobChat, EasemobChatStatic } from 'easemob-websdk'
import WebSocket from 'ws'
import { JSDOM } from 'jsdom'

export interface OpenOptions {
  /** The User ID. */
  user: string
  /** The password. */
  pwd?: string
  /** Token required to connect to the message service. */
  accessToken?: string
  /** The Agora token. */
  agoraToken?: string
  success?: (res: any) => void
  error?: (res: any) => void
}

// Node >=21 把 globalThis.navigator/WebSocket 定义成只读 getter，直接赋值在 ESM 严格模式下会抛
// "Cannot set property navigator ... which has only a getter"，只能用 defineProperty 覆盖。
function setGlobal(name: string, value: any) {
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true,
    enumerable: true,
  })
}

export async function createIMConnection() {
  const { window } = new JSDOM('', { url: 'https://im.chaoxing.com/webim/me' })

  setGlobal('window', window)
  setGlobal('self', window)
  setGlobal('navigator', window.navigator)
  setGlobal('document', window.document)
  setGlobal('WebSocket', WebSocket)
  setGlobal('Image', window.Image)
  setGlobal('history', window.history)
  setGlobal('SVGElement', window.SVGElement)
  setGlobal('XMLHttpRequest', window.XMLHttpRequest)

  const Easemob = await import('easemob-websdk').then(lib => lib.default || lib) as any

  const { connection } = Easemob.default as EasemobChatStatic

  const conn: EasemobChat.Connection = new connection({
    url: 'https://im-api-vip6-v2.easecdn.com/ws',
    apiUrl: 'https://a1-vip6.easecdn.com',
    appKey: 'cx-dev#cxstudy',
    https: true,
    delivery: false,
    autoReconnectNumMax: 2,
  })

  return conn
}

export const IMConnectionMap = new Map<string, EasemobChat.Connection>()
