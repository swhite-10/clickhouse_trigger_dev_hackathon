#!/usr/bin/env node
// Seed ClickHouse Cloud's github_events from the public playground.
// Run via: make seed   (fast pre-demo top-up: make seed-recent)
//
// Two tiers, disjoint by construction (the global tier excludes curated
// repos):
//   1. curated orgs/repos (27 marquee projects), ALL event types, all time
//      -> repo deep-dives, dashboards, multi-year star history
//   2. global v2: ALL event types for EVERY other repo, fixed ~3-month
//      window (GLOBAL_END/GLOBAL_DAYS), pumped newest-first so the freshest
//      data lands first if a run is interrupted. Window size is a playground
//      -quota tradeoff: all-types runs ~100-115M rows/month, and the quota
//      passes roughly a month of that per 2-4 hours.
//      (2026 note: playground ingest of enriched types — issues/PRs/comments
//      — thins out after ~Apr 2026; pushes keep flowing. That's source decay,
//      not a seeding choice.)
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
// Appending to CURATED after the global window has pumped needs care: the
// window already holds that repo's rows (it wasn't excluded at pump time),
// so pumping its full history would duplicate them. Pair any new entry with
// a guarded once('predelete-<cond>', DELETE ...) clearing the condition's
// rows first — the 'global-v2-reset' step below is the template.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PLAY = 'https://play.clickhouse.com/?user=play'
const PROGRESS_FILE = fileURLToPath(new URL('../../.seed-progress.json', import.meta.url))
const MIN_BISECT_SPAN_MS = 3_600_000 // give up and surface the real error below this span

