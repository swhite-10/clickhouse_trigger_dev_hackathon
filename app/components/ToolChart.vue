<script setup lang="ts">
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import {
  BarChart,
  LineChart,
  ScatterChart,
  HeatmapChart,
  PieChart,
  TreemapChart,
  SankeyChart,
  RadarChart,
} from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  TitleComponent,
  LegendComponent,
  VisualMapComponent,
  CalendarComponent,
  RadarComponent,
} from 'echarts/components'
import VChart from 'vue-echarts'

use([
  CanvasRenderer,
  BarChart,
  LineChart,
  ScatterChart,
  HeatmapChart,
  PieChart,
  TreemapChart,
  SankeyChart,
  RadarChart,
  GridComponent,
  TooltipComponent,
  TitleComponent,
  LegendComponent,
  VisualMapComponent,
  CalendarComponent,
  RadarComponent,
])

type Row = Record<string, unknown>

const props = defineProps<{
  output: {
    rows: Row[]
    durationMs: number
    truncated?: boolean
    chart: { type: string; x: string; y: string; series?: string; value?: string; title: string }
  }
}>()

const PALETTE = [
  '#b8f7e4',
  '#7ec8f7',
  '#f7d78e',
  '#f79ec8',
  '#a89ef7',
  '#9ef7a8',
  '#f7b88e',
  '#8ef7f0',
  '#d78ef7',
  '#f7f08e',
]
const CHARTABLE = ['bar', 'line', 'area', 'scatter', 'heatmap', 'calendar', 'pie', 'treemap', 'sankey', 'radar']

const fmt = (n: number) => {
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return `${n}`
}

// The agent's descriptor is a claim about the result shape — verify it before
// charting, and fall back to a table when it doesn't hold.
const isStat = computed(() => {
  const { rows, chart } = props.output
  return chart.type === 'stat' && rows.length > 0 && chart.y in (rows[0] ?? {})
})

const statValue = computed(() => fmt(Number(props.output.rows[0]?.[props.output.chart.y] ?? 0)))

const descriptorValid = computed(() => {
  const { rows, chart } = props.output
  if (rows.length === 0 || !CHARTABLE.includes(chart.type)) return false
  const cols = Object.keys(rows[0] ?? {})
  if (chart.type === 'radar') {
    // Every non-x column becomes an axis; need at least 3 of them.
    return cols.includes(chart.x) && cols.filter((c) => c !== chart.x).length >= 3
  }
  if (!cols.includes(chart.x) || !cols.includes(chart.y)) return false
  if (chart.series && !cols.includes(chart.series)) return false
  if (['heatmap', 'sankey'].includes(chart.type) && (!chart.value || !cols.includes(chart.value))) {
    return false
  }
  return true
})

const columns = computed(() => Object.keys(props.output.rows[0] ?? {}))

// Container width drives how hard category labels get truncated: a dashboard
// cell can only spare ~40% of itself for bar labels, a full-width panel more.
const wrap = ref<HTMLElement | null>(null)
const wrapWidth = ref(800)
let ro: ResizeObserver | undefined
onMounted(() => {
  if (!wrap.value) return
  ro = new ResizeObserver((entries) => {
    const w = entries[0]?.contentRect.width
    if (w) wrapWidth.value = w
  })
  ro.observe(wrap.value)
})
onUnmounted(() => ro?.disconnect())

const base = computed(() => ({
  title: { text: props.output.chart.title, textStyle: { color: '#e8eaed', fontSize: 13 } },
  textStyle: { color: '#9aa0a6', fontSize: 11 },
  grid: { left: 10, right: 30, top: 36, bottom: 10, containLabel: true },
}))

const valueAxis = {
  type: 'value',
  splitLine: { lineStyle: { color: '#3c4043' } },
  axisLabel: { formatter: fmt, fontSize: 11 },
}
const categoryAxis = {
  type: 'category',
  axisLine: { lineStyle: { color: '#3c4043' } },
  axisLabel: { fontSize: 11 },
}

