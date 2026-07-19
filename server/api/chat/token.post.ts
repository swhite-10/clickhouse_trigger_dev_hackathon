import { auth } from '@trigger.dev/sdk'

export default defineEventHandler(async (event) => {
  const { chatId } = await readBody<{ chatId: string }>(event)
  if (!chatId) throw createError({ statusCode: 400, statusMessage: 'chatId required' })
  const token = await auth.createPublicToken({
    scopes: {
      read: { sessions: chatId },
      write: { sessions: chatId },
    },
    expirationTime: '1h',
  })
  return { token }
})
