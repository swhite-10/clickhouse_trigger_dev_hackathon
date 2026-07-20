#!/usr/bin/env node
// Seed ClickHouse Cloud's github_events from the public playground.
// Run via: make seed   (fast pre-demo top-up: make seed-recent)
//
// Two tiers, disjoint by construction (the global tier excludes curated
// repos):
//   1. curated orgs/repos, ALL event types, all time -> repo deep-dives,
//      dashboards, multi-year star history
//   2. global "insight" events (watch/fork/issues/PR/release), last 90 days
//      -> global top-N and trend questions. Deliberately recent-only: 2026
//      ingest has decayed (~1M rows/30d vs 2025's tens of millions/month),
//      so a historical backfill bought little demo value for a lot of
//      playground quota — recency is what the product story needs.
//
// Fixed-duration chunks (no preflight count() query) streamed
// playground -> Cloud using ClickHouse-internal compression end to end
// (compress=1 on the pull, decompress=1 on the push — nothing is
// decompressed on this machine). A chunk that overflows the playground's
// per-query caps (1M rows / 1GB / 60s) fails — in one of several different
// ClickHouse error shapes — and bisects into two smaller chunks on ANY
// failure (see MIN_BISECT_SPAN_MS). Completed chunks land in
// .seed-progress.json keyed by their exact (tag, from, to); re-running
// skips them, so the script is resumable and safe to interrupt. A failed
// chunk deletes its own range before the error surfaces, so retries can't
// duplicate rows WITHIN a run — but changing chunk boundaries between runs
// (e.g. editing this file) can leave overlapping progress keys that both
// insert the same underlying rows. If you change chunking logic, wipe
// affected data + .seed-progress.json and reseed clean rather than resuming.
//
// The playground also enforces an hourly abuse quota (~100 queries/hour of
// the same normalized shape) shared across ALL its users — if a run fails
// with QUOTA_EXCEEDED, just re-run `make seed` later; progress is kept.
//
// Changing CURATED after a seed requires a full reseed (drop + recreate the
// table, delete .seed-progress.json) — the global tier's NOT-curated filter
// must match what was excluded when it was pumped.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PLAY = 'https://play.clickhouse.com/?user=play'
const PROGRESS_FILE = fileURLToPath(new URL('../../.seed-progress.json', import.meta.url))
const MIN_BISECT_SPAN_MS = 12 * 3_600_000 // give up and surface the real error below this span

const CURATED = [
  "repo_name LIKE 'ClickHouse/%'",
  "repo_name LIKE 'duckdb/%'",
  "repo_name LIKE 'vuejs/%'",
  "repo_name IN ('facebook/react', 'microsoft/vscode', 'anthropics/claude-code', 'triggerdotdev/trigger.dev')",
]
const CURATED_ANY = `(${CURATED.join(' OR ')})`
const INSIGHT_TYPES = "'WatchEvent', 'ForkEvent', 'IssuesEvent', 'PullRequestEvent', 'ReleaseEvent'"
const GLOBAL_WHERE = `event_type IN (${INSIGHT_TYPES}) AND NOT ${CURATED_ANY}`

const url = need('CLICKHOUSE_ADMIN_URL')
const auth = 'Basic ' + Buffer.from(`${need('CLICKHOUSE_ADMIN_USER')}:${need('CLICKHOUSE_ADMIN_PASSWORD')}`).toString('base64')

function need(name) {
  const v = process.env[name]
  if (!v) {
    console.error(`FAIL: ${name} not set — run through \`make seed\` so op resolves it`)
    process.exit(1)
  }
  return v
}

async function cloudText(sql) {
  const res = await fetch(url, { method: 'POST', headers: { Authorization: auth }, body: sql })
  const text = await res.text()
  if (!res.ok) throw new Error(`cloud: ${text.slice(0, 300)}`)
  return text.trim()
}

const progress = existsSync(PROGRESS_FILE) ? new Set(JSON.parse(readFileSync(PROGRESS_FILE, 'utf8'))) : new Set()
const saveProgress = () => writeFileSync(PROGRESS_FILE, JSON.stringify([...progress], null, 1))

let totalBytes = 0
let totalChunks = 0

