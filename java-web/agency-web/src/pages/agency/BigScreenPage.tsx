/**
 * 运营实时大屏（S4 重写，迁自 frontend/agency-web/src/pages/BigScreen.tsx）。
 *
 * 与旧版的三处差别，都是 S4 的口径要求：
 *   1. **四个数字走只读预聚合**：轮询 `GET /api/agency/dashboard-metrics`（数据源是
 *      Redis `dashboard:preagg`，由 `dashboard-preagg` 定时任务覆盖写）。
 *      停掉那个任务后 `generated_at` 不再前进、数字原地停住 —— 验收判据 11；
 *   2. **图表用 ECharts**（按需注册 line/grid/legend/tooltip，不引全量包），
 *      画的是最近 24 次快照变化，而不是前端自己算的实时值；
 *   3. **实时域仍然走长连接**：`/api/stats/live` 是 SSE，连接前先换一次性 ticket，
 *      URL 里只有票根、没有 token。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { api } from '../../lib/http'
import { openLiveStats, type LiveSnapshot } from '../../lib/statsSse'

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

/** 轮询周期：与预聚合任务的 5 分钟周期解耦，页面 5 秒看一次"快照更新时间"。 */
const POLL_MS = 5000
/** 曲线保留 24 拍 ≈ 2 分钟。 */
const HISTORY_LIMIT = 24
/** 超过这个时间没更新就判"停更"：预聚合周期 5 分钟 + 1 分钟宽限。 */
const STALE_AFTER_MS = 6 * 60 * 1000

interface DashboardMetrics {
  onsale_count: number
  today_orders: number
  pending_confirms: number
  today_amount: string
  generated_at: string | null
  source: 'preagg' | 'preagg_pending'
}

interface TrendPoint {
  label: string
  orders: number
  pending: number
  onsale: number
}