// One-row scrollable legend pinned under the plot: can't collide with the
// title or spill over the chart no matter how many series come back.
const scrollLegend = {
  type: 'scroll' as const,
  bottom: 0,
  itemWidth: 16,
  itemHeight: 8,
  textStyle: { color: '#9aa0a6', fontSize: 11 },
  pageIconColor: '#b8f7e4',
  pageIconInactiveColor: '#3c4043',
  pageTextStyle: { color: '#9aa0a6' },
}

const mintVisualMap = (values: number[]) => ({
  min: 0,
  max: Math.max(...values),
  text: [fmt(Math.max(...values)), '0'],
  orient: 'horizontal' as const,
  left: 'center' as const,
  bottom: 0,
  itemHeight: 90,
  textStyle: { color: '#9aa0a6', fontSize: 10 },
  inRange: { color: ['#2d3035', '#57b899', '#b8f7e4'] },
})

const option = computed(() => {
  const { rows, chart } = props.output

  if (chart.type === 'line' || chart.type === 'area') {
    const xs = [...new Set(rows.map((r) => String(r[chart.x])))]
    const names = chart.series ? [...new Set(rows.map((r) => String(r[chart.series!])))] : [chart.y]
    const stacked = chart.type === 'area' && names.length > 1
    const series = names.map((name, i) => {
      const byX = new Map(
        rows
          .filter((r) => !chart.series || String(r[chart.series!]) === name)
          .map((r) => [String(r[chart.x]), Number(r[chart.y])]),
      )
      return {
        name,
        type: 'line',
        showSymbol: false,
        stack: stacked ? 'total' : undefined,
        areaStyle: chart.type === 'area' ? { opacity: 0.3 } : undefined,
        data: xs.map((x) => byX.get(x) ?? (stacked ? 0 : null)),
        lineStyle: { width: 2, color: PALETTE[i % PALETTE.length] },
        itemStyle: { color: PALETTE[i % PALETTE.length] },
      }
    })
    return {
      ...base.value,
      tooltip: { trigger: 'axis', valueFormatter: fmt },
      legend: names.length > 1 ? scrollLegend : undefined,
      grid: { ...base.value.grid, bottom: names.length > 1 ? 28 : 10 },
      xAxis: { ...categoryAxis, data: xs },
      yAxis: valueAxis,
      series,
    }
  }

  if (chart.type === 'scatter') {
    const names = chart.series ? [...new Set(rows.map((r) => String(r[chart.series!])))] : [chart.y]
    const series = names.map((name, i) => ({
      name,
      type: 'scatter',
      symbolSize: 10,
      itemStyle: { color: PALETTE[i % PALETTE.length], opacity: 0.85 },
      data: rows
        .filter((r) => !chart.series || String(r[chart.series!]) === name)
        .map((r) => [Number(r[chart.x]), Number(r[chart.y])]),
    }))
    return {
      ...base.value,
      tooltip: {
        formatter: (p: { value: [number, number] }) =>
          `${chart.x}: ${fmt(p.value[0])}<br/>${chart.y}: ${fmt(p.value[1])}`,
      },
      legend: names.length > 1 ? scrollLegend : undefined,
      // Axis names sit mid-axis (y rotated): the default end-of-axis spots
      // collide with the centered title / clip at the right edge in a cell.
      grid: { ...base.value.grid, left: 26, bottom: names.length > 1 ? 54 : 36 },
      xAxis: {
        ...valueAxis,
        name: chart.x,
        nameLocation: 'middle',
        nameGap: 26,
        nameTextStyle: { color: '#9aa0a6', fontSize: 11 },
      },
      yAxis: {
        ...valueAxis,
        name: chart.y,
        nameLocation: 'middle',
        nameRotate: 90,
        nameGap: 42,
        nameTextStyle: { color: '#9aa0a6', fontSize: 11 },
      },
      series,
    }
  }

  if (chart.type === 'heatmap') {
    const xs = [...new Set(rows.map((r) => String(r[chart.x])))]
    const ys = [...new Set(rows.map((r) => String(r[chart.y])))]
    const values = rows.map((r) => Number(r[chart.value!]))
    return {
      ...base.value,
      tooltip: {
        formatter: (p: { value: [number, number, number] }) =>
          `${xs[p.value[0]]} · ${ys[p.value[1]]}: ${fmt(p.value[2])}`,
      },
      grid: { ...base.value.grid, bottom: 70 },
      xAxis: { ...categoryAxis, data: xs },
      yAxis: { ...categoryAxis, data: ys },
      visualMap: mintVisualMap(values),
      series: [
        {
          type: 'heatmap',
          data: rows.map((r) => [
            xs.indexOf(String(r[chart.x])),
            ys.indexOf(String(r[chart.y])),
            Number(r[chart.value!]),
          ]),
          itemStyle: { borderColor: '#25272c', borderWidth: 1 },
        },
      ],
    }
  }

  if (chart.type === 'calendar') {
    const dates = rows.map((r) => String(r[chart.x])).sort()
    const values = rows.map((r) => Number(r[chart.y]))
    return {
      ...base.value,
      tooltip: {
        formatter: (p: { value: [string, number] }) => `${p.value[0]}: ${fmt(p.value[1])}`,
      },
      calendar: {
        top: 60,
        left: 50,
        right: 20,
        range: [dates[0], dates[dates.length - 1]],
        cellSize: ['auto', 13],
        dayLabel: { color: '#9aa0a6', firstDay: 1, fontSize: 10 },
        monthLabel: { color: '#9aa0a6', fontSize: 10 },
        yearLabel: { color: '#e8eaed', fontSize: 12 },
        itemStyle: { color: '#2d3035', borderColor: '#25272c' },
        splitLine: { lineStyle: { color: '#3c4043' } },
      },
      visualMap: mintVisualMap(values),
      series: [
        {
          type: 'heatmap',
          coordinateSystem: 'calendar',
          data: rows.map((r) => [String(r[chart.x]), Number(r[chart.y])]),
        },
      ],
    }
  }

  if (chart.type === 'pie') {
    // Long tails wreck pie labels: scrollable one-row legend at the bottom,
    // and labels only on slices big enough to matter (tooltip covers the rest).
    return {
      ...base.value,
      tooltip: { valueFormatter: fmt },
      legend: scrollLegend,
      color: PALETTE,
      series: [
        {
          type: 'pie',
          radius: ['40%', '62%'],
          center: ['50%', '47%'],
          minShowLabelAngle: 12,
          label: { color: '#e8eaed', fontSize: 11, formatter: '{b}: {d}%' },
          labelLayout: { hideOverlap: true },
          labelLine: { lineStyle: { color: '#3c4043' } },
          itemStyle: { borderColor: '#25272c', borderWidth: 2 },
          data: rows.map((r) => ({ name: String(r[chart.x]), value: Number(r[chart.y]) })),
        },
      ],
    }
  }

  if (chart.type === 'treemap') {
    // When every name shares an 'owner/' prefix (org-scoped questions), the
    // prefix eats the label space in small boxes — drop it from labels only;
    // tooltips keep the full name.
    const names = [...new Set(rows.map((r) => String(r[chart.x])))]
    const slash = names[0]?.indexOf('/') ?? -1
    const prefix =
      names.length > 1 && slash > 0 && names.every((n) => n.startsWith(names[0]!.slice(0, slash + 1)))
        ? names[0]!.slice(0, slash + 1)
        : ''
    const shortLabel = (p: { name: string }) =>
      prefix && p.name.startsWith(prefix) ? p.name.slice(prefix.length) : p.name
    const data = chart.series
      ? [...new Set(rows.map((r) => String(r[chart.series!])))].map((group) => ({
          name: group,
          children: rows
            .filter((r) => String(r[chart.series!]) === group)
            .map((r) => ({ name: String(r[chart.x]), value: Number(r[chart.y]) })),
        }))
      : rows.map((r) => ({ name: String(r[chart.x]), value: Number(r[chart.y]) }))
    return {
      ...base.value,
      tooltip: { valueFormatter: fmt },
      color: PALETTE,
      series: [
        {
          type: 'treemap',
          top: 40,
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          label: { color: '#25272c', fontWeight: 600, fontSize: 11, formatter: shortLabel },
          upperLabel: chart.series
            ? { show: true, color: '#e8eaed', height: 20, fontSize: 11 }
            : undefined,
          itemStyle: { borderColor: '#25272c', borderWidth: 2, gapWidth: 2 },
          data,
        },
      ],
    }
  }

  if (chart.type === 'sankey') {
    const sources = [...new Set(rows.map((r) => String(r[chart.x])))]
    const targets = [...new Set(rows.map((r) => String(r[chart.y])))]
    // Sankey requires distinct node names; suffix any target that collides.
    const targetName = (t: string) => (sources.includes(t) ? `${t} ` : t)
    // Same trick as treemap: when every target shares an 'owner/' prefix the
    // right-column labels clip — strip it from labels only.
    const slash = targets[0]?.indexOf('/') ?? -1
    const prefix =
      slash > 0 && targets.every((t) => t.startsWith(targets[0]!.slice(0, slash + 1)))
        ? targets[0]!.slice(0, slash + 1)
        : ''
    const shortLabel = (p: { name: string }) =>
      prefix && p.name.startsWith(prefix) ? p.name.slice(prefix.length) : p.name
    return {
      ...base.value,
      tooltip: { valueFormatter: fmt },
      color: PALETTE,
      series: [
        {
          type: 'sankey',
          top: 40,
          left: 10,
          right: 130,
          nodeAlign: 'justify',
          label: { color: '#e8eaed', fontSize: 11, formatter: shortLabel },
          lineStyle: { color: 'gradient', opacity: 0.35 },
          itemStyle: { borderWidth: 0 },
          data: [
            ...sources.map((name) => ({ name })),
            ...targets.map((name) => ({ name: targetName(name) })),
          ],
          links: rows.map((r) => ({
            source: String(r[chart.x]),
            target: targetName(String(r[chart.y])),
            value: Number(r[chart.value!]),
          })),
        },
      ],
    }
  }

  if (chart.type === 'radar') {
    const metrics = Object.keys(rows[0] ?? {}).filter((c) => c !== chart.x)
    const indicator = metrics.map((m) => ({
      name: m,
      max: Math.max(...rows.map((r) => Number(r[m]))) * 1.1 || 1,
    }))
    return {
      ...base.value,
      tooltip: {},
      legend: scrollLegend,
      radar: {
        indicator,
        center: ['50%', '50%'],
        radius: '56%',
        axisName: { color: '#9aa0a6', fontSize: 10 },
        axisLine: { lineStyle: { color: '#3c4043' } },
        splitLine: { lineStyle: { color: '#3c4043' } },
        splitArea: { show: false },
      },
      series: [
        {
          type: 'radar',
          data: rows.map((r, i) => ({
            name: String(r[chart.x]),
            value: metrics.map((m) => Number(r[m])),
            itemStyle: { color: PALETTE[i % PALETTE.length] },
            lineStyle: { color: PALETTE[i % PALETTE.length], width: 2 },
            areaStyle: { opacity: 0.15 },
          })),
        },
      ],
    }
  }

  // Horizontal bar: reverse so the top-ranked row renders at the top.
  // Labels can be issue titles — cap them or they eat the whole plot width
  // in a dashboard cell (tooltips carry the full text).
  const barCategoryAxis = (data: string[]) => ({
    ...categoryAxis,
    data,
    axisLabel: {
      fontSize: 11,
      width: Math.max(120, Math.round(wrapWidth.value * 0.42)),
      overflow: 'truncate' as const,
    },
  })

  // With a series alias: stacked segments per category (composition across
  // categories, e.g. community mix per repo).
  if (chart.series) {
    const xs = [...new Set(rows.map((r) => String(r[chart.x])))].reverse()
    const names = [...new Set(rows.map((r) => String(r[chart.series!])))]
    return {
      ...base.value,
      tooltip: { valueFormatter: fmt },
      legend: scrollLegend,
      grid: { ...base.value.grid, bottom: 28 },
      xAxis: valueAxis,
      yAxis: barCategoryAxis(xs),
      series: names.map((name, i) => {
        const byX = new Map(
          rows
            .filter((r) => String(r[chart.series!]) === name)
            .map((r) => [String(r[chart.x]), Number(r[chart.y])]),
        )
        return {
          name,
          type: 'bar',
          stack: 'total',
          data: xs.map((x) => byX.get(x) ?? 0),
          itemStyle: { color: PALETTE[i % PALETTE.length] },
        }
      }),
    }
  }

  const ordered = [...rows].reverse()
  return {
    ...base.value,
    tooltip: { valueFormatter: fmt },
    xAxis: valueAxis,
    yAxis: barCategoryAxis(ordered.map((r) => String(r[chart.x]))),
    series: [
      {
        type: 'bar',
        data: ordered.map((r) => Number(r[chart.y])),
        itemStyle: { color: '#b8f7e4', borderRadius: [0, 4, 4, 0] },
      },
    ],
  }
})

