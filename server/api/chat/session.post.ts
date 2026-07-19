import { chat } from '@trigger.dev/sdk/ai'

// Nuxt equivalent of the Next.js server action from the Trigger.dev quick start.
const startSession = chat.createStartSessionAction('gh-pulse-chat')

export default defineEventHandler(async (event) => {
  const { chatId, clientData } = await readBody<{ chatId: string; clientData?: Record<string, unknown> }>(event)
  if (!chatId) throw createError({ statusCode: 400, statusMessage: 'chatId required' })
  return startSession({ chatId, clientData })
})
