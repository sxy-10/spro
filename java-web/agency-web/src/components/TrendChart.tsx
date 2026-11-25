import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { DashboardTrendPoint } from '../lib/types'

// 按需注册：全量 echarts 会把包体推到 2MB+，这里只用到折线图 + 三件套组件
echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

/** 14 天趋势：访问 / 生成行程 / 下单三条线。 */
export default function TrendChart({ data, height = 260 }: { data: DashboardTrendPoint[]; height?: number }) {
  const container = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!container.current) return
    const chart = echarts.init(container.current)
    chart.setOption({
      grid: { left: 40, right: 16, top: 32, bottom: 28 },
      tooltip: { trigger: 'axis' },
      legend: { data: ['访问', '生成行程', '下单'], right: 0, top: 0 },
      xAxis: { type: 'category', data: data.map((point) => point.day.slice(5)) },
      yAxis: { type: 'value' },
      series: [
        { name: '访问', type: 'line', smooth: true, data: data.map((point) => point.visits) },
        { name: '生成行程', type: 'line', smooth: true, data: data.map((point) => point.plans) },
        { name: '下单', type: 'line', smooth: true, data: data.map((point) => point.orders) },
      ],
    })
    const resize = () => chart.resize()
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      chart.dispose()
    }
  }, [data])

  return <div ref={container} style={{ height, width: '100%' }} />
}
