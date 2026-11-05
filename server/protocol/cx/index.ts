import { qsParse, qsStringify, sleep, timestamp } from '@kuizuo/utils'
import { mapLimit } from 'async'
import type { Got } from 'got'
import { CookieJar } from 'tough-cookie'
import * as cheerio from 'cheerio'
import got from 'got'
import { PHOTO_SIGN_REQUIRED } from '~/constants/cx'

export enum ActivityTypeEnum {
  Sign = 2, // 签到
  Answer = 4, // 抢答
  Talk = 5, // 主题谈论
  Question = 6, // 投票
  Pick = 11, // 选人
  Homework = 19, // 作业
  Evaluation = 23, // 评分
  Practice = 42, //  随堂练习
  Vote = 43, // 投票
  Notice = 45, // 通知
}

export enum ActivityStatusEnum {
  Doing = 1,
  Done = 2,
}

export enum SignTypeEnum {
  Normal = 0, // 普通签到
  QRCode = 2, // 二维码签到
  Gesture = 3, // 手势签到
  Location = 4, // 位置签到
  Code = 5, // 签到码签到
}

export const signTypeMap: Record<number, string> = {
  0: '普通签到',
  2: '二维码签到',
  3: '手势签到',
  4: '位置签到',
  5: '签到码签到',
} as const

export class Cx {
  public http!: Got
  public cookieJar: CookieJar
  public currentUrl = ''

  public user!: CX.User
  public setting!: CX.Setting
  public courseList: CX.Course[] = []

  constructor(user: Partial<CX.User>) {
    this.cookieJar = new CookieJar()

    this.http = got.extend({
      responseType: 'json',
      cookieJar: this.cookieJar,
      hooks: {
        afterResponse: [
          (response) => {
            this.currentUrl = response.url
            return response
          },
        ],
      },
    })

    this.user = user as CX.User
    return this
  }

  getCookie<T extends 'json' | 'string' = 'string'>(key?: string, type?: T, url?: string): T | string {
    if (this.cookieJar && (url || this.currentUrl)) {
      if (key) {
        const cookies = this.cookieJar.getCookiesSync(url || this.currentUrl).find(c => c.key === key)
        return cookies ? cookies.value : '' as string
      }

      if (type === 'json') {
        const cookies = this.cookieJar.getCookiesSync(url || this.currentUrl)
        return cookies as unknown as any
      }

      else {
        const cookieString = this.cookieJar.getCookieStringSync(url || this.currentUrl)
        return cookieString
      }
    }

    return ''
  }

  setCookie(cookie: string, url?: string) {
    if (this.cookieJar && cookie)
      this.cookieJar.setCookieSync(cookie, url || this.currentUrl)
  }

  async login(): Promise<string | null> {
    if (/^1[3-9]\d{9}$/.test(this.user.username)) {
      const { body: data } = await this.http.get<CX.LoginResult>('https://passport2.chaoxing.com/api/login', {
        searchParams: {
          name: this.user.username,
          pwd: this.user.password,
          schoolid: '',
          verify: '',
        },
      })

      if (!data.result)
        return data.errorMsg

      await this.parseUserInfo(data)
      this.user.logged = true
      return '登录成功'
    }
    else {
      return '账号密码格式不正确'
    }
  }

  async logout() {
    this.user = {} as CX.User
    this.courseList = []
    this.cookieJar.removeAllCookiesSync()
  }

  async parseUserInfo(data: CX.LoginResult) {
    this.user = {
      ...this.user,
      ...data,
      uid: String(data.uid),
    } as unknown as CX.User

    const { body: html } = await this.http.get(`http://i.chaoxing.com/base?t=${timestamp()}`, { responseType: 'text' })

    const $ = cheerio.load(html)
    this.user.avatar = `${$('.head-img').attr('src')! + this.user.uid}_80`
    this.user.siteName = $('#siteName').attr('title')
  }

