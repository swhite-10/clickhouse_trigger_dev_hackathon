# gh-pulse

Ask questions about GitHub activity in natural language — get charts, not
paragraphs. A chat agent that writes ClickHouse SQL against 11B+ GitHub
events and answers with interactive visualisations.

Built for the ClickHouse + Trigger.dev Virtual Summer Hackathon
("Beyond the Wall of Text", July 2026).

## Stack

- **Nuxt 4 + Apache ECharts** (via the thin `vue-echarts` wrapper) — the visual
  layer is the product; ECharts was chosen over Nuxt-specific chart kits for
  its deeper catalog (calendar heatmaps, sankey, treemap, …)
- **ClickHouse Cloud** — `github_events` (OLAP, primary database)
- **Trigger.dev `chat.agent()`** — the conversational agent runtime
- **Postgres** — OLTP for the app itself: sessions, messages, rendered charts
- **Langfuse** — agent observability (itself powered by ClickHouse)

## How it works

The agent answers every question by writing ClickHouse SQL plus a chart
descriptor `{type, x, y, series?, value?, title}` naming the columns to plot.
Guardrails wrap the SQL before it runs (single read-only SELECT, table
allowlist, keyword blocklist, LIMIT injection); query errors flow back to the
agent, which fixes its SQL and retries. The frontend validates the descriptor
against the actual result shape and renders it with ECharts — eleven panel
types (bar, line, area, scatter, heatmap, calendar, pie, treemap, sankey,
radar, stat cards) with a table fallback — alongside the query itself,
disclosable under every chart.

Broad questions ("what can you tell me about repo X?") go through
`run_dashboard`: the agent composes 6–8 panels — headline stat cards plus a
mix of chart types — and every query runs against ClickHouse in parallel, so
a full dashboard lands in roughly the time of its slowest query.

Every completed turn is captured to Postgres (the OLTP side of the pairing):
session rollups, full messages — so past charts re-render without re-querying
ClickHouse — and one row per executed query with its SQL, chart descriptor,
row count, and ClickHouse latency. The app's own telemetry is queryable
(`infra/pg/schema.sql`). Capture is fail-open: it never blocks a chat turn,
and without a `DATABASE_URL` it simply switches off.

## Running locally

Secrets never touch disk — the [1Password CLI](https://developer.1password.com/docs/cli/)
resolves `op://` references from `infra/env/.env.template` at runtime.

```bash
make install            # npm install
make secrets-bootstrap  # one-time: creates the gh-pulse vault + placeholder items
# paste real values (Trigger.dev keys, Anthropic key) — see the template header
make secrets-check      # verify every reference resolves

make trigger-dev        # terminal 1: the chat agent
make dev                # terminal 2: Nuxt on localhost:3000
```

*Work in progress — build window 17–23 July 2026.*
