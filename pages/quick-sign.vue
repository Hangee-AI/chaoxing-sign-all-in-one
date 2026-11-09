<script setup lang="ts">
definePageMeta({
  auth: false,
  layout: false,
})

const route = useRoute()

// 手机浏览器（尤其华为/QQ 浏览器）经常强制深色，把这个页面钉死在浅色，避免文字发白看不清
useHead({
  meta: [{ name: 'color-scheme', content: 'light' }],
  style: [{ innerHTML: 'html,body{color-scheme:light;background:#f5f7fa;}' }],
})

const link = ref(String(route.query.link ?? ''))
const photo = ref<File | null>(null)
const preview = ref('')
const busy = ref(false)
const done = ref(false)
const failed = ref(false)
const result = ref('')

const parsed = computed(() => ({
  activityId: link.value.match(/(?:activePrimaryId|propertyId|activeId|aid)=(\d{6,})/i)?.[1] ?? '',
  chatId: link.value.match(/(?:chatId|chatid)=([^&#\s]+)/i)?.[1] ?? '',
}))

function onPick(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file)
    return
  photo.value = file
  if (preview.value)
    URL.revokeObjectURL(preview.value)
  preview.value = URL.createObjectURL(file)
  done.value = false
  failed.value = false
  result.value = ''
}

async function submit() {
  if (!link.value.trim()) {
    failed.value = true
    result.value = '先把签到链接粘贴进来'
    return
  }
  if (!photo.value) {
    failed.value = true
    result.value = '先点「选择照片」挑一张图'
    return
  }

  busy.value = true
  failed.value = false
  done.value = false
  result.value = ''

  try {
    const form = new FormData()
    form.append('link', link.value.trim())
    form.append('photo', photo.value, photo.value.name || 'photo.jpg')
    const res = await $fetch('/api/quick-sign', { method: 'POST', body: form }) as any
    result.value = res?.data?.result ?? '已提交'
    done.value = true
  }
  catch (error: any) {
    result.value = error?.data?.message ?? error?.message ?? '提交失败'
    failed.value = true
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="qs-page">
    <div class="qs-card">
      <h1>拍照签到</h1>
      <p class="qs-sub">
        链接抓到后自动填好，你只需要选照片、点签到。
      </p>

      <label class="qs-label">签到链接</label>
      <textarea v-model="link" class="qs-link" rows="3" placeholder="https://mobilelearn.chaoxing.com/sign/preSign?...&activeId=...&chatId=..." />
      <p v-if="parsed.activityId" class="qs-hint">
        已识别：活动 {{ parsed.activityId }} · 群 {{ parsed.chatId || '（无 chatId）' }}
      </p>
      <p v-else class="qs-hint qs-warn">
        还没认出来，链接里要有 activeId= 和 chatId=
      </p>

      <label class="qs-label">照片</label>
      <label class="qs-pick">
        <input type="file" accept="image/*" @change="onPick">
        <span>{{ photo ? photo.name : '选择照片（打开相册/文件）' }}</span>
      </label>
      <img v-if="preview" :src="preview" class="qs-preview" alt="预览">

      <button class="qs-btn" :disabled="busy" @click="submit">
        {{ busy ? '提交中…' : '提交签到' }}
      </button>

      <div v-if="result" class="qs-result" :class="{ ok: done && !failed, bad: failed }">
        {{ result }}
      </div>

      <p class="qs-foot">
        结果会同步记到数据库的签到记录里，并且学习通返回的原文会显示在上面的框里。
      </p>
    </div>
  </div>
</template>

<style scoped>
.qs-page {
  min-height: 100vh;
  display: flex;
  justify-content: center;
  padding: 20px 16px 40px;
  background: #f5f7fa;
  color: #1f2329;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
}
.qs-card {
  width: 100%;
  max-width: 560px;
  background: #fff;
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, .06);
  height: fit-content;
}
h1 {
  margin: 0 0 6px;
  font-size: 22px;
  font-weight: 600;
}
.qs-sub {
  margin: 0 0 18px;
  color: #6b7280;
  font-size: 13px;
}
.qs-label {
  display: block;
  margin: 16px 0 6px;
  font-size: 13px;
  color: #6b7280;
}
.qs-link {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 10px;
  font-size: 13px;
  line-height: 1.5;
  resize: vertical;
  background: #fafbfc;
  color: #1f2329;
}
.qs-hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: #059669;
}
.qs-warn {
  color: #d97706;
}
.qs-pick {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px dashed #cbd5e1;
  border-radius: 12px;
  padding: 18px 12px;
  color: #374151;
  font-size: 14px;
  cursor: pointer;
  background: #fafbfc;
}
.qs-pick input {
  display: none;
}
.qs-preview {
  display: block;
  width: 100%;
  max-height: 320px;
  object-fit: contain;
  margin-top: 12px;
  border-radius: 12px;
  border: 1px solid #eef0f3;
  background: #f5f7fa;
}
.qs-btn {
  width: 100%;
  margin-top: 18px;
  padding: 13px;
  border: 0;
  border-radius: 12px;
  background: #2563eb;
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
}
.qs-btn:disabled {
  background: #93b4f5;
  cursor: default;
}
.qs-result {
  margin-top: 14px;
  padding: 12px 14px;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 600;
  background: #f3f4f6;
  color: #374151;
  word-break: break-all;
}
.qs-result.ok {
  background: #ecfdf5;
  color: #047857;
}
.qs-result.bad {
  background: #fef2f2;
  color: #b91c1c;
}
.qs-foot {
  margin: 16px 0 0;
  font-size: 12px;
  color: #9ca3af;
  line-height: 1.6;
}
</style>
