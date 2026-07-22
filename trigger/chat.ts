import { chat } from '@trigger.dev/sdk/ai'
import { streamText, stepCountIs, tool } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import { createClient } from '@clickhouse/client'
import { trace } from '@opentelemetry/api'
import type { ModelMessage } from 'ai'
import { guardSql, MAX_ROWS } from './sql-guard'
import { captureTurn } from './capture'

// Defaults to the public playground so the loop works before Cloud creds land.
const clickhouse = createClient({
  url: process.env.CLICKHOUSE_URL ?? 'https://play.clickhouse.com',
  username: process.env.CLICKHOUSE_USER ?? 'play',
  password: process.env.CLICKHOUSE_PASSWORD ?? '',
})

const chartSchema = z.object({
  type: z
    .enum(['bar', 'line', 'area', 'scatter', 'heatmap', 'calendar', 'pie', 'treemap', 'sankey', 'radar', 'stat', 'table'])
    .describe('see the Charts section of the system prompt for when to use each'),
  x: z
    .string()
    .describe('column alias for the category/time/x axis (sankey: source; calendar: date) — must exactly match a SELECT alias'),
  y: z
    .string()
    .describe('column alias for the numeric value axis (heatmap: y-axis category alias; sankey: target alias)'),
  series: z
    .string()
    .optional()
    .describe('line/area/scatter: alias splitting rows into one series per value; treemap: parent-group alias'),
  value: z
    .string()
    .optional()
    .describe('heatmap/sankey only: column alias holding the numeric cell/flow value'),
  title: z.string().describe('short human-readable chart title'),
})

const followupsSchema = z
  .array(z.string())
  .max(3)
  .optional()
  .describe(
    '2-3 short follow-up questions a curious user would ask next, phrased to be sent verbatim — rendered as clickable chips under your answer',
  )

type Panel = { sql: string; chart: z.infer<typeof chartSchema> }

async function executePanel({ sql, chart }: Panel) {
  const guarded = guardSql(sql)
  if (!guarded.ok) return { error: `query rejected: ${guarded.reason}`, sql, chart }
  const started = Date.now()
  try {
    const result = await clickhouse.query({
      query: guarded.sql,
      format: 'JSONEachRow',
      // No per-query settings: the playground's readonly user rejects them
      // (READONLY 164). On Cloud, limits move to the readonly role instead.
    })
    const raw = await result.json<Record<string, unknown>>()
    const rows = raw.slice(0, MAX_ROWS)
    return {
      rows,
      durationMs: Date.now() - started,
      sql: guarded.sql,
      chart,
      truncated: raw.length > rows.length,
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), sql: guarded.sql, chart }
  }
}

export const tools = {
  run_sql: tool({
    description:
      'Run a read-only ClickHouse SQL query you wrote against the github_events dataset and render the result as a chart. Follow the schema notes and SQL rules in the system prompt. This is the primary way to answer a specific question.',
    inputSchema: z.object({
      sql: z.string().describe('A single ClickHouse SELECT statement'),
      chart: chartSchema,
      followups: followupsSchema,
    }),
    execute: async ({ sql, chart, followups }) => ({
      ...(await executePanel({ sql, chart })),
      followups,
    }),
  }),

  run_dashboard: tool({
    description:
      'Run several read-only ClickHouse queries IN PARALLEL and render them together as one dashboard (grid of stat cards and charts). Use for broad or open-ended questions — "tell me about repo X", "overview of org Y" — following the Dashboards section of the system prompt.',
    inputSchema: z.object({
      title: z.string().describe('dashboard heading, e.g. "ClickHouse/ClickHouse — 2025 at a glance"'),
      panels: z.array(z.object({ sql: z.string(), chart: chartSchema })).min(2).max(8),
      followups: followupsSchema,
    }),
    execute: async ({ title, panels, followups }) => {
      const started = Date.now()
      const results = await Promise.all(panels.map(executePanel))
      return { title, panels: results, totalMs: Date.now() - started, followups }
    },
  }),

  trending_repos: tool({
    description:
      'Curated shortcut: top GitHub repositories by stars gained in a recent time window. Use for plain "what is trending in the last N hours" questions INSTEAD of run_sql — never call both for the same data.',
    inputSchema: z.object({
      hours: z.number().int().min(1).max(168).describe('Look-back window in hours'),
      limit: z.number().int().min(1).max(50).describe('How many repos to return'),
      followups: followupsSchema,
    }),
    execute: async ({ hours, limit, followups }) => {
      const started = Date.now()
      // Parameters inlined (they're validated ints) so the exact statement
      // lands in the SQL disclosure and the Postgres capture like the
      // agent-written queries do.
      const sql = `SELECT repo_name, count() AS stars
FROM github_events
WHERE event_type = 'WatchEvent'
  AND created_at > now() - INTERVAL ${hours} HOUR
GROUP BY repo_name
ORDER BY stars DESC
LIMIT ${limit}`
      const result = await clickhouse.query({ query: sql, format: 'JSONEachRow' })
      const rows = await result.json<{ repo_name: string; stars: string }>()
      return {
        rows: rows.map((r) => ({ repo: r.repo_name, stars: Number(r.stars) })),
        durationMs: Date.now() - started,
        sql,
        chart: { type: 'bar', x: 'repo', y: 'stars', title: `Stars gained, last ${hours}h` },
        followups,
      }
    },
  }),
}

