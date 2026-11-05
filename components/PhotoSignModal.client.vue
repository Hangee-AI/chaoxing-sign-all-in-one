<script setup lang="ts">
import { ActivityStatusEnum, ActivityTypeEnum } from '~/constants/cx'
import type { Course } from '~/types/account'

const props = defineProps<{
  show: boolean
  uid: string
  activity?: { id: number | string } | null
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
  (e: 'success', result: string): void
}>()

const MAX_SIZE = 10 * 1024 * 1024

const accountStore = useAccountStore()
const ms = useMessage()

const loadingList = ref(false)
const submitting = ref(false)
const options = ref<{ label: string, value: string }[]>([])
const selected = ref<string | null>(null)
const photo = ref<File | null>(null)
const linkInput = ref('')
const resolving = ref(false)

const picked = new Map<string, { courseId: string, activityId: string, chatId: string }>()

function addManualOption(activityId: string, label: string, chatId = '') {
  const value = chatId ? `${chatId}:${activityId}` : `:${activityId}`
  picked.set(value, { courseId: '', activityId, chatId })
  options.value.unshift({ label, value })
  selected.value = value
}

// 普通群（自建群/院系群/通知群）的签到不在课程活动列表里，网页版聊天又拿不到推送，
// 所以留出这条路：用户在手机上复制签到卡片链接，粘贴到这里由后端解析活动 id 和群 id。
async function resolveLink() {
  const text = linkInput.value.trim()
  if (!text)
    return ms.warning('先粘贴签到链接或填签到编号')

  resolving.value = true

  try {
    const { data } = await request(`/api/cx/accounts/${props.uid}/activity_detail`, {
      method: 'GET',
      params: { uid: props.uid, link: text, noMessage: true },
    }) as { data: any }

    if (data.group) {
      addManualOption(data.activityId, `[群签到] ${data.name ?? data.activityId}`, data.chatId)
      ms.success(`已识别群签到：${data.name ?? data.activityId}`)
      linkInput.value = ''
      return
    }

    const statusText = data.status === ActivityStatusEnum.Doing ? '' : data.status === ActivityStatusEnum.Done ? '（已结束）' : '（未开始）'
    addManualOption(data.activityId, `[链接] ${data.name ?? data.activityId}${statusText}`)
    ms.success(`已识别签到：${data.name ?? data.activityId}`)
    linkInput.value = ''
  }
  catch (error: any) {
    ms.error(error?.data?.message ?? '链接解析失败')
  }
  finally {
    resolving.value = false
  }
}

async function loadActivities() {
  loadingList.value = true
  picked.clear()
  options.value = []

  try {
    const { data: courses } = await request('/api/cx/courses', {
      method: 'GET',
      params: { uid: props.uid, noMessage: true },
    })

    // 串行拉取: 一次性并发十几门课会被学习通限流
    for (const course of (courses ?? []) as unknown as Course[]) {
      try {
        const { data: items } = await request(`/api/cx/courses/${course.courseId}/activities`, {
          method: 'POST',
          body: { uid: props.uid, course },
          params: { noMessage: true },
        })

        for (const item of (items ?? []) as CX.ActivityItem[]) {
          if (item.type !== ActivityTypeEnum.Sign || item.status !== ActivityStatusEnum.Doing)
            continue

          const value = `${course.courseId}:${item.id}`
          picked.set(value, { courseId: String(course.courseId), activityId: String(item.id) })
          options.value.push({
            label: `${course.name} | ${item.nameOne || item.name || '签到'}`,
            value,
          })
        }
      }
      catch {
        // 单门课拉取失败不影响其它课
      }
    }

    // 群消息推送发现的签到（普通群/院系群里的签到不在课程活动列表里）
    try {
      const { data: groupSigns } = await request(`/api/cx/accounts/${props.uid}/group_activities`, {
        method: 'GET',
        params: { uid: props.uid, noMessage: true },
      })

      for (const item of (groupSigns ?? []) as { activityId: string, title: string, groupName: string, chatId?: string }[]) {
        const value = `:${item.activityId}`
        if (picked.has(value))
          continue

        picked.set(value, { courseId: '', activityId: item.activityId, chatId: item.chatId ?? '' })
        options.value.unshift({
          label: `[群聊] ${item.groupName} | ${item.title}`,
          value,
        })
      }
    }
    catch {
      // 群收件箱拉取失败不影响课程侧列表
    }

    if (props.activity) {
      const suffix = `:${props.activity.id}`
      selected.value = options.value.find(o => o.value.endsWith(suffix))?.value ?? options.value[0]?.value ?? null
    }
    else {
      selected.value = options.value[0]?.value ?? null
    }

    if (options.value.length === 0)
      ms.warning('当前没有进行中的签到活动')
  }
  catch (error: any) {
    ms.error(error?.data?.message ?? '课程列表获取失败')
  }
  finally {
    loadingList.value = false
  }
}

function handleFileChange({ file }: { file: { file: File | null } }) {
  if (!file.file) {
    photo.value = null
    return
  }

  if (file.file.size > MAX_SIZE) {
    photo.value = null
    ms.error('照片超过 10MB，请换一张小一点的')
    return
  }

  photo.value = file.file
}

async function handleSubmit() {
  const target = selected.value ? picked.get(selected.value) : undefined

  if (!target)
    return ms.warning('请选择要签到的活动')

  if (!photo.value)
    return ms.warning('请选择一张照片')

  submitting.value = true

  try {
    const data = await accountStore.signByPhoto(props.uid, target.courseId, target.activityId, photo.value, target.chatId)
    const result = data?.result ?? '签到失败'

    if (result === '签到成功') {
      ms.success(result)
      emit('update:show', false)
    }
    else {
      ms.warning(result)
    }

    emit('success', result)
  }
  finally {
    submitting.value = false
  }
}

// n-modal 的 after-enter 在首屏 hydration 期间不一定触发，直接盯 show
watch(() => props.show, (value) => {
  if (value)
    loadActivities()
})
</script>

<template>
  <n-modal
    :show="show"
    :mask-closable="false"
    preset="card"
    title="拍照签到"
    :bordered="false"
    :closable="true"
    :style="{ 'max-width': '420px' }"
    transform-origin="center"
    @update:show="emit('update:show', $event)"
  >
    <n-space vertical :size="16">
      <div>
        <p mb-2 text-sm text-gray>
          选择进行中的签到活动
        </p>
        <n-select
          v-model:value="selected"
          :options="options"
          :loading="loadingList"
          placeholder="暂无进行中的签到"
        />
      </div>

      <div>
        <p mb-2 text-sm text-gray>
          普通群（自建群/院系群/通知群）里的签到：在手机上长按签到卡片复制链接，粘贴到这里
        </p>
        <n-input-group>
          <n-input
            v-model:value="linkInput"
            placeholder="粘贴签到链接或直接填签到编号"
            @keyup.enter="resolveLink"
          />
          <n-button :loading="resolving" @click="resolveLink">
            识别
          </n-button>
        </n-input-group>
      </div>

      <div>
        <p mb-2 text-sm text-gray>
          上传一张现场照片（照片会先传到你自己账号的学习通云盘）
        </p>
        <n-upload
          list-type="image-card"
          accept="image/*"
          :max="1"
          @change="handleFileChange"
        >
          选择照片
        </n-upload>
      </div>

      <n-button type="primary" block :loading="submitting" @click="handleSubmit">
        上传并签到
      </n-button>
    </n-space>
  </n-modal>
</template>
