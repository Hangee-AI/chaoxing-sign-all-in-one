export interface GroupSignItem {
  uid: string
  activityId: string
  title: string
  groupName: string
  receivedAt: number
}

const globalForInbox = globalThis as unknown as {
  __cxGroupInbox?: Map<string, GroupSignItem[]>
}

const inbox = globalForInbox.__cxGroupInbox ??= new Map<string, GroupSignItem[]>()

// 不绑定课程的群（普通群/院系群）里的签到在班级活动列表里查不到，
// 只能靠群消息推送发现，先收进这里给前端弹窗用
export function pushGroupSign(item: GroupSignItem) {
  const list = inbox.get(item.uid) ?? []

  if (!list.some(i => i.activityId === item.activityId))
    list.unshift(item)

  inbox.set(item.uid, list.slice(0, 50))
}

export function getGroupSigns(uid: string) {
  return inbox.get(uid) ?? []
}