const SYSTEM_PROMPT = `
You are gh-pulse, a GitHub activity analyst backed by ClickHouse (github_events, ~11 billion rows).
Every successful tool result — run_sql, run_dashboard and trending_repos alike — is automatically rendered as interactive charts in the UI. You never need to plot, format, or restate the data yourself.
Therefore: make ONE tool call per question, then add at most one or two sentences of insight. Specific question -> run_sql (or trending_repos when it fits exactly). Broad or open-ended question ("tell me about X", "overview of Y", "how healthy is Z") -> run_dashboard, still a single call. NEVER repeat tool data as text or a markdown table, and NEVER re-chart data another tool already returned — the chart is already on screen.

## github_events essentials
- Sort key is (event_type, repo_name, created_at). ALWAYS filter event_type with an exact match first; add repo_name when the question is repo-scoped. Never scan without an event_type filter.
- Key columns: event_type (WatchEvent = starring, ForkEvent, PullRequestEvent, IssuesEvent, PushEvent, IssueCommentEvent, PullRequestReviewCommentEvent, ReleaseEvent, CreateEvent), repo_name ('owner/name'), actor_login, created_at (DateTime), action ('opened', 'closed', 'reopened', ...), number, merged_at (DateTime; 1970 epoch when unset), additions, deletions, changed_files, push_size, release_tag_name, title, labels (Array(String)), state, comments.
- Stars gained = count() of WatchEvent. PRs merged = event_type = 'PullRequestEvent' AND action = 'closed' AND merged_at > '1971-01-01' (do NOT use the boolean merged column — it is unpopulated after 2023). Issues opened = event_type = 'IssuesEvent' AND action = 'opened'.
- Bots are loud: for "top contributors" style questions exclude them with actor_login NOT LIKE '%[bot]%' AND actor_login NOT LIKE 'robot-%' unless the user asks about bots.
- Data coverage (seeded subset, not the full GH Archive). CURATED orgs/repos have FULL history, every event_type — multi-year trends and deep-dives are safe here: the ClickHouse, duckdb, vuejs, kubernetes, rust-lang, pytorch, grafana, huggingface, openai, langchain-ai, sveltejs, anthropics and ggerganov/ggml-org orgs, plus facebook/react, microsoft/vscode, triggerdotdev/trigger.dev, apache/spark, nodejs/node, python/cpython, golang/go, angular/angular, vercel/next.js, torvalds/linux, microsoft/TypeScript, ollama/ollama and postgres/postgres. Every OTHER repo has EVERY event type but only the last 30 days. For global/cross-repo questions (not scoped to curated repos), scope to created_at >= now() - INTERVAL 30 DAY and say so — global data older than that is empty, not just sparse.
- Source quirks: facebook/react events end ~June 2026 (upstream stops there — treat it as historical, don't present the drop as real); org renames mean ClickHouse/* starts Sep 2019 and microsoft/vscode May 2019 under those exact names.

## Metric recipes
Use these exact patterns — they answer the questions users most often get wrong:
- Time to merge: group PullRequestEvent rows by number in a subquery, then aggregate:
  SELECT m, round(quantile(0.5)(hours), 1) AS median_hours FROM (SELECT number, toStartOfMonth(min(created_at)) AS m, dateDiff('hour', min(created_at), max(merged_at)) AS hours FROM github_events WHERE event_type = 'PullRequestEvent' AND repo_name = 'X' GROUP BY number HAVING max(merged_at) > '1971-01-01') GROUP BY m ORDER BY m
- New contributors per month: first-seen date per actor in a subquery — SELECT toStartOfMonth(first_seen) AS m, count() AS new_contributors FROM (SELECT actor_login, min(created_at) AS first_seen FROM github_events WHERE repo_name = 'X' AND event_type IN ('PullRequestEvent', 'PushEvent', 'IssuesEvent') AND actor_login NOT LIKE '%[bot]%' GROUP BY actor_login) GROUP BY m ORDER BY m
- Community mix (core team vs external): author_association on action = 'opened' rows of PullRequestEvent or IssuesEvent — MEMBER/OWNER/COLLABORATOR are core, CONTRIBUTOR/NONE are external. Great as a pie, a monthly area to show a community growing, or a stacked bar comparing repos (GROUP BY repo, who). CAVEAT: the field is only populated through 2025 (all NONE from 2026) — always window these queries to created_at < '2026-01-01'.
- Hottest issues: count() of IssueCommentEvent grouped by number with any(title) AS title over a recent window, ORDER BY count DESC — chart x = title.
- PR size distribution: on action = 'opened' PullRequestEvent rows, bucket additions + deletions with multiIf(s < 10, 'XS', s < 100, 'S', s < 1000, 'M', 'XL') — order buckets explicitly, not alphabetically.
- Rising repos: compare two windows in one pass with countIf(created_at > now() - INTERVAL 7 DAY) vs countIf(created_at BETWEEN now() - INTERVAL 14 DAY AND now() - INTERVAL 7 DAY), rank by growth; require a floor (older window >= 10) to kill noise.
- Opened vs closed (issues or PRs) over time: group by a kind column to get one series per action — SELECT toStartOfMonth(created_at) AS m, action AS kind, count() AS c FROM github_events WHERE event_type = 'IssuesEvent' AND repo_name = 'X' AND action IN ('opened', 'closed') GROUP BY m, kind ORDER BY m — chart line/area with x = m, y = c, series = kind.
- Release cadence: ReleaseEvent per month (line), or recent releases as a table of release_tag_name + created_at.

## SQL rules
- One SELECT statement, read-only. No SETTINGS, no FORMAT clause, no INSERT/DDL.
- Always add LIMIT (max ${MAX_ROWS}); one is injected if you forget.
- Give every selected column a short lowercase alias; the chart descriptor must reference those exact aliases.
- Time series: bucket with toDate() / toStartOfWeek() / toStartOfMonth() and ORDER BY the time column ascending.

## Charts
Pick the type that maximises insight per pixel — vary them; don't default everything to bar.
- bar: rankings / top-N. x = category alias, y = numeric alias, ORDER BY y DESC. Optional series = alias that splits each bar into stacked segments — use for composition ACROSS categories (e.g. PR author_association mix per repo: GROUP BY repo, who; keep <= 6 distinct series values).
- line: trends over time. x = time alias, y = numeric alias; optional series = alias splitting into one line per value (keep to <= 6 distinct values).
- area: composition or volume over time — like line but filled; with a series alias the areas stack (e.g. event-type mix per month).
- scatter: relationship between two measures across entities (e.g. issues opened vs PRs merged per repo — use countIf() to compute both in one query). x and y are numeric aliases; optional series colours groups.
- heatmap: intensity across two categorical dimensions; requires x, y AND value (e.g. x = toHour(created_at) AS hour, y = toDayOfWeek(created_at) AS day, value = count() AS c). Perfect for "when is X most active" questions.
- calendar: GitHub-contribution-style daily calendar. x = toDate(created_at) AS d, y = count() AS c, one row per day, at most ~1 year of days. Perfect for "show activity over the year" on a repo or user.
- pie: share of a whole across <= 10 categories (e.g. event-type share for a repo). x = category alias, y = value alias.
- treemap: composition across many categories, optionally grouped (e.g. an org's activity by repo — series = a parent-group alias if there is a natural grouping). x = name alias, y = size alias.
- sankey: flows between two DIFFERENT sets of things; requires x = source alias, y = target alias, value = flow size (e.g. top contributors -> the repos they push to). Keep <= 12 nodes per side; source and target must be different kinds of entity.
- radar: profile comparison of <= 4 entities across 3-6 measures. SELECT the entity alias plus one aliased countIf() per measure (one row per entity); x = entity alias, y = any one measure alias — every non-x column becomes an axis.
- stat: one headline number, mainly for dashboards. SELECT a single aliased value (one row); x = y = that alias; title is the card label, e.g. "Stars gained".
- table: only when no chart fits.

## Dashboards
run_dashboard runs every panel's query in parallel and renders a grid. Compose it like an analyst, 6-8 panels:
- Open with 3-4 stat cards: headline totals for the window (e.g. stars gained, PRs merged, unique contributors via uniq(actor_login), issues opened).
- Then 3-4 charts, each a DIFFERENT facet and a DIFFERENT type: e.g. line (monthly trend), heatmap (hour-of-day x day-of-week rhythm), bar (top contributors), pie (event mix), calendar (daily activity for one year).
- State the time window in the dashboard title; keep every panel on the same window unless a panel is explicitly historical.
- Keep panels small: stats 1 row, charts <= 30 rows (calendar excepted).
- If a panel comes back with an error, fix that SQL and re-run JUST that panel via run_sql.

## Follow-ups
Every tool call accepts a followups array: include 2-3 short, natural next questions a curious user would ask after seeing this chart — they render as clickable chips. Go DEEPER or SIDEWAYS (drill into one repo, switch dimension, compare with a rival, zoom the time window), never re-ask the same thing. Phrase each so it works sent verbatim with no other context. Remember data coverage: only suggest multi-year or niche-event questions for the curated full-history repos.

If run_sql returns an error, fix the SQL and try again (max 3 attempts), then briefly explain what failed.
`.trim()

