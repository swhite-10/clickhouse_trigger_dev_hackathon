import { chat } from '@trigger.dev/sdk/ai'
import { streamText, stepCountIs, tool } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import { createClient } from '@clickhouse/client'
import { guardSql, MAX_ROWS } from './sql-guard'

// Defaults to the public playground so the loop works before Cloud creds land.
const clickhouse = createClient({
  url: process.env.CLICKHOUSE_URL ?? 'https://play.clickhouse.com',
  username: process.env.CLICKHOUSE_USER ?? 'play',
  password: process.env.CLICKHOUSE_PASSWORD ?? '',
})

const chartSchema = z.object({
  type: z
    .enum(['bar', 'line', 'area', 'scatter', 'heatmap', 'calendar', 'pie', 'treemap', 'sankey', 'table'])
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

export const tools = {
  run_sql: tool({
    description:
      'Run a read-only ClickHouse SQL query you wrote against the github_events dataset and render the result as a chart. Follow the schema notes and SQL rules in the system prompt. This is the primary way to answer questions.',
    inputSchema: z.object({
      sql: z.string().describe('A single ClickHouse SELECT statement'),
      chart: chartSchema,
    }),
    execute: async ({ sql, chart }) => {
      const guarded = guardSql(sql)
      if (!guarded.ok) return { error: `query rejected: ${guarded.reason}`, sql }
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
        return { error: err instanceof Error ? err.message : String(err), sql: guarded.sql }
      }
    },
  }),

  trending_repos: tool({
    description:
      'Curated shortcut: top GitHub repositories by stars gained in a recent time window. Use for plain "what is trending in the last N hours" questions INSTEAD of run_sql — never call both for the same data.',
    inputSchema: z.object({
      hours: z.number().int().min(1).max(168).describe('Look-back window in hours'),
      limit: z.number().int().min(1).max(50).describe('How many repos to return'),
    }),
    execute: async ({ hours, limit }) => {
      const started = Date.now()
      const result = await clickhouse.query({
        query: `
          SELECT repo_name, count() AS stars
          FROM github_events
          WHERE event_type = 'WatchEvent'
            AND created_at > now() - INTERVAL {hours:UInt32} HOUR
          GROUP BY repo_name
          ORDER BY stars DESC
          LIMIT {limit:UInt32}
        `,
        query_params: { hours, limit },
        format: 'JSONEachRow',
      })
      const rows = await result.json<{ repo_name: string; stars: string }>()
      return {
        rows: rows.map((r) => ({ repo: r.repo_name, stars: Number(r.stars) })),
        durationMs: Date.now() - started,
        chart: { type: 'bar', x: 'repo', y: 'stars', title: `Stars gained, last ${hours}h` },
      }
    },
  }),
}

const SYSTEM_PROMPT = `
You are gh-pulse, a GitHub activity analyst backed by ClickHouse (github_events, ~11 billion rows).
Every successful tool result — run_sql and trending_repos alike — is automatically rendered as an interactive chart in the UI. You never need to plot, format, or restate the data yourself.
Therefore: make ONE tool call per question unless it genuinely needs several different queries, then add at most one or two sentences of insight. NEVER repeat tool data as text or a markdown table, and NEVER call run_sql to re-chart data another tool already returned — the chart is already on screen.

## github_events essentials
- Sort key is (event_type, repo_name, created_at). ALWAYS filter event_type with an exact match first; add repo_name when the question is repo-scoped. Never scan without an event_type filter.
- Key columns: event_type (WatchEvent = starring, ForkEvent, PullRequestEvent, IssuesEvent, PushEvent, IssueCommentEvent, PullRequestReviewCommentEvent, ReleaseEvent, CreateEvent), repo_name ('owner/name'), actor_login, created_at (DateTime), action ('opened', 'closed', 'reopened', ...), number, merged (UInt8), additions, deletions, changed_files, push_size, release_tag_name, title, labels (Array(String)), state, comments.
- Stars gained = count() of WatchEvent. PRs merged = event_type = 'PullRequestEvent' AND action = 'closed' AND merged = 1. Issues opened = event_type = 'IssuesEvent' AND action = 'opened'.
- Data density: ingest has decayed since 2025 — 2026 months are sparse. For trend/top-N questions default to a 2025 range (e.g. created_at >= '2025-01-01' AND created_at < '2025-07-01') unless the user explicitly wants recent data; say which window you used. Repo-scoped multi-year history is fine.

## SQL rules
- One SELECT statement, read-only. No SETTINGS, no FORMAT clause, no INSERT/DDL.
- Always add LIMIT (max ${MAX_ROWS}); one is injected if you forget.
- Give every selected column a short lowercase alias; the chart descriptor must reference those exact aliases.
- Time series: bucket with toDate() / toStartOfWeek() / toStartOfMonth() and ORDER BY the time column ascending.

## Charts
Pick the type that maximises insight per pixel — vary them; don't default everything to bar.
- bar: rankings / top-N. x = category alias, y = numeric alias, ORDER BY y DESC.
- line: trends over time. x = time alias, y = numeric alias; optional series = alias splitting into one line per value (keep to <= 6 distinct values).
- area: composition or volume over time — like line but filled; with a series alias the areas stack (e.g. event-type mix per month).
- scatter: relationship between two measures across entities (e.g. issues opened vs PRs merged per repo — use countIf() to compute both in one query). x and y are numeric aliases; optional series colours groups.
- heatmap: intensity across two categorical dimensions; requires x, y AND value (e.g. x = toHour(created_at) AS hour, y = toDayOfWeek(created_at) AS day, value = count() AS c). Perfect for "when is X most active" questions.
- calendar: GitHub-contribution-style daily calendar. x = toDate(created_at) AS d, y = count() AS c, one row per day, at most ~1 year of days. Perfect for "show activity over the year" on a repo or user.
- pie: share of a whole across <= 10 categories (e.g. event-type share for a repo). x = category alias, y = value alias.
- treemap: composition across many categories, optionally grouped (e.g. an org's activity by repo — series = a parent-group alias if there is a natural grouping). x = name alias, y = size alias.
- sankey: flows between two DIFFERENT sets of things; requires x = source alias, y = target alias, value = flow size (e.g. top contributors -> the repos they push to). Keep <= 12 nodes per side; source and target must be different kinds of entity.
- table: only when no chart fits.

If run_sql returns an error, fix the SQL and try again (max 3 attempts), then briefly explain what failed.
`.trim()

export const ghPulseChat = chat.agent({
  id: 'gh-pulse-chat',
  tools,
  run: async ({ messages, tools, signal }) =>
    streamText({
      ...chat.toStreamTextOptions({ tools }),
      model: anthropic('claude-opus-4-8'),
      system: SYSTEM_PROMPT,
      messages,
      abortSignal: signal,
      stopWhen: stepCountIs(10),
    }),
})