// Entries 0-3 are the original seed and MUST keep their positions — progress
// keys embed the index. 4+ are the marquee expansion (sized ~31M rows total
// on the playground before adding). anthropics/% excludes claude-code because
// entry 3 already carries it.
const CURATED = [
  "repo_name LIKE 'ClickHouse/%'",
  "repo_name LIKE 'duckdb/%'",
  "repo_name LIKE 'vuejs/%'",
  "repo_name IN ('facebook/react', 'microsoft/vscode', 'anthropics/claude-code', 'triggerdotdev/trigger.dev')",
  "repo_name LIKE 'kubernetes/%'",
  "repo_name LIKE 'rust-lang/%'",
  "repo_name LIKE 'pytorch/%'",
  "repo_name LIKE 'grafana/%'",
  "repo_name LIKE 'huggingface/%' OR repo_name LIKE 'openai/%'",
  "repo_name IN ('apache/spark', 'nodejs/node', 'python/cpython', 'golang/go')",
  "repo_name IN ('angular/angular', 'vercel/next.js') OR repo_name LIKE 'langchain-ai/%' OR repo_name LIKE 'sveltejs/%'",
  "(repo_name LIKE 'anthropics/%' AND repo_name != 'anthropics/claude-code') OR repo_name IN ('torvalds/linux', 'microsoft/TypeScript')",
  "repo_name IN ('ollama/ollama', 'postgres/postgres') OR repo_name LIKE 'ggerganov/%' OR repo_name LIKE 'ggml-org/%'",
]
const CURATED_ANY = `(${CURATED.map((c) => `(${c})`).join(' OR ')})`
const OLD_CURATED_ANY = `(${CURATED.slice(0, 4).map((c) => `(${c})`).join(' OR ')})`
const INSIGHT_TYPES = "'WatchEvent', 'ForkEvent', 'IssuesEvent', 'PullRequestEvent', 'ReleaseEvent'"
// Global tier v2: ALL event types for every non-curated repo, fixed calendar
// window. The END anchor is a constant so chunk boundaries are identical
// across resumed runs — duplicates by drifting boundaries are impossible.
const GLOBAL_WHERE = `NOT ${CURATED_ANY}`
const GLOBAL_END = '2026-07-23 00:00:00'
const GLOBAL_DAYS = 92
const GLOBAL_CHUNK_HOURS = 4

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function pump(where, label) {
  const started = Date.now()
  // wait_end_of_query=1: the playground fully materialises the result before
  // streaming, so cap overflows / quota hits arrive as a clean HTTP error
  // HERE — not as exception text embedded mid-stream that the push then
  // shovels into the table and dies on with a bogus "syntax error".
  const pull = await fetch(`${PLAY}&compress=1&wait_end_of_query=1`, {
    method: 'POST',
    body: `SELECT * FROM github_events WHERE ${where} FORMAT Native`,
  })
  if (!pull.ok) {
    // The error body is compressed (compress=1 applies to it too) — the
    // header carries the ClickHouse exception code, so classify from that:
    // 201 = quota, everything else is treated as oversized/transient.
    const code = pull.headers.get('x-clickhouse-exception-code') ?? '?'
    const err = new Error(`pull ${label}: exception code ${code}`)
    err.pullSide = true // nothing was pushed — never delete on this path
    throw err
  }
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
    // can't duplicate rows, then let the error surface. Only push-side
    // failures can have landed rows; pull-side errors must NOT delete (on a
    // resumed run the attempted range can cover chunks that completed in an
    // earlier run, and deleting it wipes data the progress file will skip).
    if (!err.pullSide) {
      await cloudText(`DELETE FROM default.github_events WHERE ${where}`).catch(() => {})
    }
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
// True when some completed chunk lies strictly inside [from, to) — meaning
// this range was already bisected in an earlier run. Pumping it whole would
// duplicate those rows (or, on failure, delete them): descend instead.
function hasDoneDescendant(tag, from, to) {
  const f = new Date(from).getTime()
  const t = new Date(to).getTime()
  for (const key of progress) {
    if (!key.startsWith(`${tag} `)) continue
    const [kf, kt] = key.slice(tag.length + 1).split('..')
    const kfMs = new Date(kf).getTime()
    const ktMs = new Date(kt).getTime()
    if (kfMs >= f && ktMs <= t && ktMs - kfMs < t - f) return true
  }
  return false
}

async function seedRange(tag, baseWhere, from, to, attempt = 0) {
  const label = `${tag} ${from}..${to}`
  if (progress.has(label)) return
  const span = new Date(to) - new Date(from)
  const bisect = async () => {
    const mid = toDateTime(new Date((new Date(from).getTime() + new Date(to).getTime()) / 2))
    await seedRange(tag, baseWhere, from, mid)
    await seedRange(tag, baseWhere, mid, to)
    progress.add(label)
    saveProgress()
  }
  if (span > MIN_BISECT_SPAN_MS && hasDoneDescendant(tag, from, to)) {
    console.log(`   ${label}: partially seeded — descending without re-pulling`)
    return bisect()
  }
  const where = `${baseWhere} AND created_at >= '${from}' AND created_at < '${to}'`
  try {
    await pump(where, label)
  } catch (err) {
    if (/QUOTA_EXCEEDED|Code:\s*201\b|exception code 201\b/.test(err.message)) {
      console.log(`   ${label}: playground quota hit — waiting 120s (attempt ${attempt + 1})`)
      await sleep(120_000)
      return seedRange(tag, baseWhere, from, to, attempt + 1)
    }
    if (/fetch failed|ECONNRESET|ETIMEDOUT|socket/.test(err.message) && attempt < 3) {
      console.log(`   ${label}: transient network error — retrying in 15s (attempt ${attempt + 1})`)
      await sleep(15_000)
      return seedRange(tag, baseWhere, from, to, attempt + 1)
    }
    if (span > MIN_BISECT_SPAN_MS) {
      console.log(`   ${label}: oversized (${err.message.slice(0, 120)}) — bisecting`)
      return bisect()
    }
    throw err
  }
  progress.add(label)
  saveProgress()
}

// One-off guarded statement (DELETE etc.) — runs exactly once ever, tracked
// in the same progress file as the pumped chunks.
async function once(key, sql, note) {
  if (progress.has(key)) return
  console.log(`==> ${note}`)
  await cloudText(sql)
  progress.add(key)
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
    // The v1 global tier (insight types only, non-curated) is a strict subset
    // of what tier 2 below re-pulls — drop it once so nothing double-lands.
    // Must run before the new curated entries pump: it also clears their
    // insight rows that v1 captured while they were still "global".
    await once(
      'global-v2-reset',
      `DELETE FROM default.github_events WHERE event_type IN (${INSIGHT_TYPES}) AND NOT ${OLD_CURATED_ANY}`,
      'dropping the v1 insight-only global tier (superseded by the all-types window)',
    )

    console.log('==> tier 1: curated orgs, all types, all time')
    for (const [i, cond] of CURATED.entries()) {
      await seedRange(`curated-${i}`, `(${cond})`, '2011-01-01', '2027-01-01')
    }

    console.log(`==> tier 2: ALL event types, every other repo, last ${GLOBAL_DAYS} days (newest first)`)
    const end = new Date(`${GLOBAL_END.replace(' ', 'T')}Z`).getTime()
    for (let h = 0; h < GLOBAL_DAYS * 24; h += GLOBAL_CHUNK_HOURS) {
      const to = toDateTime(new Date(end - h * 3_600_000))
      const from = toDateTime(new Date(end - (h + GLOBAL_CHUNK_HOURS) * 3_600_000))
      await seedRange('global-v2', GLOBAL_WHERE, from, to)
    }
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