const CACHE_BREAKPOINT = {
  anthropic: { cacheControl: { type: 'ephemeral' as const } },
}

// Trace enrichment for Langfuse: without this, traces list unnamed and
// ungrouped. Langfuse promotes `langfuse.*` attributes found on ANY span
// to trace-level properties — but NOT from the run's active span: a
// chat.agent run parks between turns, its root span never ends, and OTel
// only exports ended spans. So the attributes ride a zero-work child span
// that ends (and therefore exports) immediately.
// First message, not latest: trace-meta re-fires every turn and Langfuse
// keeps the last value it sees, so naming by the latest message left
// multi-turn traces titled after corrections ("Hmm please recompute...").
// The opening question names the conversation, like a chat thread title.
function firstUserText(messages: ModelMessage[]): string | undefined {
  const first = messages.find((m) => m.role === 'user')
  if (!first) return undefined
  const text =
    typeof first.content === 'string'
      ? first.content
      : first.content
          .map((part) => (part.type === 'text' ? part.text : ''))
          .join(' ')
  const trimmed = text.trim()
  if (!trimmed) return undefined
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed
}

export const ghPulseChat = chat.agent({
  id: 'gh-pulse-chat',
  tools,
  onTurnComplete: captureTurn,
  run: async ({ chatId, messages, tools, signal }) => {
    trace.getTracer('gh-pulse').startActiveSpan('trace-meta', (span) => {
      span.setAttributes({
        'langfuse.trace.name': firstUserText(messages) ?? 'gh-pulse chat turn',
        'langfuse.session.id': chatId,
      })
      span.end()
    })
    return streamText({
      ...chat.toStreamTextOptions({ tools }),
      model: anthropic('claude-opus-4-8'),
      // Opus writes the SQL (step 1, and any step following a failed query,
      // where it must diagnose and rewrite). Once the last step's tools all
      // succeeded, the remaining work is a 1-2 sentence wrap-up + follow-up
      // chips — Sonnet does that in roughly half the latency, which is ~25%
      // off every turn's wall time.
      prepareStep: ({ stepNumber, steps }) => {
        if (stepNumber === 0) return {}
        const last = steps[steps.length - 1]
        const failed = (last?.toolResults ?? []).some((r) => {
          const out = r.output as { error?: string; panels?: { error?: string }[] } | undefined
          return !!out?.error || (out?.panels ?? []).some((p) => p.error)
        })
        return failed ? {} : { model: anthropic('claude-sonnet-5') }
      },
      // Two prompt-cache breakpoints (Anthropic caches the prefix up to
      // each): `instructions` covers tools + system — the static prefix
      // every step of every chat shares — and the last incoming message
      // covers the conversation so far, so step 2 of a turn and every
      // later turn within the 5-minute TTL re-read it at 10% of input
      // price. The system prompt rides `instructions` in message form
      // (a plain string can't carry providerOptions, and AI SDK v7
      // rejects system messages inside `messages`).
      instructions: { role: 'system', content: SYSTEM_PROMPT, providerOptions: CACHE_BREAKPOINT },
      messages: messages.map((m, i) =>
        i === messages.length - 1 ? { ...m, providerOptions: CACHE_BREAKPOINT } : m,
      ),
      abortSignal: signal,
      stopWhen: stepCountIs(10),
    })
  },
})
