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
} from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  TitleComponent,
  LegendComponent,
  VisualMapComponent,
  CalendarComponent,
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
  GridComponent,
  TooltipComponent,
  TitleComponent,
  LegendComponent,
  VisualMapComponent,
  CalendarComponent,
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
const CHARTABLE = ['bar', 'line', 'area', 'scatter', 'heatmap', 'calendar', 'pie', 'treemap', 'sankey']

const fmt = (n: number) => {
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return `${n}`
}

// The agent's descriptor is a claim about the result shape — verify it before
// charting, and fall back to a table when it doesn't hold.
const descriptorValid = computed(() => {
  const { rows, chart } = props.output
  if (rows.length === 0 || !CHARTABLE.includes(chart.type)) return false
  const cols = Object.keys(rows[0] ?? {})
  if (!cols.includes(chart.x) || !cols.includes(chart.y)) return false
  if (chart.series && !cols.includes(chart.series)) return false
  if (['heatmap', 'sankey'].includes(chart.type) && (!chart.value || !cols.includes(chart.value))) {
    return false
  }
  return true
})

const columns = computed(() => Object.keys(props.output.rows[0] ?? {}))

const base = computed(() => ({
  title: { text: props.output.chart.title, textStyle: { color: '#e8eaed', fontSize: 14 } },
  textStyle: { color: '#9aa0a6' },
  grid: { left: 10, right: 30, top: 40, bottom: 10, containLabel: true },
}))

const valueAxis = { type: 'value', splitLine: { lineStyle: { color: '#3c4043' } }, axisLabel: { formatter: fmt } }
const categoryAxis = { type: 'category', axisLine: { lineStyle: { color: '#3c4043' } } }

const mintVisualMap = (values: number[]) => ({
  min: 0,
  max: Math.max(...values),
  orient: 'horizontal' as const,
  left: 'center' as const,
  bottom: 0,
  textStyle: { color: '#9aa0a6' },
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
      legend: names.length > 1 ? { top: 24, textStyle: { color: '#9aa0a6' } } : undefined,
      grid: { ...base.value.grid, top: names.length > 1 ? 56 : 40 },
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
      legend: names.length > 1 ? { top: 24, textStyle: { color: '#9aa0a6' } } : undefined,
      grid: { ...base.value.grid, top: names.length > 1 ? 56 : 40 },
      xAxis: { ...valueAxis, name: chart.x, nameTextStyle: { color: '#9aa0a6' } },
      yAxis: { ...valueAxis, name: chart.y, nameTextStyle: { color: '#9aa0a6' } },
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
        cellSize: ['auto', 14],
        dayLabel: { color: '#9aa0a6', firstDay: 1 },
        monthLabel: { color: '#9aa0a6' },
        yearLabel: { color: '#e8eaed' },
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
      legend: { type: 'scroll', bottom: 0, textStyle: { color: '#9aa0a6' }, pageIconColor: '#b8f7e4' },
      color: PALETTE,
      series: [
        {
          type: 'pie',
          radius: ['42%', '66%'],
          center: ['50%', '50%'],
          minShowLabelAngle: 10,
          label: { color: '#e8eaed', formatter: '{b}: {d}%' },
          labelLayout: { hideOverlap: true },
          labelLine: { lineStyle: { color: '#3c4043' } },
          itemStyle: { borderColor: '#25272c', borderWidth: 2 },
          data: rows.map((r) => ({ name: String(r[chart.x]), value: Number(r[chart.y]) })),
        },
      ],
    }
  }

  if (chart.type === 'treemap') {
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
          label: { color: '#25272c', fontWeight: 600 },
          upperLabel: chart.series
            ? { show: true, color: '#e8eaed', height: 22 }
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
          label: { color: '#e8eaed' },
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

  // Horizontal bar: reverse so the top-ranked row renders at the top.
  const ordered = [...rows].reverse()
  return {
    ...base.value,
    tooltip: { valueFormatter: fmt },
    xAxis: valueAxis,
    yAxis: { ...categoryAxis, data: ordered.map((r) => String(r[chart.x])) },
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
    return Math.max(240, [...new Set(rows.map((r) => String(r[chart.y])))].length * 30 + 130)
  }
  if (chart.type === 'bar') return Math.max(220, rows.length * 26 + 60)
  if (chart.type === 'calendar') return 280
  if (chart.type === 'pie') return 380
  if (chart.type === 'treemap') return 400
  if (chart.type === 'sankey') {
    return Math.max(320, [...new Set(rows.map((r) => String(r[chart.y])))].length * 28 + 100)
  }
  return 320
})
</script>

<template>
  <div>
    <template v-if="descriptorValid">
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
    <p class="meta">
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
