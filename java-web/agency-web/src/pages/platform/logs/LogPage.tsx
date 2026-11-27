import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, DatePicker, Select, Space, Table, Tag, Tooltip } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import dayjs, { type Dayjs } from 'dayjs'
import { api, ApiError, qs } from '../../../lib/http'

/** 三种日志的行结构不同，但分页/筛选/表格骨架完全一样——统一用 Record<string, unknown> 装行，
 *  列定义按 type 切换。取字段统一走 s() 兜底，避免 undefined 直接渲染进表格。 */
type LogRow = Record<string, unknown>

const LEVEL_COLORS: Record<string, string> = {
  trace: 'default', debug: 'default', info: 'blue', warn: 'orange', error: 'red', fatal: 'red',
}

/** pino 落盘时 level 是**数字**（10=trace 20=debug 30=info 40=warn 50=error 60=fatal），
 *  Node 的 auditRouter 只在"过滤"时把数字转名字，返回给前端的仍是原始数字。
 *  所以展示层必须自己映射一次，否则表格里会出现一排 "30"。 */
const PINO_LEVEL_NAMES: Record<number, string> = {
  10: 'trace', 20: 'debug', 30: 'info', 40: 'warn', 50: 'error', 60: 'fatal',
}

function levelName(value: unknown): string {
  if (typeof value === 'number') return PINO_LEVEL_NAMES[value] ?? String(value)
  return String(value ?? '').toLowerCase()
}

/** 空值显示 —，其余转字符串。MySQL 的 COUNT/时间戳经 Node serialize 后类型不稳，统一 String 化最省心。 */
function s(value: unknown): string {
  return value === null || value === undefined || value === '' ? '—' : String(value)
}

/** 时间列统一格式化：库里存的是 **UTC 墙钟**（backend 的 mysql2 配了 timezone:'Z'），
 *  API 返回 `2026-11-27T02:08:45.747Z` 这种 ISO 串。
 *  直接 String() 打到表格上有两个毛病：
 *    1) T / Z 挤成一串，日期和时间连在一起看不清；
 *    2) 02:08 是 UTC，本机（UTC+8）实际是 10:08，用户会误以为"我明明有 2 点的数据却没查到"。
 *  dayjs(ISO) 会按浏览器时区解析，format 后就是本机时间。 */
function fmtTime(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  const d = dayjs(String(value))
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm:ss') : String(value)
}

/** 时间列统一用这个 render：monospace + nowrap，保证等宽对齐、永不折行 */
const renderTime = (v: unknown) => (
  <span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmtTime(v)}</span>
)