  async getCourseList(): Promise<CX.Course[]> {
    interface CourseBody {
      courseType: string
      courseFolderId: string
      courseFolderSize: string
    }

    const body: CourseBody = { courseType: '1', courseFolderId: '0', courseFolderSize: '0' }
    const html = await this.http.post(
      'http://mooc1-1.chaoxing.com/visit/courselistdata',
      {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: qsStringify(body as any),
        responseType: 'text',
      },
    ).text()

    const $ = cheerio.load(html)

    const courseList = $('.course').map((i, el) => {
      const image = $(el).find('img').attr('src')!
      const href = $(el).find('.course-info a').attr('href')!
      const name = $(el).find('.course-name').attr('title')!
      const { courseid, clazzid, cpi } = qsParse(href.substring(href.indexOf('?') + 1))!

      return {
        name,
        courseId: courseid,
        classId: clazzid,
        cpi,
        image,
        link: href,
      }
    }).get() as CX.Course[]

    this.courseList = courseList
    return courseList
  }

  async getActivityList(course: CX.Course) {
    const { body: data } = await this.http.get<CX.ActivityListResponse>('https://mobilelearn.chaoxing.com/v2/apis/active/student/activelist', {
      searchParams: {
        fid: this.user.schoolid,
        courseId: course.courseId,
        classId: course.classId,
        _: timestamp(),
      },
    })

    return data.data.activeList ?? []
  }

  /*
    根据 aid 获取活动详情
  */
  async getActivityDetail(activeId: string | number) {
    const { body: data } = await this.http.get<CX.ActivityDetail>('https://mobilelearn.chaoxing.com/newsign/signDetail', {
      searchParams: {
        activePrimaryId: activeId,
        type: 1,
      },
    })

    return data
  }

  /*
    需要先发送预签到请求 才能够正常记录签到记录
  */
  preSignParams(course: CX.Course, activity: CX.ActivityDetail) {
    return {
      courseId: course.courseId || '',
      classId: course.classId,
      activePrimaryId: activity.id,
      general: '1',
      sys: '1',
      ls: '1',
      appType: '15',
      uid: this.user.uid,
      isTeacherViewOpen: 0,
      // 是否为刷新二维码的
      ...((activity.ifRefreshEwm) && { rcode: encodeURIComponent(`SIGNIN:aid=${activity.id}&source=15&Code=${activity.code}&enc=${activity.enc}`) }),
    }
  }

