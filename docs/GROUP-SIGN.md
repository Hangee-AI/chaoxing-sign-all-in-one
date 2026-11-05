# 普通群签到（自建群 / 院系群 / 纯通知群）

课程里的签到和群里的签到是**两套完全不同的接口**，编号体系也不通用。这份文档记录实测结论。

## 课程签到（上游已实现）

```
GET  https://mobilelearn.chaoxing.com/v2/apis/active/student/activelist   活动列表（必须带 courseId + classId）
GET  https://mobilelearn.chaoxing.com/newsign/preSign                     签到页
GET  https://mobilelearn.chaoxing.com/newsign/signDetail?activePrimaryId= 活动详情
POST https://mobilelearn.chaoxing.com/pptSign/stuSignajax                 提交
```

## 普通群签到（本仓库新增）

```
GET  https://mobilelearn.chaoxing.com/sign/preSign?courseId=null&classId=&activeId=<aid>&chatId=<群id>&general=0&ls=1&tid=&uid=&ut=s
     → 302
GET  https://mobilelearn.chaoxing.com/sign/preStuSign                     真正的签到页（HTML，aid 烤在 var acId="..." 里）
POST https://mobilelearn.chaoxing.com/sign/stuSignajax                    提交（form，不是 pptSign）
GET  https://mobilelearn.chaoxing.com/sign/signReceipt2                   签到回执
```

`stuSignajax` 的字段：

| 字段 | 值 |
| --- | --- |
| `activeId` | 签到 aid |
| `uid` | 学生 uid |
| `clientip` / `useragent` | 空串 |
| `latitude` / `longitude` | `-1`（不使用定位） |
| `fid` | 学校 fid |
| `objectId` | 照片上传后拿到的云盘 objectid |
| `photoResult` | `{"files":[{"name":"x.jpg","objectid":"...","type":"jpg"}]}` |

成功返回纯文本 `success`；重复提交返回 `您已签到过了`；过期返回 `success2`。

## 三个必须知道的坑

1. **群 aid 和课程 aid 不是同一套编号。** 把群签到里的 `activeId` 喂给 `newsign/signDetail`，它会返回一条毫不相干的旧课程活动（`name` 为空、`ifPhoto:0`），看起来"查到了"其实是错记录。群签到判活只能用 `sign/preStuSign` 页面：页面里 `#statuscontent` 有文字就是已结束/不可用，页面里找不到 `stuSignajax` 说明链接错或活动没了。
2. **群签到页不用 `<input type="file">`。** 它调原生 JSBridge：
   ```js
   jsBridge.postNotification('CLIENT_CHOOSE_IMAGE', { camare: '5', pubNetFlag: 1, uploadParams: { _from: 'mobilelearn' } })
   ```
   由 App 直接拉起相机，结果从 `CLIENT_CHOOSE_IMAGE_RESULT` 回调回来。所以在 HTML 里删 `capture="camera"` 是想让它弹相册——**完全无效**，页面上根本没有那个 input。本仓库的做法是绕过整个 WebView：照片从服务端传云盘拿 `objectId`，直接 POST `stuSignajax`。
3. **群的 `activeId` / `chatId` 没有任何 HTTP 列表接口能拿到。** 实测穷举过：`activelist` 传空 courseId/classId、`student/todolist`、`ea/active/studentActiveList`、`v2/apis/sign/student/list` 全 500；`getTaskTotal`、`getUnDoneTotal`、`visit/fgroupList`、`group/groupList`、`im.chaoxing.com/roster` 全 404；`courselistdata` 的 `courseType` 0~7 只有 `1` 有数据，且没有隐藏/归档的群课程。网页版 IM 在扫码确认之后仍然只返回"系统维护中"，拿不到环信 token。**群消息只通过环信长连接（socket）下发**，把手机全量流量抓一遍可以确认：冷启动 + 拉会话列表 + 翻 3 个群历史，HTTP 层只有 8 个推送/统计请求，没有任何消息接口。

结论：普通群签到必须**人工把链接交出来一次**。`capture-tool/` 就是为此存在的双击脚本。

## 抓包配方（一次性装证书，之后每次 20 秒）

```
capture-tool\chaoxing-grab-sign.bat        # 双击，或命令行运行
capture-tool\chaoxing-grab-sign.bat cert   # 首次：把 CA 推到手机 /sdcard/Download/
```

原理：`adb reverse tcp:8080 tcp:8080` + `adb shell settings put global http_proxy 127.0.0.1:8080`，让手机流量走 PC 上的 `mitmdump`，addon 只匹配 `/sign/preSign?…activeId=…&chatId=…` 这一条 URL。脚本无论成功还是超时都会撤销代理、杀掉 mitmdump。学习通 App **信任用户安装的 CA，没有证书校验**，所以证书装一次长期有效。

代理挂着的那段时间里手机 App 会报网络异常，顺序必须是"先装证书、再开代理、再点卡片"。

## 代码位置

- 协议：`server/protocol/cx/index.ts` 的 `groupSignParams() / groupSignPage() / preSignGroup() / signPhotoGroup()`
- 上传照片（群/课程通用）：`Cx.uploadPhotoToPan()` → `POST https://pan-yz.chaoxing.com/upload`，multipart 只要 `puid` + `_token` + `file`，两个值从账号自己的云盘首页 HTML 里抓；返回 `{result:true, objectId}`
- 提交：`server/api/cx/accounts/[uid]/sign_by_photo.post.ts`，multipart 里带 `chatId` 就走群分支
- 识别链接：`server/api/cx/accounts/[uid]/activity_detail.get.ts?link=…`，检测到 `chatId=` 就抓群签到页、返回 `{group:true, …}`
- UI：账号卡片上的相机图标 → `components/PhotoSignModal.client.vue`

## 边界

刻意不做的三件事：伪造 GPS 定位、注入人脸照片绕过人脸核验、替其他同学无限代签。
拍照签到必须是**用户手动选一张本地照片**再提交，后台轮询遇到"要求拍照"的签到只标记 `PHOTO_SIGN_REQUIRED` 并弹窗，绝不自动凑一张交上去。
