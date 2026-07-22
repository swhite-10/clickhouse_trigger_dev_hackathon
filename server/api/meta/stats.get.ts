// App telemetry, served from Postgres — the OLTP half of the pairing.
// Every panel is shaped exactly like a chat tool output so the frontend
// renders it through the same ToolChart component the agent's answers use.

type Panel = {
  rows: Record<string, unknown>[]
  durationMs: number
  source: string
  chart: { type: string; x: string; y: string; series?: string; title: string }
}

function stat(title: string, value: number, ms: number): Panel {
  return {
    rows: [{ v: value }],
    durationMs: ms,
    source: 'Postgres',
    chart: { type: 'stat', x: 'v', y: 'v', title },
  }
}

export default defineEventHandler(async () => {
  const db = pgPool()
  if (!db) return { enabled: false as const }

  async function run(sql: string): Promise<{ rows: Record<string, unknown>[]; ms: number }> {
    const t0 = Date.now()
    const res = await db!.query(sql)
    return { rows: res.rows, ms: Date.now() - t0 }
  }

  const [totals, queries, mix, latency, perDay, recent, shape] = await Promise.all([
    run(`SELECT count(*)::int AS sessions,
                coalesce(sum(turns), 0)::int AS turns,
                coalesce(sum(input_tokens + output_tokens), 0)::bigint AS tokens
         FROM chat_sessions`),
    run(`SELECT count(*)::int AS total,
                count(*) FILTER (WHERE error IS NOT NULL)::int AS errors,
                coalesce(round(avg(duration_ms) FILTER (WHERE error IS NULL)), 0)::int AS avg_ms
         FROM chat_queries`),
    run(`SELECT coalesce(chart_type, '(none)') AS kind, count(*)::int AS n
         FROM chat_queries WHERE error IS NULL
         GROUP BY 1 ORDER BY 2 DESC`),
    run(`SELECT coalesce(chart_type, '(none)') AS kind, round(avg(duration_ms))::int AS avg_ms
         FROM chat_queries WHERE error IS NULL AND duration_ms IS NOT NULL
         GROUP BY 1 ORDER BY 2 DESC`),
    run(`SELECT to_char(date_trunc('day', created_at), 'Mon DD') AS day, count(*)::int AS queries
         FROM chat_queries
         GROUP BY date_trunc('day', created_at), 1
         ORDER BY date_trunc('day', created_at)`),
    run(`SELECT to_char(created_at, 'HH24:MI') AS at,
                tool,
                coalesce(chart_type, '—') AS chart,
                coalesce(row_count, 0)::int AS "rows",
                coalesce(duration_ms, 0)::int AS ms,
                coalesce(error, '') AS error,
                coalesce(sql, '') AS sql
         FROM chat_queries
         ORDER BY created_at DESC LIMIT 12`),
    run(`SELECT coalesce(row_count, 0)::int AS "rows",
                duration_ms::int AS ms,
                tool
         FROM chat_queries
         WHERE error IS NULL AND duration_ms IS NOT NULL`),
  ])

  const t = totals.rows[0] as { sessions: number; turns: number; tokens: string | number }
  const q = queries.rows[0] as { total: number; errors: number; avg_ms: number }
  const errorRate = q.total ? Math.round((q.errors / q.total) * 100) : 0

  return {
    enabled: true as const,
    stats: [
      stat('Chat sessions', t.sessions, totals.ms),
      stat('Turns captured', t.turns, totals.ms),
      stat('ClickHouse queries run', q.total, queries.ms),
      stat('Avg ClickHouse latency (ms)', q.avg_ms, queries.ms),
      stat('SQL error rate (%)', errorRate, queries.ms),
      stat('LLM tokens', Number(t.tokens), totals.ms),
    ],
    panels: [
      {
        rows: mix.rows,
        durationMs: mix.ms,
        source: 'Postgres',
        chart: { type: 'bar', x: 'kind', y: 'n', title: 'Chart types the agent picked' },
      },
      {
        rows: latency.rows,
        durationMs: latency.ms,
        source: 'Postgres',
        chart: { type: 'bar', x: 'kind', y: 'avg_ms', title: 'Avg ClickHouse latency by chart type (ms)' },
      },
      {
        rows: perDay.rows,
        durationMs: perDay.ms,
        source: 'Postgres',
        chart: { type: 'bar', x: 'day', y: 'queries', title: 'Queries per day' },
      },
      {
        rows: shape.rows,
        durationMs: shape.ms,
        source: 'Postgres',
        chart: { type: 'scatter', x: 'rows', y: 'ms', series: 'tool', title: 'Rows returned vs ClickHouse latency' },
      },
    ] as Panel[],
    recent: { rows: recent.rows, durationMs: recent.ms },
  }
})
