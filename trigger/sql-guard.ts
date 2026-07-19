// Guardrails for agent-written SQL. First line of defence only — the real
// enforcement is the readonly ClickHouse role the queries run under.

// 500 so a one-year daily calendar (365 rows) and multi-series time series fit.
export const MAX_ROWS = 500

const FORBIDDEN = [
  'insert',
  'alter',
  'drop',
  'truncate',
  'delete',
  'update',
  'create',
  'attach',
  'detach',
  'rename',
  'optimize',
  'grant',
  'revoke',
  'kill',
  'system',
  'set',
  'settings',
  'format',
  'outfile',
  'infile',
]

// Grows when more datasets land (e.g. github_repos_history).
const ALLOWED_TABLES = ['github_events']

export type GuardResult = { ok: true; sql: string } | { ok: false; reason: string }

export function guardSql(raw: string): GuardResult {
  // Comments stripped everywhere; string literals stripped only for the
  // keyword/structure checks so a WHERE clause mentioning 'DROP' can't trip us.
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .trim()
    .replace(/;\s*$/, '')
  const scannable = stripped.replace(/'(?:\\.|''|[^'\\])*'/g, "''")

  if (scannable.includes(';')) {
    return { ok: false, reason: 'multiple statements are not allowed' }
  }
  if (!/^(select|with)\b/i.test(scannable)) {
    return { ok: false, reason: 'only SELECT queries are allowed' }
  }
  for (const word of FORBIDDEN) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(scannable)) {
      return { ok: false, reason: `forbidden keyword: ${word.toUpperCase()}` }
    }
  }
  if (!ALLOWED_TABLES.some((t) => new RegExp(`\\b${t}\\b`, 'i').test(scannable))) {
    return {
      ok: false,
      reason: `query must read from one of: ${ALLOWED_TABLES.join(', ')}. Do not use run_sql to re-shape data you already have — tool results are charted automatically.`,
    }
  }

  // \blimit\b rather than `limit \d+` so LIMIT n BY / LIMIT with expressions
  // don't get a second (syntax-error) LIMIT appended; the tool also slices
  // results to MAX_ROWS as a backstop.
  const sql = /\blimit\b/i.test(scannable) ? stripped : `${stripped}\nLIMIT ${MAX_ROWS}`
  return { ok: true, sql }
}
