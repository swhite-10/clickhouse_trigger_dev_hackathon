// Chat history replay from the OLTP capture: chat_messages.parts holds the
// full UIMessage records — including tool outputs with chart data — so a
// refreshed page re-renders past turns without touching ClickHouse. Same
// trust model as the token endpoint: knowing the (unguessable) chatId is
// what grants access to a conversation.
export default defineEventHandler(async (event) => {
  const { chatId } = getQuery(event)
  if (!chatId || typeof chatId !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'chatId required' })
  }
  const db = pgPool()
  if (!db) return { messages: [] }
  const res = await db.query(
    `SELECT id, role, parts FROM chat_messages
     WHERE chat_id = $1
     ORDER BY turn, created_at`,
    [chatId],
  )
  return { messages: res.rows.map((r) => ({ id: r.id, role: r.role, parts: r.parts })) }
})