const amountText = (value: string): string => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return `¥ ${value}`
  return `¥ ${parsed.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const ageText = (millis: number): string => {
  if (millis < 60_000) return `${Math.max(0, Math.round(millis / 1000))} 秒前`
  if (millis < 3_600_000) return `${Math.floor(millis / 60_000)} 分钟前`
  return `${(millis / 3_600_000).toFixed(1)} 小时前`
}

export default function BigScreenPage() {
  /* ---------------- 预聚合（四个数字 + 曲线） ---------------- */

  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null)
  const [trend, setTrend] = useState<TrendPoint[]>([])
  const [pollError, setPollError] = useState('')
  const [lastPollAt, setLastPollAt] = useState<number>(0)
  const [agesMillis, setAgesMillis] = useState<number>(0)

  /* ---------------- 实时域（SSE） ---------------- */

  const [live, setLive] = useState<LiveSnapshot | null>(null)
  const [liveConnected, setLiveConnected] = useState(false)
  const [liveDown, setLiveDown] = useState('')

  const chartHost = useRef<HTMLDivElement | null>(null)
  /** 用 ReturnType 取实例类型：echarts/core 导出的是 EChartsType，写成 echarts.ECharts 会取不到 */
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null)

  const pollMetrics = useCallback(async () => {
    try {
      const data = await api.get<DashboardMetrics>('/api/agency/dashboard-metrics')
      setMetrics(data)
      setPollError('')
      setLastPollAt(Date.now())
      const label = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      setTrend((prev) => {
        const point: TrendPoint = {
          label,
          orders: Number(data.today_orders ?? 0),
          pending: Number(data.pending_confirms ?? 0),
          onsale: Number(data.onsale_count ?? 0),
        }
        const last = prev[prev.length - 1]
        // 快照没变时不重复记点：曲线变平正是"停更"的直观证据
        if (last && last.orders === point.orders && last.pending === point.pending && last.onsale === point.onsale) {
          return prev
        }
        const next = [...prev, point]
        return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next
      })
    } catch (error) {
      setPollError(error instanceof Error ? error.message : '预聚合读取失败')
    }
  }, [])

  useEffect(() => {
    void pollMetrics()
    const timer = setInterval(() => void pollMetrics(), POLL_MS)
    return () => clearInterval(timer)
  }, [pollMetrics])

  /* 每 1 秒算一次"快照距今多久"：停更时这个数字一直涨，比任何日志都直观 */
  useEffect(() => {
    const tick = () => {
      const generatedAt = metrics?.generated_at
      setAgesMillis(generatedAt ? Date.now() - Date.parse(generatedAt) : 0)
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [metrics?.generated_at])

  /* ---------------- ECharts：初始化一次，数据变化只 setOption ---------------- */

  useEffect(() => {
    const host = chartHost.current
    if (!host) return
    const chart = echarts.init(host)
    chartRef.current = chart
    const resize = () => chart.resize()
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    chartRef.current?.setOption(
      {
        backgroundColor: 'transparent',
        grid: { left: 56, right: 24, top: 44, bottom: 32 },
        tooltip: { trigger: 'axis' },
        legend: { data: ['今日订单', '待确认', '在售线路'], textStyle: { color: '#cbd5e1' }, top: 6 },
        xAxis: {
          type: 'category',
          data: trend.map((point) => point.label),
          axisLabel: { color: '#94a3b8' },
          axisLine: { lineStyle: { color: 'rgba(148,163,184,0.4)' } },
        },
        yAxis: {
          type: 'value',
          axisLabel: { color: '#94a3b8' },
          splitLine: { lineStyle: { color: 'rgba(148,163,184,0.18)' } },
        },
        series: [
          { name: '今日订单', type: 'line', smooth: true, symbol: 'circle', symbolSize: 5, data: trend.map((p) => p.orders), color: '#38bdf8' },
          { name: '待确认', type: 'line', smooth: true, symbol: 'circle', symbolSize: 5, data: trend.map((p) => p.pending), color: '#fbbf24' },
          { name: '在售线路', type: 'line', smooth: true, symbol: 'circle', symbolSize: 5, data: trend.map((p) => p.onsale), color: '#34d399' },
        ],
      },
      true,
    )
  }, [trend])

  /* ---------------- 实时域 SSE（连接前换 ticket） ---------------- */

  useEffect(() => {
    const handle = openLiveStats({
      onOpen: () => {
        setLiveConnected(true)
        setLiveDown('')
      },
      onStats: (snapshot) => setLive(snapshot),
      onDown: (reason) => {
        setLiveConnected(false)
        setLiveDown(reason)
      },
    })
    return () => handle.close()
  }, [])

  /* ---------------- 派生状态 ---------------- */

  const stale = Boolean(metrics?.generated_at) && agesMillis > STALE_AFTER_MS
  const pendingPreagg = metrics?.source === 'preagg_pending' || !metrics?.generated_at
  const connText = pollError ? `轮询失败（${pollError}）` : stale ? '预聚合停更' : '预聚合正常'

  const refreshNow = async () => {
    try {
      await api.post('/api/internal/timers/dashboard-preagg', {})
      await pollMetrics()
    } catch (error) {
      setPollError(error instanceof Error ? error.message : '预聚合任务触发失败')
    }
  }

  return (
    <div className="ops-embed">
      <div className="bigscreen">
        <header className="bs-header">
          <div>
            <h1>运营实时大屏</h1>
            <div className="bs-sub">
              四个数字 = GET /api/agency/dashboard-metrics（只读 Redis 预聚合 · 每 5s 轮询）｜
              实时域 = GET /api/stats/live（SSE · 一次性 ticket 鉴权）
            </div>
          </div>
          <div className="bs-conn">
            <span className={`bs-conn-dot ${!pollError && !stale ? 'on' : ''}`} />
            <span className={pollError || stale ? 'bs-conn-down' : ''}>{connText}</span>
            {lastPollAt > 0 && (
              <span className="bs-ts">
                轮询于 {new Date(lastPollAt).toLocaleTimeString('zh-CN')} · 生成于{' '}
                {pendingPreagg ? '—' : ageText(agesMillis)}
              </span>
            )}
          </div>
        </header>

        {pollError && <div className="bs-error-banner">⚠ {pollError}（每 5s 自动重试）</div>}
        {pendingPreagg && !pollError && (
          <div className="bs-down-banner">
            预聚合尚未生成：等 dashboard-preagg 任务跑一轮，或点下方「立即预聚合」。
          </div>
        )}
        {stale && !pollError && (
          <div className="bs-down-banner">
            预聚合已 {ageText(agesMillis)} 未更新（周期 5 分钟）—— 说明 dashboard-preagg 任务没在跑，
            四个数字保持在最后一轮的结果（这正是验收判据 11 的现象）。
          </div>
        )}

        <div className="bs-grid">
          <div className="bs-card">
            <div className="bs-label">在售线路</div>
            <div className="bs-value">
              <span className="bs-number">{(metrics?.onsale_count ?? 0).toLocaleString('zh-CN')}</span>
            </div>
            <div className="bs-foot">预聚合：travel_product.status = ON_SALE</div>
          </div>
          <div className="bs-card">
            <div className="bs-label">今日订单</div>
            <div className="bs-value">
              <span className="bs-number">{(metrics?.today_orders ?? 0).toLocaleString('zh-CN')}</span>
            </div>
            <div className="bs-foot">预聚合：tour_order 当日起单数（UTC 日界）</div>
          </div>
          <div className="bs-card">
            <div className="bs-label">待确认</div>
            <div className="bs-value">
              <span className="bs-number">{(metrics?.pending_confirms ?? 0).toLocaleString('zh-CN')}</span>
            </div>
            <div className="bs-foot">
              PENDING / PAID 未确认订单
              {(metrics?.pending_confirms ?? 0) > 0 && <span className="bs-degraded-tag">需处理</span>}
            </div>
          </div>
          <div className="bs-card">
            <div className="bs-label">今日成交额</div>
            <div className="bs-value">
              <span className="bs-number" style={{ fontSize: 28 }}>
                {amountText(metrics?.today_amount ?? '0')}
              </span>
            </div>
            <div className="bs-foot">预聚合：PAID / CONFIRMED / COMPLETED 合计</div>
          </div>
        </div>

        <div className="bs-card" style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="bs-label">预聚合走势（{trend.length} 个快照变化点）</div>
            <button
              type="button"
              onClick={() => void refreshNow()}
              style={{
                background: 'rgba(56,189,248,0.16)',
                color: '#7dd3fc',
                border: '1px solid rgba(56,189,248,0.45)',
                borderRadius: 8,
                padding: '4px 12px',
                cursor: 'pointer',
              }}
            >
              立即预聚合
            </button>
          </div>
          <div ref={chartHost} style={{ height: 240, width: '100%' }} />
        </div>

        <div className="bs-grid" style={{ marginTop: 18, gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div className="bs-card">
            <div className="bs-label">在线人数（SSE 实时）</div>
            <div className="bs-value">
              <span className="bs-number">{live?.online_count ?? 0}</span>
              <span className="bs-online-conn">（连接 {live?.online_conn ?? 0}）</span>
            </div>
            <div className="bs-foot">
              {liveConnected ? '实时域已连接 · 每 5s 推送' : liveDown ? `实时域重连中（${liveDown}）` : '连接中…'}
            </div>
          </div>
          <div className="bs-card">
            <div className="bs-label">消息吞吐（SSE 实时）</div>
            <div className="bs-value">
              <span className="bs-number">{live?.message_count ?? 0}</span>
            </div>
            <div className="bs-foot">Redis im:stat:msg，缺失回退当日 SQL</div>
          </div>
          <div className="bs-card">
            <div className="bs-label">秒杀 QPS（SSE 实时）</div>
            <div className="bs-value">
              <span className="bs-number">{(live?.seckill_qps ?? 0).toFixed(2)}</span>
            </div>
            <div className="bs-foot">最近 10s 成交订单数 ÷ 10</div>
          </div>
        </div>

        <footer className="bs-footer">
          演示提示：①「立即预聚合」→ 四个数字与生成时间一起变；②把 application.yml 的
          app.internal.timers-enabled 改成 false（或只停 dashboard-preagg）→ 生成时间不再前进、曲线走平，
          数字停在最后一轮（判据 11）；③游客端发消息 → 「消息吞吐」下一拍 +1，证明 SSE 长连接与票根鉴权都活着。
        </footer>
      </div>
    </div>
  )
}
