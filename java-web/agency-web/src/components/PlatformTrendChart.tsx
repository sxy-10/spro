import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { PlatformTrendPoint } from '../lib/types'

// 按需注册：折线 + 柱状 + 三件套组件，避免全量 echarts 推高包体
echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

/**
 * 平台端通用趋势图：订单量（柱）/ 访问量（线）共用左轴，成交额（线）独立右轴。
 *
 * 口径注释（与订单管理、财务结算两页保持一致）：
 * - 订单量 / 成交额 = tour_order 全部状态按天聚合（总览、分析页共用 Node 端趋势查询）
 * - 财务页 GMV 是更严格的口径：PAID + CONFIRMED + COMPLETED
 */
export default function PlatformTrendChart({ data, height = 280 }: { data: PlatformTrendPoint[]; height?: number }) {
  const container = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!container.current) return
    const chart = echarts.init(container.current)
    chart.setOption({
      grid: { left: 48, right: 60, top: 32, bottom: 28 },
      tooltip: { trigger: 'axis' },
      legend: { data: ['订单量', '访问量', '成交额'], right: 0, top: 0 },
      xAxis: { type: 'category', data: data.map((point) => point.day.slice(5, 10)) },
      yAxis: [
        { type: 'value', name: '笔/人次' },
        { type: 'value', name: '¥', splitLine: { show: false } },
      ],
      series: [
        { name: '订单量', type: 'bar', barMaxWidth: 18, data: data.map((point) => Number(point.orders)) },
        { name: '访问量', type: 'line', smooth: true, data: data.map((point) => Number(point.visits)) },
        {
          name: '成交额',
          type: 'line',
          smooth: true,
          yAxisIndex: 1,
          data: data.map((point) => Number(point.amount)),
        },
      ],
    })
    const resize = () => chart.resize()
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      chart.dispose()
    }
  }, [data, height])

  return <div ref={container} style={{ height, width: '100%' }} />
}
