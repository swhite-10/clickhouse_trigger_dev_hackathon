<script setup lang="ts">
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, TitleComponent } from 'echarts/components'
import VChart from 'vue-echarts'

use([CanvasRenderer, BarChart, GridComponent, TooltipComponent, TitleComponent])

// Renders a tool result of shape { rows, durationMs, chart: {type, x, y, title} }.
// The tier-3 agent will emit richer descriptors; this validates the contract.
const props = defineProps<{
  output: {
    rows: Record<string, string | number>[]
    durationMs: number
    chart: { type: string; x: string; y: string; title: string }
  }
}>()

const option = computed(() => {
  const { rows, chart } = props.output
  const ordered = [...rows].reverse()
  return {
    title: { text: chart.title, textStyle: { color: '#e8eaed', fontSize: 14 } },
    textStyle: { color: '#9aa0a6' },
    tooltip: {},
    grid: { left: 10, right: 30, top: 40, bottom: 10, containLabel: true },
    xAxis: { type: 'value', splitLine: { lineStyle: { color: '#3c4043' } } },
    yAxis: { type: 'category', data: ordered.map((r) => r[chart.x]) },
    series: [
      {
        type: 'bar',
        data: ordered.map((r) => r[chart.y]),
        itemStyle: { color: '#b8f7e4', borderRadius: [0, 4, 4, 0] },
      },
    ],
  }
})

const height = computed(() => Math.max(220, props.output.rows.length * 26 + 60))
</script>

<template>
  <div>
    <VChart :option="option" :autoresize="true" :style="{ height: `${height}px`, width: '100%' }" />
    <p class="meta">{{ output.rows.length }} rows · {{ output.durationMs }}ms in ClickHouse</p>
  </div>
</template>

<style scoped>
.meta {
  color: #9aa0a6;
  font-size: 0.8rem;
  margin: 0.25rem 0 0;
}
</style>
