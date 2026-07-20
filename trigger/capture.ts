import { Pool } from 'pg'
import type { TurnCompleteEvent } from '@trigger.dev/sdk/ai'

// OLTP capture: every completed turn lands in Postgres — the session rollup,
// the full UI messages (charts re-render from `parts` without re-querying
// ClickHouse), and one chat_queries row per executed query. Fail-open by
// design: no DATABASE_URL disables capture entirely, and a Postgres error
// must never break a chat turn.

let pool: Pool | undefined

function getPool(): Pool | undefined {
  const url = process.env.DATABASE_URL
  if (!url) return undefined
  pool ??= new Pool({
    connectionString: url,
    max: 3,
    // Cloud Postgres requires TLS; the local Docker instance doesn't speak it.
    ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
  })
  return pool
}

type ToolOutput = {
  rows?: unknown[]
  durationMs?: number
  sql?: string
  chart?: unknown
  error?: string
  panels?: ToolOutput[]
}

type QueryRow = {
  tool: string
  panelIndex: number | null
  sql: string | null
  chart: unknown
  rowCount: number | null
  durationMs: number | null
  error: string | null
}

function toQueryRow(tool: string, panelIndex: number | null, output: ToolOutput): QueryRow {
  return {
    tool,
    panelIndex,
    sql: output.sql ?? null,
    chart: output.chart ?? null,
    rowCount: Array.isArray(output.rows) ? output.rows.length : null,
    durationMs: output.durationMs ?? null,
    error: output.error ?? null,
  }
}

function queriesFromParts(parts: unknown[]): QueryRow[] {
  const out: QueryRow[] = []
  for (const raw of parts) {
    const part = raw as { type?: string; state?: string; output?: ToolOutput; errorText?: string }
    if (!part.type?.startsWith('tool-')) continue
    const tool = part.type.slice('tool-'.length)
    if (part.state === 'output-error') {
      out.push({ tool, panelIndex: null, sql: null, chart: null, rowCount: null, durationMs: null, error: part.errorText ?? 'unknown error' })
      continue
    }
    if (part.state !== 'output-available' || !part.output) continue
    if (tool === 'run_dashboard' && Array.isArray(part.output.panels)) {
      part.output.panels.forEach((panel, i) => out.push(toQueryRow(tool, i, panel)))
    } else {
      out.push(toQueryRow(tool, null, part.output))
    }
  }
  return out
}

export async function captureTurn(event: TurnCompleteEvent): Promise<void> {
  const db = getPool()
  if (!db) return
  try {
    const usage = event.usage
    await db.query(
      `INSERT INTO chat_sessions (chat_id, turns, input_tokens, output_tokens)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (chat_id) DO UPDATE SET
         last_turn_at  = now(),
         turns         = GREATEST(chat_sessions.turns, EXCLUDED.turns),
         input_tokens  = chat_sessions.input_tokens + EXCLUDED.input_tokens,
         output_tokens = chat_sessions.output_tokens + EXCLUDED.output_tokens`,
      [event.chatId, event.turn + 1, usage?.inputTokens ?? 0, usage?.outputTokens ?? 0],
    )

    for (const message of event.newUIMessages) {
      const isAssistant = message.role === 'assistant'
      await db.query(
        `INSERT INTO chat_messages (id, chat_id, turn, role, parts, usage, finish_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           parts = EXCLUDED.parts, usage = EXCLUDED.usage, finish_reason = EXCLUDED.finish_reason`,
        [
          message.id,
          event.chatId,
          event.turn,
          message.role,
          JSON.stringify(message.parts),
          isAssistant && usage ? JSON.stringify(usage) : null,
          isAssistant ? event.finishReason ?? null : null,
        ],
      )

      if (!isAssistant) continue
      // Regenerated messages re-insert their queries; replace, don't append.
      await db.query('DELETE FROM chat_queries WHERE message_id = $1', [message.id])
      for (const q of queriesFromParts(message.parts)) {
        await db.query(
          `INSERT INTO chat_queries
             (chat_id, message_id, turn, tool, panel_index, sql, chart, row_count, duration_ms, error)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            event.chatId,
            message.id,
            event.turn,
            q.tool,
            q.panelIndex,
            q.sql,
            q.chart == null ? null : JSON.stringify(q.chart),
            q.rowCount,
            q.durationMs,
            q.error,
          ],
        )
      }
    }
  } catch (err) {
    console.error('[capture] turn not persisted:', err)
  }
}
