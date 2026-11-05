export default defineEventHandler((event) => {
  return ResOp.success(getGroupSigns(event.context.cx.user.uid))
})