  async preSign(course: CX.Course, activity: CX.ActivityDetail) {
    const { body: html } = await this.http.get('https://mobilelearn.chaoxing.com/newsign/preSign', {
      searchParams: this.preSignParams(course, activity),
      responseType: 'text',
    })

    await sleep(500)

    // 两条必要请求!  位置签到必备
    const { body: data } = await this.http.get(
      'https://mobilelearn.chaoxing.com/pptSign/analysis',
      {
        searchParams: {
          vs: 1,
          DB_STRATEGY: 'RANDOM',
          aid: activity.id,
        },
        responseType: 'text',
      },
    )
    const code = data.match(/code='\+'(.*?)'/)?.[1]
    const { body: data1 } = await this.http.get(
      'https://mobilelearn.chaoxing.com/pptSign/analysis2',
      {
        searchParams: {
          DB_STRATEGY: 'RANDOM',
          code,
        },
        responseType: 'text',
      },
    )
    console.log('analysis 结果: ', data1)

    await sleep(500)

    const $ = cheerio.load(html)

    const status = $('#statuscontent').text().trim().replaceAll(/[\n\s]/g, '')
    console.log(`${course.name} ${signTypeMap[activity.otherId]} 预签到状态: `, status)
    if (status)
      return status
  }

  /*
    签到请求
  */
  async stuSign(query: string) {
    const { body: data } = await this.http.get('https://mobilelearn.chaoxing.com/pptSign/stuSignajax', {
      searchParams: query,
      responseType: 'text',
    })

    if (data === 'success' || data === '您已签到过了')
      return '签到成功'
    else if (data === 'success2')
      return '签到已过期'

    return data
  }

  async signNormal(activity: CX.ActivityDetail) {
    const query = qsStringify({
      activeId: activity.id,
      uid: this.user.uid,
      clientip: '',
      latitude: '-1',
      longitude: '-1',
      appType: '15',
      fid: this.user.schoolid,
      name: this.user.realname,
    }, '', '', { encodeURIComponent: s => s })

    return this.stuSign(query)
  }

  async signCode(activity: CX.ActivityDetail, signCode: string) {
    const { body: data } = await this.http.get<{ result: number; errorMsg: string }>(
      'https://mobilelearn.chaoxing.com/widget/sign/pcStuSignController/checkSignCode',
      {
        searchParams: {
          activeId: activity.id,
          signCode,
        },
        responseType: 'json',
      },
    )

    if (data.result !== 1)
      return data.errorMsg

    await sleep(200)

    const query = qsStringify({
      activeId: activity.id,
      uid: this.user.uid,
      clientip: '',
      latitude: '',
      longitude: '',
      appType: '15',
      fid: this.user.schoolid,
      name: this.user.realname,
      signCode,
    }, '', '', { encodeURIComponent: s => s })

    return this.stuSign(query)
  }

  async signGesture(activity: CX.ActivityDetail, signCode: string) {
    const { body: data } = await this.http.get<{ result: number; errorMsg: string }>(
      'https://mobilelearn.chaoxing.com/widget/sign/pcStuSignController/checkSignCode',
      {
        searchParams: {
          activeId: activity.id,
          signCode,
        },
        responseType: 'json',
      },
    )

    if (data.result !== 1)
      return data.errorMsg

    await sleep(200)

    const query = qsStringify({
      activeId: activity.id,
      uid: this.user.uid,
      clientip: '',
      latitude: '',
      longitude: '',
      appType: '15',
      fid: this.user.schoolid,
      name: this.user.realname,
      signCode,
    }, '', '', { encodeURIComponent: s => s })

    return this.stuSign(query)
  }

  async signPhoto(activity: CX.ActivityDetail, objectId: string) {
    const query = qsStringify({
      activeId: activity.id,
      uid: this.user.uid,
      clientip: '',
      latitude: '-1',
      longitude: '-1',
      appType: '15',
      fid: this.user.schoolid,
      objectId,
      name: this.user.realname,
    }, '', '', { encodeURIComponent: s => s })

    return this.stuSign(query)
  }

  /**
   * 拍照签到要先把照片传到学习通云盘换 objectId。
   * 上传凭证 _token 只在账号自己的云盘首页下发，所以每次都重新取一次。
   */
  async uploadPhotoToPan(file: Buffer, filename: string) {
    const { body: html } = await this.http.get('https://pan-yz.chaoxing.com/', { responseType: 'text' })

    const token = String(html).match(/const _token = "([^"]+)"/)?.[1]
    const puid = String(html).match(/const currentPuid = "([^"]+)"/)?.[1] ?? this.user.uid

    if (!token)
      throw new Error('获取云盘上传凭证失败，学习通登录态可能已过期')

    const form = new FormData()
    form.append('puid', String(puid))
    form.append('_token', token)
    form.append('file', new Blob([file]), filename)

    const { body } = await this.http.post<{ result: boolean, objectId?: string, msg?: string }>(
      'https://pan-yz.chaoxing.com/upload',
      { body: form as any, responseType: 'json', timeout: { request: 60_000 } },
    )

    if (!body?.result || !body.objectId)
      throw new Error(`照片上传失败: ${body?.msg ?? '未知错误'}`)

