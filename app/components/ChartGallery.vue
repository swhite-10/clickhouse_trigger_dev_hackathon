<script setup lang="ts">
// Dev-only fixture gallery (open /?gallery=1): renders every chart type the
// agent can emit through the real ToolChart, at both a dashboard-cell width
// and full width, with data shaped like the validated queries. Lets layout /
// legend / spacing regressions be caught without spending an LLM turn per
// chart type.

type Row = Record<string, unknown>
type Chart = { type: string; x: string; y: string; series?: string; value?: string; title: string }
type Fixture = { label: string; rows: Row[]; chart: Chart }

// Deterministic pseudo-random so screenshots are comparable across runs.
let seed = 42
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}

const months = (from: string, n: number) => {
  const [y, m] = from.split('-').map(Number)
  return Array.from({ length: n }, (_, i) => {
    const total = (y ?? 2022) * 12 + ((m ?? 1) - 1) + i
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`
  })
}

const walk = (n: number, start: number, drift: number, noise: number) => {
  let v = start
  return Array.from({ length: n }, () => {
    v = Math.max(0, v + drift + (rand() - 0.5) * noise)
    return Math.round(v)
  })
}

const fixtures: Fixture[] = []

// line, 2 series, 54 months — vue vs react stars
{
  const ms = months('2022-01', 54)
  const vue = walk(54, 900, 2, 300)
  const react = walk(54, 1400, -2, 400)
  fixtures.push({
    label: 'line · 2 series · 54 points',
    rows: ms.flatMap((m, i) => [
      { m, repo: 'vuejs/core', stars: vue[i] },
      { m, repo: 'facebook/react', stars: react[i] },
    ]),
    chart: { type: 'line', x: 'm', y: 'stars', series: 'repo', title: 'Monthly stars: vuejs/core vs facebook/react' },
  })
}

// line, single series — median time-to-merge
fixtures.push({
  label: 'line · single series',
  rows: months('2020-01', 78).map((m) => ({ m, median_hours: Math.round(20 + rand() * 60) })),
  chart: { type: 'line', x: 'm', y: 'median_hours', title: 'Median hours to merge a PR in facebook/react' },
})

// area, stacked, 6 series — event mix
{
  const kinds = ['PushEvent', 'PullRequestEvent', 'IssuesEvent', 'IssueCommentEvent', 'WatchEvent', 'ReleaseEvent']
  const ms = months('2025-01', 18)
  fixtures.push({
    label: 'area · 6 series stacked (legend stress)',
    rows: ms.flatMap((m) =>
      kinds.map((kind) => ({ m, kind, c: Math.round(200 + rand() * 900) })),
    ),
    chart: { type: 'area', x: 'm', y: 'c', series: 'kind', title: 'ClickHouse/ClickHouse event mix by month' },
  })
}

// bar — hottest issues, long labels on purpose
fixtures.push({
  label: 'bar · long category labels',
  rows: [
    ['Reactivity transform breaks when destructuring props in script setup blocks', 214],
    ['Hydration mismatch after upgrading to 3.5 with async components', 187],
    ['Memory leak in keep-alive when router-view is nested', 154],
    ['TypeScript inference fails for generic components with slots', 133],
    ['v-model modifiers are not applied on custom form components', 121],
    ['Suspense resolves too early with parallel async setup calls', 98],
    ['Teleport target not found warning in SSR builds', 84],
    ['Computed values not updating inside watchEffect cleanup', 71],
    ['DevTools timeline missing events for v3.5+', 63],
    ['Transition classes are removed one frame too early', 55],
  ].map(([title, comments]) => ({ title, comments })),
  chart: { type: 'bar', x: 'title', y: 'comments', title: 'Most-discussed vuejs/core issues, last 90 days' },
})

// bar — stacked, community mix per repo
{
  const repos = [
    'ClickHouse/ClickHouse',
    'duckdb/duckdb',
    'vuejs/core',
    'facebook/react',
    'microsoft/vscode',
    'anthropics/claude-code',
    'triggerdotdev/trigger.dev',
  ]
  const whos = ['MEMBER', 'CONTRIBUTOR', 'COLLABORATOR', 'NONE', 'OWNER']
  fixtures.push({
    label: 'bar · stacked by series',
    rows: repos.flatMap((repo) =>
      whos.map((who) => ({ repo, who, prs: Math.round(rand() * 800 * (who === 'OWNER' ? 0.1 : 1)) })),
    ),
    chart: { type: 'bar', x: 'repo', y: 'prs', series: 'who', title: 'Who opens PRs, per curated repo' },
  })
}

// scatter — issues vs merged PRs, no series
fixtures.push({
  label: 'scatter · single series',
  rows: Array.from({ length: 30 }, (_, i) => ({
    repo: `org/repo-${i}`,
    issues_opened: Math.round(rand() * 900),
    prs_merged: Math.round(rand() * 600),
  })),
  chart: { type: 'scatter', x: 'issues_opened', y: 'prs_merged', title: 'Issues opened vs PRs merged (90 days)' },
})

// scatter — with series (legend + axis names together)
fixtures.push({
  label: 'scatter · 3 series',
  rows: Array.from({ length: 45 }, (_, i) => ({
    org: ['ClickHouse', 'duckdb', 'vuejs'][i % 3],
    issues_opened: Math.round(rand() * 500),
    prs_merged: Math.round(rand() * 400),
  })),
  chart: {
    type: 'scatter',
    x: 'issues_opened',
    y: 'prs_merged',
    series: 'org',
    title: 'Issues vs merged PRs by org',
  },
})

// heatmap — hour x weekday
fixtures.push({
  label: 'heatmap · 24×7',
  rows: Array.from({ length: 7 }, (_, d) =>
    Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      day: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d],
      c: Math.round(rand() * 400 * (d < 5 ? 1 : 0.35) * (h > 7 && h < 19 ? 1 : 0.4)),
    })),
  ).flat(),
  chart: { type: 'heatmap', x: 'hour', y: 'day', value: 'c', title: 'Push activity by hour and weekday (UTC)' },
})

// calendar — a full year
fixtures.push({
  label: 'calendar · 365 days',
  rows: Array.from({ length: 365 }, (_, i) => {
    const d = new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10)
    return { d, c: Math.round(rand() * 120) }
  }),
  chart: { type: 'calendar', x: 'd', y: 'c', title: 'microsoft/vscode pushes, 2025' },
})

// pie — community mix with a long tail
fixtures.push({
  label: 'pie · long tail slices',
  rows: [
    ['NONE', 4120],
    ['CONTRIBUTOR', 2380],
    ['MEMBER', 1210],
    ['COLLABORATOR', 340],
    ['OWNER', 96],
    ['MANNEQUIN', 14],
  ].map(([who, prs]) => ({ who, prs })),
  chart: { type: 'pie', x: 'who', y: 'prs', title: 'Who opens PRs in vuejs/core' },
})

// treemap — org repos sharing a prefix
fixtures.push({
  label: 'treemap · shared org prefix',
  rows: [
    'ClickHouse/ClickHouse',
    'ClickHouse/clickhouse-js',
    'ClickHouse/clickhouse-docs',
    'ClickHouse/ch-go',
    'ClickHouse/clickhouse-java',
    'ClickHouse/metabase-clickhouse-driver',
    'ClickHouse/clickhouse-cpp',
    'ClickHouse/dbt-clickhouse',
    'ClickHouse/clickhouse-kafka-connect',
    'ClickHouse/ClickBench',
    'ClickHouse/clickhouse-rs',
    'ClickHouse/homebrew-clickhouse',
  ].map((repo, i) => ({ repo, events: Math.round(9000 / (i + 1) + rand() * 300) })),
  chart: { type: 'treemap', x: 'repo', y: 'events', title: 'ClickHouse org activity by repo, 2026' },
})

// sankey — contributors to repos
{
  const contributors = ['alexey-m', 'kitaisreal', 'rschu1ze', 'azat', 'nickitat', 'al13n321', 'antonio2368', 'tavplubix']
  const repos = ['ClickHouse/ClickHouse', 'ClickHouse/clickhouse-js', 'ClickHouse/ch-go', 'ClickHouse/clickhouse-docs']
  const rows: Row[] = []
  for (const c of contributors) {
    for (const r of repos) {
      if (rand() > 0.45) rows.push({ contributor: c, repo: r, pushes: Math.round(20 + rand() * 400) })
    }
  }
  fixtures.push({
    label: 'sankey · 8 sources → 4 targets',
    rows,
    chart: { type: 'sankey', x: 'contributor', y: 'repo', value: 'pushes', title: 'Top contributors across ClickHouse repos' },
  })
}

// radar — 3 repos, 5 metrics
fixtures.push({
  label: 'radar · 3 entities × 5 metrics',
  rows: ['ClickHouse/ClickHouse', 'duckdb/duckdb', 'microsoft/vscode'].map((repo) => ({
    repo,
    stars: Math.round(2000 + rand() * 9000),
    prs_opened: Math.round(500 + rand() * 4000),
    issues_opened: Math.round(400 + rand() * 3000),
    pushes: Math.round(3000 + rand() * 15000),
    releases: Math.round(5 + rand() * 60),
  })),
  chart: { type: 'radar', x: 'repo', y: '', title: 'Activity profile, 2026 YTD' },
})

// stat — single number
fixtures.push({
  label: 'stat',
  rows: [{ total_stars: 118423 }],
  chart: { type: 'stat', x: '', y: 'total_stars', title: 'Stars all-time for ClickHouse/ClickHouse' },
})

// table fallback — descriptor claims a column that isn't there
fixtures.push({
  label: 'table fallback (bad descriptor)',
  rows: [
    { actor: 'alexey-m', pushes: 1412, prs: 88 },
    { actor: 'rschu1ze', pushes: 1201, prs: 74 },
    { actor: 'azat', pushes: 988, prs: 61 },
  ],
  chart: { type: 'bar', x: 'login', y: 'pushes', title: 'Top pushers (descriptor names a missing column)' },
})

const output = (f: Fixture) => ({ rows: f.rows, durationMs: 123, chart: f.chart })

// ?gallery=1&only=3 renders a single fixture (screenshot-friendly).
const only = Number(new URLSearchParams(location.search).get('only') ?? NaN)
const visible = Number.isNaN(only) ? fixtures : [fixtures[only]].filter((f): f is Fixture => !!f)
</script>

<template>
  <div class="gallery">
    <h2>Chart fixture gallery</h2>
    <p class="hint">Left column ≈ dashboard cell width, right column = full width.</p>
    <section v-for="f in visible" :key="f.label" class="fixture">
      <h3>{{ f.label }}</h3>
      <div class="pair">
        <div class="cell narrow">
          <ToolChart :output="output(f)" />
        </div>
        <div class="cell">
          <ToolChart :output="output(f)" />
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.gallery {
  padding: 1rem 0 4rem;
  overflow-y: auto;
}
h2 {
  color: #b8f7e4;
  font-size: 1.1rem;
  margin: 0 0 0.25rem;
}
.hint {
  color: #9aa0a6;
  font-size: 0.85rem;
  margin: 0 0 1.5rem;
}
.fixture h3 {
  color: #9aa0a6;
  font-size: 0.85rem;
  font-weight: 600;
  margin: 1.5rem 0 0.5rem;
}
.pair {
  display: grid;
  grid-template-columns: 400px 1fr;
  gap: 1rem;
  align-items: start;
}
.cell {
  background: #2d3035;
  border: 1px solid #3c4043;
  border-radius: 10px;
  padding: 0.75rem;
  min-width: 0;
}
</style>
