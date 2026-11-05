<script setup lang="ts">
const props = defineProps<{
  show: boolean
  uid: string
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
  (e: 'success'): void
}>()

const ms = useMessage()

const loading = ref(false)
const qrDataUrl = ref('')
const sessionId = ref('')
const hint = ref('')
const state = ref<'idle' | 'waiting' | 'done' | 'failed'>('idle')

let timer: ReturnType<typeof setInterval> | null = null

function stopPolling() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

async function checkStatus() {
  try {
    const { data } = await request(`/api/cx/accounts/${props.uid}/im_login_check`, {
      method: 'POST',
      body: { uid: props.uid, id: sessionId.value },
      params: { noMessage: true },
    })

    if (!data?.activated)
      return

    stopPolling()

    if (data.imReady) {
      state.value = 'done'
      hint.value = '群聊推送监听已开启，轮询已自动关闭'
      ms.success('群聊监听已开启')
      emit('success')
    }
    else {
      state.value = 'failed'
      hint.value = '手机已确认，但聊天会话没有下发 token，继续用轮询兜底'
    }
  }
  catch {
    // 单次查询失败不打断轮询
  }
}

async function start() {
  stopPolling()
  loading.value = true
  state.value = 'idle'
  hint.value = '正在获取二维码…'

  try {
    const { data } = await request(`/api/cx/accounts/${props.uid}/im_login`, {
      method: 'GET',
      params: { uid: props.uid },
    })

    qrDataUrl.value = data?.qrDataUrl ?? ''
    sessionId.value = data?.id ?? ''
    state.value = 'waiting'
    hint.value = '用学习通 App 扫码，然后在手机上点“确认登录”'
    timer = setInterval(checkStatus, 3000)
  }
  catch (error: any) {
    state.value = 'failed'
    hint.value = error?.data?.message ?? error?.message ?? '获取二维码失败'
  }
  finally {
    loading.value = false
  }
}

function handleClose() {
  stopPolling()
}

// n-modal 的 after-enter 在首屏 hydration 期间不一定触发，直接盯 show
watch(() => props.show, (value) => {
  if (value)
    start()
  else
    stopPolling()
})

onUnmounted(stopPolling)
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    title="开启群聊推送监听"
    :bordered="false"
    :closable="true"
    :style="{ 'max-width': '380px' }"
    transform-origin="center"
    @update:show="emit('update:show', $event)"
    @after-leave="handleClose"
  >
    <n-space vertical align="center" :size="16">
      <n-spin :show="loading">
        <img
          v-if="qrDataUrl"
          :src="qrDataUrl"
          alt="学习通网页版聊天登录二维码"
          w-220px
          h-220px
        >
        <div v-else w-220px h-220px flex items-center justify-center bg-gray-100>
          {{ state === 'failed' ? '二维码获取失败' : '加载中…' }}
        </div>
      </n-spin>

      <p text-center text-sm :class="state === 'done' ? 'text-green-600' : 'text-gray'">
        {{ hint }}
      </p>

      <n-button v-if="state === 'failed' || state === 'done'" size="small" @click="start">
        重新获取二维码
      </n-button>
    </n-space>
  </n-modal>
</template>
