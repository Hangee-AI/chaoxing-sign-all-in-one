import { ActivityStatusEnum, ActivityTypeEnum, SignMode } from '~/constants/cx'

/**
 * 群聊签到的轮询引擎。
 * 老师在群里发的签到本质是班级活动，定时拉取班级活动列表就能发现并签到。
 * 学习通网页版聊天(im.chaoxing.com)要先用手机扫码激活一次才会下发环信 token，
 * 激活成功后 im_login_check 会关掉这里的轮询，改用长连接推送。
 */
export const POLL_INTERVAL_MS = Number(process.env.NUXT_MONITOR_INTERVAL ?? 60_000)

const globalForPoller = globalThis as unknown as {
  __cxPollTimers?: Map<string, NodeJS.Timeout>
  __cxPollAttempted?: Map<string, Set<string>>
}

const timers = globalForPoller.__cxPollTimers ??= new Map<string, NodeJS.Timeout>()
const attempted = globalForPoller.__cxPollAttempted ??= new Map<string, Set<string>>()

async function pollOnce(uid: string) {
  const account = await prisma.cxAccount.findUnique({
    where: { uid },
    include: { courses: true },
  })

  if (!account) {
    console.log(`[自动签到] 账号 ${uid} 已删除，停止轮询`)
    stopPoller(uid)
    return
  }

  const cx = resolveCx(account)
  cx.setting = account.setting as unknown as CX.Setting

  // 每轮重新拉一次课程列表：老师新开的课/新建的课程群如果只靠数据库里的旧列表会漏掉签到
  try {
    cx.courseList = await cx.getCourseList()
  }
  catch (error: any) {
    if (cx.courseList.length === 0)
      cx.courseList = account.courses as unknown as CX.Course[]

    console.error(`[自动签到] 刷新课程列表失败（账号 ${uid}），本轮沿用 ${cx.courseList.length} 门旧课程:`, error?.message ?? error)
  }

  let doingSignList: Awaited<ReturnType<typeof cx.getAllActivity>> = []

  try {
    doingSignList = await cx.getAllActivity(ActivityTypeEnum.Sign, ActivityStatusEnum.Doing)
  }
  catch (error: any) {
    console.error(`[自动签到] 拉取活动列表失败（账号 ${uid}），可能是学习通登录态失效，请在网页重新登录该账号:`, error?.message ?? error)
    return
  }

  const done = attempted.get(uid) ?? new Set<string>()

  console.log(`[自动签到] ${new Date().toLocaleTimeString()} 轮询完成，进行中的签到: ${doingSignList.length} 个（课程 ${cx.courseList.length} 门）`)

  for (const item of doingSignList) {
    const activityId = String(item.id)
    if (done.has(activityId))
      continue

    // 先占位，避免同一个签到反复重试造成重复请求
    done.add(activityId)

    try {
      const activity = await cx.getActivityDetail(item.id)
      const result = await cx.handleSign(item.course, activity, cx.setting)

      console.log(`[自动签到] 课程: ${item.course.name} 活动: ${activity.name ?? item.name} 结果: ${result}`)

      await prisma.signLog.create({
        data: {
          activityId: String(activity.id ?? item.id),
          activityName: activity.name ?? item.name,
          type: activity.otherId ?? item.type,
          result,
          time: new Date(),
          mode: SignMode.Auto,
          accountId: uid,
        },
      })
    }
    catch (error: any) {
      // 网络等异常时释放占位，下一轮重试；签到通常只开放几分钟，不能永远跳过
      done.delete(activityId)
      console.error(`[自动签到] ${item.course.name} 处理失败:`, error?.message ?? error)
    }
  }

  attempted.set(uid, done)
}

export function startPoller(uid: string) {
  stopPoller(uid)

  console.log(`[自动签到] 启动轮询，账号 ${uid}，间隔 ${POLL_INTERVAL_MS / 1000}s`)

  pollOnce(uid).catch((error) => {
    console.error('[自动签到] 首次轮询失败:', error?.message ?? error)
  })

  const timer = setInterval(() => {
    pollOnce(uid).catch((error) => {
      console.error('[自动签到] 轮询失败:', error?.message ?? error)
    })
  }, POLL_INTERVAL_MS)

  timers.set(uid, timer)
}

export function stopPoller(uid: string) {
  const timer = timers.get(uid)
  if (timer) {
    clearInterval(timer)
    timers.delete(uid)
    console.log(`[自动签到] 已停止轮询，账号 ${uid}`)
  }
  attempted.delete(uid)
}

export function isPolling(uid: string) {
  return timers.has(uid)
}
