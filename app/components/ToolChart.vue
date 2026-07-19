<script setup lang="ts">
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, TitleComponent, LegendComponent } from 'echarts/components'
import VChart from 'vue-echarts'

use([CanvasRenderer, BarChart, LineChart, GridComponent, TooltipComponent, TitleComponent, LegendComponent])

type Row = Record<string, unknown>

const props = defineProps<{
  output: {
    rows: Row[]
    durationMs: number
    truncated?: boolean
    chart: { type: string; x: string; y: string; series?: string; title: string }
  }
}>()

const PALETTE = ['#b8f7e4', '#7ec8f7', '#f7d78e', '#f79ec8', '#a89ef7', '#9ef7a8']

// The agent's descriptor is a claim about the result shape — verify it before
// charting, and fall back to a table when it doesn't hold.
const descriptorValid = computed(() => {
  const { rows, chart } = props.output
  if (rows.length === 0) return false
  const cols = Object.keys(rows[0] ?? {})
  if (!cols.includes(chart.x) || !cols.includes(chart.y)) return false
  if (chart.series && !cols.includes(chart.series)) return false
  return chart.type === 'bar' || chart.type === 'line'
})

const columns = computed(() => Object.keys(props.output.rows[0] ?? {}))

const option = computed(() => {
  const { rows, chart } = props.output
  const base = {
    title: { text: chart.title, textStyle: { color: '#e8eaed', fontSize: 14 } },
    textStyle: { color: '#9aa0a6' },
    tooltip: { trigger: chart.type === 'line' ? 'axis' : 'item' },
    grid: { left: 10, right: 30, top: 40, bottom: 10, containLabel: true },
  }

  if (chart.type === 'line') {
    const xs = [...new Set(rows.map((r) => String(r[chart.x])))]
    const names = chart.series ? [...new Set(rows.map((r) => String(r[chart.series!])))] : [chart.y]
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
        data: xs.map((x) => byX.get(x) ?? null),
        lineStyle: { width: 2, color: PALETTE[i % PALETTE.length] },
        itemStyle: { color: PALETTE[i % PALETTE.length] },
      }
    })
    return {
      ...base,
      legend: names.length > 1 ? { top: 24, textStyle: { color: '#9aa0a6' } } : undefined,
      grid: { ...base.grid, top: names.length > 1 ? 56 : 40 },
      xAxis: { type: 'category', data: xs, axisLine: { lineStyle: { color: '#3c4043' } } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: '#3c4043' } } },
      series,
    }
  }

  // Horizontal bar: reverse so the top-ranked row renders at the top.
  const ordered = [...rows].reverse()
  return {
    ...base,
    xAxis: { type: 'value', splitLine: { lineStyle: { color: '#3c4043' } } },
    yAxis: { type: 'category', data: ordered.map((r) => String(r[chart.x])) },
    series: [
      {
        type: 'bar',
        data: ordered.map((r) => Number(r[chart.y])),
        itemStyle: { color: '#b8f7e4', borderRadius: [0, 4, 4, 0] },
      },
    ],
  }
})

const height = computed(() =>
  props.output.chart.type === 'line' ? 320 : Math.max(220, props.output.rows.length * 26 + 60),
)
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