    return body.objectId
  }

  /*
    普通群（自建群/院系群/纯通知群）里的签到走 /sign/* 这一套接口：
    活动不在课程活动表里，newsign/signDetail 查不到，aid 和 chatId 只能从签到页链接拿。
  */
  groupSignParams(activityId: string, chatId: string) {
    return {
      activeId: activityId,
      code: '',
      uid: this.user.uid,
      courseId: 'null',
      classId: 0,
      general: 0,
      chatId,
      appType: 0,
      atype: 'null',
      sys: 0,
    }
  }

  async groupSignPage(activityId: string, chatId: string) {
    const { body: html } = await this.http.get('https://mobilelearn.chaoxing.com/sign/preStuSign', {
      searchParams: this.groupSignParams(activityId, chatId),
      responseType: 'text',
    })

    return String(html)
  }

  // 返回空串表示群签到页可用、可以提交
  async preSignGroup(activityId: string, chatId: string) {
    const text = await this.groupSignPage(activityId, chatId)

    const $ = cheerio.load(text)
    const status = $('#statuscontent').text().trim().replaceAll(/[\n\s]/g, '')
    if (status)
      return status

    if (!text.includes('stuSignajax'))
      return '群签到页拿不到提交入口，活动可能已结束或链接不对'

    return ''
  }

  async signPhotoGroup(activityId: string, objectId: string, filename: string) {
    const { body: data } = await this.http.post<string>('https://mobilelearn.chaoxing.com/sign/stuSignajax', {
      responseType: 'text',
      form: {
        activeId: activityId,
        uid: this.user.uid,
        clientip: '',
        useragent: '',
        latitude: '-1',
        longitude: '-1',
        fid: String(this.user.schoolid ?? '0'),
        objectId,
        // 手机上是原生选图后自动传云盘再回填这个结果，服务端只需要给出同样的 objectid 结构
        photoResult: JSON.stringify({ files: [{ name: filename, objectid: objectId, type: 'jpg' }] }),
      },
    })

    const text = String(data)
    if (text === 'success' || text === '您已签到过了')
      return '签到成功'
    else if (text === 'success2')
      return '签到已过期'

    return text
  }

  async signLocation(activity: CX.ActivityDetail,
    location: CX.SignLocation = {
      text: '',
      latitude: '-1',
      longitude: '-1',
    }) {
    // 位置 https://api.map.baidu.com/lbsapi/getpoint/index.html
    const query = qsStringify({
      activeId: activity.id,
      address: location.text,
      uid: this.user.uid,
      clientip: '',
      latitude: location.latitude,
      longitude: location.longitude,
      appType: '15',
      fid: this.user.schoolid,
      name: this.user.realname,
      ifTiJiao: 1,
      validate: '',
    }, '', '', { encodeURIComponent: s => s })

    return this.stuSign(query)
  }

  async signQrCode(activity: CX.ActivityDetail, enc: string) {
    const query = qsStringify({
      enc,
      name: this.user.realname,
      activeId: activity.id,
      uid: this.user.uid,
      clientip: '',
      useragent: '',
      latitude: '-1',
      longitude: '-1',
      fid: this.user.schoolid,
      appType: '15',
    }, '', '', { encodeURIComponent: s => s })

    return this.stuSign(query)
  }

  async getAllActivity(type?: ActivityTypeEnum, status?: ActivityStatusEnum) {
    const courseList = this.courseList.length > 0 ? this.courseList : await this.getCourseList()

    const activityArr = await mapLimit(courseList, 5, async (course: CX.Course) => (await this.getActivityList(course)).map(a => ({ course, ...a })))

    return activityArr.flat(1)
      .filter((activity: { type: number; status: number }) => (type ? activity.type === type : true) && (status ? activity.status === status : true))
      .map(a => ({
        ...a,
        ...({
          name: a.name || a.nameOne,
        }),
      }))
  }

  async signByCourse(course: CX.Course) {
    const activityList = await this.getActivityList(course)

    const signActivityList = activityList.filter(activity => activity.type === ActivityTypeEnum.Sign && activity.status === ActivityStatusEnum.Doing)

    const signResults: CX.SignResult[] = []

    for await (const a of signActivityList) {
      if (a.type === ActivityTypeEnum.Sign) {
        const activity = await this.getActivityDetail(a.id)
        const result = await this.handleSign(course, activity)

        console.log(`课程: ${course.name} 签到结果: ${result}`)

        signResults.push({
          activity: {
            ...a,
            ...activity,
          },
          signType: activity.otherId,
          result,
        })
      }
    }

    return signResults
  }

  async signByActivity(course: CX.Course, activity: CX.ActivityDetail) {
    if (!(activity.activeType === ActivityTypeEnum.Sign && activity.status === ActivityStatusEnum.Doing)) {
      return {
        activity,
        result: '不是签到活动或活动已结束',
      }
    }
    const result = await this.handleSign(course, activity)

    console.log(`课程: ${course.name} 签到结果: ${result}`)

    return {
      activity,
      result,
    }
  }

  /*
  * 一键签到 (检测所有课程, 所有签到活动, 比较耗时)
  */
  async oneClickSign(setting?: CX.Setting) {
    const signActivityList = await this.getAllActivity(ActivityTypeEnum.Sign, ActivityStatusEnum.Doing)

    const signResults: CX.SignResult[] = []
    for await (const a of signActivityList) {
      if (a.type === ActivityTypeEnum.Sign) {
        const activity = await this.getActivityDetail(a.id)
        const result = await this.handleSign(a.course, activity, setting)

        // 如果已签到过, 则不返回
        if (result === '已签到过')
          continue

        signResults.push({
          activity: {
            ...a,
            ...activity,
          },
          signType: activity.otherId,
          result,
        })
      }
    }
    return signResults
  }

  async handleSign(course: CX.Course, activity: CX.ActivityDetail, setting?: CX.Setting) {
    const status = await this.preSign(course, activity)

    if (status === '签到成功')
      return '已签到过'

    if (setting?.signType && !setting?.signType?.map(type => Number(type))?.includes(activity.otherId))
      return '该账号不支持此签到类型'

    switch (Number(activity.otherId)) {
      case SignTypeEnum.Normal:
        if (activity.ifPhoto === 1)
          return PHOTO_SIGN_REQUIRED

        return await this.signNormal(activity)

      case SignTypeEnum.Gesture:
        return '已跳过：手势图案只能在课堂现场看到'

      case SignTypeEnum.Code:
        return '已跳过：签到码只能在课堂现场看到'

      case SignTypeEnum.Location:
        return '已跳过：位置签到不代填定位坐标'

      case SignTypeEnum.QRCode:
        return '已跳过：二维码签到需要现场扫码'

      default:
        return '未知签到类型'
    }
  }

  async getWebIM() {
    const { body: html } = await this.http.get('https://im.chaoxing.com/webim/me', {
      responseType: 'text',
    })

    const $ = cheerio.load(html)

    const token = $('#myToken').text()
    const status = token ? 'ok' : String(html).includes('系统维护中') ? 'maintenance' : 'unexpected'
    if (!token)
      console.log(`[网页IM] /webim/me 未下发 token（${status}），响应 ${String(html).length} 字节`)

    return {
      token,
      status,
      uid: $('#myTuid').text(),
      name: $('#myName').text(),
    }
  }

  /**
   * 网页版学习通聊天需要手机扫码激活一次，激活后 /webim/me 才会下发环信 token。
   * 未激活时 /webim/me 只返回"系统维护中"的提示页。
   */
  async getIMLoginSession() {
    const { body: html } = await this.http.get('https://im.chaoxing.com/webim/login', {
      responseType: 'text',
    })

    const id = html.match(/var id="([0-9a-fA-F]{16,})"/)?.[1]
      ?? html.match(/\/webim\/login\/([0-9a-fA-F]{16,})/)?.[1]

    if (!id)
      return null

    return {
      id,
      // 二维码内容与官方页面一致：location.protocol + '//' + location.host + '/webim/loginConfirm/' + id
      // 注意是 loginConfirm 不是 login，拼错路径扫码后手机端不会有任何反应
      qrText: `https://im.chaoxing.com/webim/loginConfirm/${id}`,
    }
  }

  async checkIMLogin(id: string) {
    const { body } = await this.http.post<{ code?: string, data?: { name?: string, schoolname?: string } }>(
      `https://im.chaoxing.com/webim/login?id=${id}&${Date.now()}`,
    )

    return body
  }
}

export const CXMap = new Map<string | number, Cx>()

export const getCx = (uid: string | number) => CXMap.get(uid)

export const setCx = (uid: string | number, cx: Cx) => CXMap.set(uid, cx)