const height = computed(() => {
  const { rows, chart } = props.output
  if (chart.type === 'heatmap') {
    return Math.max(230, [...new Set(rows.map((r) => String(r[chart.y])))].length * 26 + 120)
  }
  if (chart.type === 'bar') {
    const bars = chart.series ? [...new Set(rows.map((r) => String(r[chart.x])))].length : rows.length
    return Math.max(200, bars * 24 + 56 + (chart.series ? 24 : 0))
  }
  // Calendar rows are fixed-height (7 × 13px cells + labels), so the panel
  // can be short regardless of width.
  if (chart.type === 'calendar') return 205
  if (chart.type === 'pie') return 340
  if (chart.type === 'treemap') return 360
  if (chart.type === 'radar') return 350
  if (chart.type === 'sankey') {
    return Math.max(300, [...new Set(rows.map((r) => String(r[chart.y])))].length * 26 + 90)
  }
  return 300
})
</script>

<template>
  <div ref="wrap">
    <div v-if="isStat" class="stat">
      <p class="stat-value">{{ statValue }}</p>
      <p class="stat-label">{{ output.chart.title }}</p>
    </div>
    <template v-else-if="descriptorValid">
      <VChart :option="option" :autoresize="true" :style="{ height: `${height}px`, width: '100%' }" />
    </template>
    <div v-else-if="output.rows.length > 0" class="table-wrap">
      <p class="table-title">{{ output.chart.title }}</p>
      <table>
        <thead>
          <tr>
            <th v-for="col in columns" :key="col">{{ col }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in output.rows" :key="i">
            <td v-for="col in columns" :key="col">{{ row[col] }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else class="meta">No rows matched.</p>
    <p v-if="!isStat" class="meta">
      {{ output.rows.length }} rows{{ output.truncated ? ' (truncated)' : '' }} ·
      {{ output.durationMs }}ms in ClickHouse
    </p>
  </div>
</template>

<style scoped>
.meta {
  color: #9aa0a6;
  font-size: 0.8rem;
  margin: 0.25rem 0 0;
}
.stat {
  background: #25272c;
  border: 1px solid #3c4043;
  border-radius: 10px;
  padding: 0.9rem 1rem;
  text-align: center;
}
.stat-value {
  color: #b8f7e4;
  font-size: 1.9rem;
  font-weight: 700;
  margin: 0;
  line-height: 1.1;
}
.stat-label {
  color: #9aa0a6;
  font-size: 0.8rem;
  margin: 0.35rem 0 0;
}
.table-wrap {
  overflow-x: auto;
}
.table-title {
  color: #e8eaed;
  font-size: 0.9rem;
  font-weight: 600;
  margin: 0 0 0.5rem;
}
table {
  border-collapse: collapse;
  font-size: 0.85rem;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: 0.35rem 0.75rem;
  border-bottom: 1px solid #3c4043;
  white-space: nowrap;
}
th {
  color: #b8f7e4;
  font-weight: 600;
}
td {
  color: #e8eaed;
}
</style>