export default function LogPage({ type }: { type: 'login' | 'operation' | 'system' }) {
  const TITLE = type === 'login' ? '登录日志' : type === 'operation' ? '操作日志' : '系统日志（Node pino 文件尾部）'

  // 本机时区标签，给用户一个"表格里的时间按哪个时区解释"的锚点
  const tzOffsetHours = -new Date().getTimezoneOffset() / 60
  const tzLabel = `UTC${tzOffsetHours >= 0 ? '+' : ''}${tzOffsetHours}`

  // 列表状态：与 agency/OrdersPage 完全同一套写法（useCallback + useEffect）
  const [rows, setRows] = useState<LogRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(10)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 筛选状态：range 是"正在选择"的时间段，applied* 是"已点查询"生效的筛选——
  // 分开存的目的是 RangePicker 每次选面板都会触发 onChange，如果直接触达 load 会狂发请求。
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null)
  const [level, setLevel] = useState<string | undefined>(undefined)
  const [appliedFrom, setAppliedFrom] = useState<string | undefined>(undefined)
  const [appliedTo, setAppliedTo] = useState<string | undefined>(undefined)
  const [appliedLevel, setAppliedLevel] = useState<string | undefined>(undefined)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<{ list: LogRow[]; total: number; has_more: boolean }>(
        `/api/platform/logs${qs({ page, size, type, level: appliedLevel, from: appliedFrom, to: appliedTo })}`,
      )
      setRows(data.list)
      setTotal(data.total)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [page, size, type, appliedLevel, appliedFrom, appliedTo])

  useEffect(() => {
    void load()
  }, [load])

  // 点"查询"才把筛选落地
  function applyFilters() {
    setPage(1) // 筛选变了必须回第 1 页，否则可能停在一个不存在的页码上
    setAppliedFrom(range?.[0]?.toISOString()) // dayjs 的 toISOString() 产出 2026-11-26T08:00:00.000Z，满足 Node 的 ISO-8601 校验
    setAppliedTo(range?.[1]?.toISOString())
    setAppliedLevel(type === 'system' ? level : undefined) // level 只对 system 有效，其他类型强制丢弃
  }

  // 三种日志各一套列。render 里的 s() 全部走兜底。
  const columns: ColumnsType<LogRow> =
    type === 'login'
      ? [
          { title: '时间', dataIndex: 'created_at', width: 180, render: renderTime },
          { title: '账号（脱敏）', dataIndex: 'login_name', width: 140, render: s },
          {
            title: '结果', dataIndex: 'result', width: 90,
            render: (v: unknown) => (
              <Tag color={v === 'SUCCESS' ? 'green' : 'red'}>{s(v)}</Tag>
            ),
          },
          { title: '失败原因', dataIndex: 'failure_reason', width: 120, render: s },
          { title: 'IP', dataIndex: 'login_ip', width: 130, render: s },
          { title: 'User-Agent', dataIndex: 'user_agent', ellipsis: true, render: (v) => <Tooltip title={s(v)}>{s(v)}</Tooltip> },
          { title: 'trace_id', dataIndex: 'trace_id', width: 120, ellipsis: true, render: s },
        ]
      : type === 'operation'
        ? [
            { title: '时间', dataIndex: 'created_at', width: 180, render: renderTime },
            { title: '操作', dataIndex: 'action', width: 160, render: s },
            { title: '方法', dataIndex: 'request_method', width: 80, render: s },
            { title: '路径', dataIndex: 'request_path', ellipsis: true, render: s },
            { title: '状态码', dataIndex: 'status_code', width: 80, render: s },
            {
              title: '结果', dataIndex: 'result', width: 90,
              render: (v: unknown) => <Tag color={v === 'SUCCESS' ? 'green' : 'red'}>{s(v)}</Tag>,
            },
            { title: '客户端 IP', dataIndex: 'client_ip', width: 130, render: s },
            { title: 'User-Agent', dataIndex: 'ua', ellipsis: true, render: (v) => <Tooltip title={s(v)}>{s(v)}</Tooltip> },
            { title: 'trace_id', dataIndex: 'trace_id', width: 120, ellipsis: true, render: s },
          ]
        : [
            { title: '时间', dataIndex: 'time', width: 180, render: renderTime },
            {
              title: '级别', dataIndex: 'level', width: 90,
              // level 是 pino 的数字级别，必须先映射成名字再上色，否则 LEVEL_COLORS 永远命中 default
              render: (v: unknown) => {
                const name = levelName(v)
                return <Tag color={LEVEL_COLORS[name] ?? 'default'}>{name.toUpperCase()}</Tag>
              },
            },
            // 内容字段：本项目 logger 用的是 `event`（如 auth.login），标准 pino 才会用 `msg`。
            // 两个都取，先 msg 后 event，兼容两种写法。
            {
              title: '内容', dataIndex: 'event', ellipsis: true,
              render: (_: unknown, row: LogRow) => <Tooltip title={s(row.msg ?? row.event)}>{s(row.msg ?? row.event)}</Tooltip>,
            },
            { title: 'trace_id', dataIndex: 'trace_id', width: 120, ellipsis: true, render: s },
          ]

  return (
    <Card
      title={TITLE}
      extra={
        <Space wrap>
          <DatePicker.RangePicker
            showTime // 日志精确到毫秒，不开 showTime 只能选到"天"，过滤没意义
            format="YYYY-MM-DD HH:mm" // 显示到分钟就够，秒全打出来输入框会挤成两行
            value={range}
            onChange={(values) => setRange(values && values[0] && values[1] ? [values[0], values[1]] : null)}
          />
          <Select
            allowClear
            placeholder="级别"
            style={{ width: 110 }}
            disabled={type !== 'system'} // Node 契约：level 仅 system 有效
            value={level}
            onChange={(v) => setLevel(v)}
            options={['trace', 'debug', 'info', 'warn', 'error', 'fatal'].map((v) => ({ value: v, label: v.toUpperCase() }))}
          />
          <Button type="primary" onClick={applyFilters}>查询</Button>
          <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading} />
        </Space>
      }
    >
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      <div style={{ marginBottom: 10, color: '#8c8c8c', fontSize: 12 }}>
        表格内时间为本机时区（{tzLabel}）；筛选取的也是本地时间，查询时会自动换算成 UTC 去库里比对。
      </div>
      <Table<LogRow>
        rowKey={type === 'system' ? (_, index) => `sys-${index}` : 'id'}
        loading={loading}
        dataSource={rows}
        pagination={{
          current: page, pageSize: size, total,
          showSizeChanger: true,
          showTotal: (value) => `共 ${value} 条`,
          onChange: (nextPage, nextSize) => { setPage(nextPage); setSize(nextSize) },
        }}
        columns={columns}
      />
    </Card>
  )
}