async function pump(where, label) {
  const started = Date.now()
  const pull = await fetch(`${PLAY}&compress=1`, {
    method: 'POST',
    body: `SELECT * FROM github_events WHERE ${where} FORMAT Native`,
  })
  if (!pull.ok) throw new Error(`pull ${label}: ${(await pull.text()).slice(0, 300)}`)
  let bytes = 0
  try {
    const push = await fetch(`${url}/?decompress=1&query=${encodeURIComponent('INSERT INTO default.github_events FORMAT Native')}`, {
      method: 'POST',
      headers: { Authorization: auth },
      body: pull.body,
      duplex: 'half',
    })
    bytes = Number(push.headers.get('content-length') ?? 0)
    if (!push.ok) throw new Error(`push ${label}: ${(await push.text()).slice(0, 300)}`)
  } catch (err) {
    // The chunk may have partially landed — clear its exact range so a rerun
    // can't duplicate rows, then let the error surface.
    await cloudText(`DELETE FROM default.github_events WHERE ${where}`).catch(() => {})
    throw err
  }
  totalBytes += bytes
  totalChunks += 1
  console.log(`   ${label}: ${((Date.now() - started) / 1000).toFixed(1)}s (${totalChunks} chunks, ~${(totalBytes / 1e6).toFixed(0)}MB pulled this run)`)
}

// Fixed-duration chunk; bisects on ANY pump failure (oversized results
// surface as several different ClickHouse error shapes — a clean rejection,
// a truncated-stream parse error, a timeout — so no message-pattern
// matching, just retry smaller). Gives up and surfaces the real error once
// span shrinks below MIN_BISECT_SPAN_MS, so a genuine non-size error (bad
// auth, network) doesn't recurse forever.
async function seedRange(tag, baseWhere, from, to) {
  const label = `${tag} ${from}..${to}`
  if (progress.has(label)) return
  const where = `${baseWhere} AND created_at >= '${from}' AND created_at < '${to}'`
  try {
    await pump(where, label)
  } catch (err) {
    const span = new Date(to) - new Date(from)
    if (span > MIN_BISECT_SPAN_MS) {
      console.log(`   ${label}: failed (${err.message.slice(0, 120)}) — bisecting`)
      const mid = toDateTime(new Date((new Date(from).getTime() + new Date(to).getTime()) / 2))
      await seedRange(tag, baseWhere, from, mid)
      await seedRange(tag, baseWhere, mid, to)
      return
    }
    throw err
  }
  progress.add(label)
  saveProgress()
}

async function seedWindow(tag, baseWhere, days, chunkDays) {
  const now = Date.now()
  for (let d = days; d > 0; d -= chunkDays) {
    const from = toDateTime(new Date(now - d * 86_400_000))
    const to = toDateTime(new Date(now - Math.max(d - chunkDays, 0) * 86_400_000))
    await seedRange(tag, baseWhere, from, to)
  }
}

const toDateTime = (d) => d.toISOString().slice(0, 19).replace('T', ' ')

async function main() {
  const recentOnly = process.argv.includes('--recent')

  if (recentOnly) {
    // Fast pre-demo top-up: wipe and re-pull just the last few days so
    // "trending right now" reflects true recency.
    console.log('==> refreshing the last 3 days')
    await cloudText(`DELETE FROM default.github_events WHERE ${GLOBAL_WHERE} AND created_at >= now() - INTERVAL 3 DAY`)
    for (const key of [...progress]) if (key.startsWith('recent-')) progress.delete(key)
    saveProgress()
    await seedWindow('recent-top-up', GLOBAL_WHERE, 3, 1)
  } else {
    console.log('==> tier 1: curated orgs, all types, all time')
    for (const [i, cond] of CURATED.entries()) {
      await seedRange(`curated-${i}`, `(${cond})`, '2011-01-01', '2027-01-01')
    }
    console.log('==> tier 2: global insight events, last 90 days')
    await seedWindow('recent', GLOBAL_WHERE, 90, 3)
  }

  console.log(`==> done: ${totalChunks} chunks, ~${(totalBytes / 1e6).toFixed(0)}MB pulled this run`)
  console.log('==> cloud table now holds:')
  console.log(await cloudText(
    `SELECT event_type, formatReadableQuantity(count()) AS rows, min(created_at) AS oldest, max(created_at) AS newest
     FROM default.github_events GROUP BY event_type ORDER BY count() DESC FORMAT PrettyCompactNoEscapes`,
  ))
}

main().catch((err) => {
  console.error(`\nFAIL: ${err.message}\nRe-run \`make seed\` to resume — completed chunks are skipped.`)
  process.exit(1)
})
