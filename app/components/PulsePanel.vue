<script setup lang="ts">
// The app dashboarding itself: every chat turn is captured to Postgres
// (sessions, messages, one row per executed ClickHouse query), and this view
// renders that telemetry through the same ToolChart component the agent's
// answers use. Nothing here touches ClickHouse — it's the OLTP half on show.
type Panel = {
  rows: Record<string, unknown>[]
  durationMs: number
  source?: string
  chart: { type: string; x: string; y: string; series?: string; title: string }
}
type RecentQuery = {
  at: string
  tool: string
  chart: string
  rows: number
  ms: number
  error: string
  sql: string
}
type Stats =
  | { enabled: false }
  | {
      enabled: true
      stats: Panel[]
      panels: Panel[]
      recent: { rows: RecentQuery[]; durationMs: number }
    }

const { data, status, error, refresh } = useFetch<Stats>('/api/meta/stats')

const empty = computed(
  () => data.value?.enabled === true && data.value.stats.every((s) => s.rows[0]?.v === 0),
)

// Collapsed summary line: the stored SQL keeps the agent's formatting for the
// expanded view, but the one-line preview reads better with it flattened.
const oneLine = (sql: string) => sql.replace(/\s+/g, ' ').trim()
</script>

<template>
  <div class="pulse">
    <div class="pulse-head">
      <div>
        <h2>App pulse</h2>
        <p class="blurb">
          Every chat turn lands in Postgres — the session rollup, the full messages, and one row
          per executed ClickHouse query. This page is served entirely from that OLTP side:
          Postgres answering questions about how the app has used ClickHouse.
        </p>
      </div>
      <button class="refresh" type="button" @click="refresh()">Refresh</button>
    </div>

    <p v-if="status === 'pending'" class="meta">Loading telemetry…</p>
    <p v-else-if="error" class="meta error">Couldn't load telemetry — {{ error.message }}</p>
    <p v-else-if="data && !data.enabled" class="meta">
      Chat capture is switched off (no DATABASE_URL) — nothing to show.
    </p>
    <p v-else-if="empty" class="meta">No turns captured yet — ask something first.</p>

    <template v-else-if="data && data.enabled">
      <div class="stats">
        <ToolChart v-for="(s, i) in data.stats" :key="i" :output="s" />
      </div>
      <div class="grid">
        <div v-for="(p, i) in data.panels" :key="i" class="card">
          <ToolChart :output="p" />
        </div>
      </div>

      <section class="card queries">
        <h3>Last {{ data.recent.rows.length }} queries</h3>
        <div v-for="(q, i) in data.recent.rows" :key="i" class="qrow" :class="{ failed: q.error }">
          <span class="q-at">{{ q.at }}</span>
          <span class="q-tool">{{ q.tool }}<template v-if="q.chart !== '—'"> · {{ q.chart }}</template></span>
          <span class="q-nums">{{ q.rows }} rows · {{ q.ms }}ms</span>
          <details class="q-sql">
            <summary>
              <code class="when-closed">{{ q.error ? `✗ ${oneLine(q.error)}` : oneLine(q.sql) || '(no SQL recorded)' }}</code>
              <span class="when-open">hide</span>
            </summary>
            <pre v-if="q.sql">{{ q.sql }}</pre>
            <p v-if="q.error" class="q-err">{{ q.error }}</p>
          </details>
        </div>
        <p class="foot">{{ data.recent.rows.length }} rows · {{ data.recent.durationMs }}ms in Postgres</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.pulse {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 1.25rem 0.25rem 1.5rem 0;
}
.pulse-head {
  display: flex;
  align-items: flex-start;
  gap: 1.5rem;
  max-width: 1080px;
  margin: 0 auto 1.4rem;
}
.pulse-head h2 {
  color: #e8eaed;
  font-size: 1.15rem;
  margin: 0 0 0.4rem;
}
.blurb {
  color: #9aa0a6;
  font-size: 0.88rem;
  line-height: 1.5;
  margin: 0;
  max-width: 720px;
}
.refresh {
  margin-left: auto;
  flex: 0 0 auto;
  border: 1px solid #3c4043;
  background: #2d3035;
  color: #b8f7e4;
  border-radius: 999px;
  padding: 0.45rem 1rem;
  font-size: 0.85rem;
  cursor: pointer;
  transition: border-color 0.15s;
}
.refresh:hover {
  border-color: #b8f7e4;
}
.meta {
  color: #9aa0a6;
  font-size: 0.9rem;
  text-align: center;
  margin: 2rem 0;
}
.meta.error {
  color: #f7a8a8;
}
.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 0.6rem;
  max-width: 1080px;
  margin: 0 auto 1.4rem;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
  gap: 1.5rem 2rem;
  align-items: start;
  max-width: 1080px;
  margin: 0 auto;
}
.card {
  background: #2d3035;
  border: 1px solid #383b41;
  border-radius: 14px;
  padding: 1.1rem 1.3rem 0.9rem;
  min-width: 0;
}
.queries {
  max-width: 1080px;
  margin: 1.5rem auto 0;
}
.queries h3 {
  color: #e8eaed;
  font-size: 0.95rem;
  margin: 0 0 0.75rem;
}
.qrow {
  display: grid;
  grid-template-columns: 3.2rem minmax(9rem, auto) minmax(7.5rem, auto) 1fr;
  gap: 0 1rem;
  align-items: baseline;
  padding: 0.4rem 0;
  border-top: 1px solid #33363b;
  font-size: 0.83rem;
}
.q-at {
  color: #9aa0a6;
}
.q-tool {
  color: #b8f7e4;
  white-space: nowrap;
}
.q-nums {
  color: #9aa0a6;
  white-space: nowrap;
}
.q-sql {
  min-width: 0;
}
.q-sql summary {
  cursor: pointer;
  list-style: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #9aa0a6;
}
.q-sql summary::-webkit-details-marker {
  display: none;
}
.q-sql summary code {
  font-size: 0.78rem;
}
.when-open {
  display: none;
}
.q-sql[open] .when-closed {
  display: none;
}
.q-sql[open] .when-open {
  display: inline;
  font-size: 0.78rem;
}
.q-sql pre {
  background: #25272c;
  border: 1px solid #3c4043;
  border-radius: 8px;
  padding: 0.6rem 0.9rem;
  font-size: 0.78rem;
  color: #b8f7e4;
  overflow-x: auto;
  white-space: pre-wrap;
  margin: 0.15rem 0 0.4rem;
}
.qrow.failed .q-sql summary code,
.q-err {
  color: #f7a8a8;
}
.q-err {
  font-size: 0.8rem;
  margin: 0 0 0.4rem;
}
.foot {
  color: #9aa0a6;
  font-size: 0.8rem;
  margin: 0.6rem 0 0;
}
</style>
