import { createDiscreteApi } from 'naive-ui'

type DiscreteMessage = ReturnType<typeof createDiscreteApi>['message']

let messageApi: DiscreteMessage | undefined

// createDiscreteApi 会创建临时 Vue 应用,只能在客户端运行,SSR 期间调用会抛错导致整页 hydration 失败
export function useDiscreteMessage(): DiscreteMessage | undefined {
  if (import.meta.server)
    return undefined

  if (!messageApi)
    messageApi = createDiscreteApi(['message']).message

  return messageApi
}
