import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert, Card, InputNumber, Modal, Select, Space, Table, Tag, Typography, message } from 'antd'
import { api, ApiError, qs } from '../../lib/http'
import type { PageResult, RouteRow, StockAllRow, StockAllView, StockView } from '../../lib/types'
import { Permission } from '../../components/Permission'

const { Text } = Typography

/** 统一表格行：全部线路 / 单线路两种视图归一化后的形状。 */
interface StockRow {
  routeId: string
  routeLabel: string
  travelDate: string
  total: number
  locked: number
  sold: number
  available: number
}

export default function StockPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const routeId = searchParams.get('routeId') ?? undefined
  const [routes, setRoutes] = useState<RouteRow[]>([])
  const [rows, setRows] = useState<StockRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<StockRow | null>(null)
  const [seats, setSeats] = useState<number>(0)
  const [busy, setBusy] = useState(false)

  // 线路下拉选项；不再自动选中第一条，默认展示全部线路的库存
  useEffect(() => {
    void (async () => {
      try {
        const data = await api.get<PageResult<RouteRow>>(`/api/agency/routes${qs({ page: 1, size: 100, sort: '-created_at' })}`)
        setRoutes(data.list)
      } catch (e) {
        setError(e instanceof ApiError ? e.message : String(e))
      }
    })()
  }, [])

  const loadStock = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (routeId) {
        const data = await api.get<StockView>(`/api/agency/stock/${routeId}`)
        setRows(
          data.dates.map((d) => ({
            routeId,
            routeLabel: data.title,
            travelDate: d.travel_date.slice(0, 10),
            total: Number(d.total_seats),
            locked: Number(d.locked_seats),
            sold: Number(d.sold_seats),
            available: Number(d.available_seats),
          })),
        )
      } else {
        const data = await api.get<StockAllView>('/api/agency/stock')
        setRows(
          data.dates.map((d: StockAllRow) => ({
            routeId: d.route_id,
            routeLabel: `${d.product_no} · ${d.route_title}`,
            travelDate: d.travel_date.slice(0, 10),
            total: Number(d.total_seats),
            locked: Number(d.locked_seats),
            sold: Number(d.sold_seats),
            available: Number(d.available_seats),
          })),
        )
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [routeId])

  useEffect(() => {
    void loadStock()
  }, [loadStock])

  const columns = useMemo(() => {
    const base = [
      ...(routeId
        ? []
        : [
            {
              title: '线路',
              dataIndex: 'routeLabel',
              ellipsis: true,
            },
          ]),
      { title: '出行日期', dataIndex: 'travelDate', width: routeId ? 140 : 120 },
      { title: '总名额', dataIndex: 'total', width: 90, align: 'right' as const },
      { title: '已锁定', dataIndex: 'locked', width: 90, align: 'right' as const },
      { title: '已售出', dataIndex: 'sold', width: 90, align: 'right' as const },
      {
        title: '可售',
        dataIndex: 'available',
        width: 90,
        align: 'right' as const,
        render: (value: number) => <Tag color={value <= 5 ? 'red' : 'green'}>{value}</Tag>,
      },
      {
        title: '操作',
        width: 110,
        render: (_: unknown, row: StockRow) => (
          <Permission code="route:line:update">
            <a
              onClick={() => {
                setEditing(row)
                setSeats(row.total)
              }}
            >
              修改名额
            </a>
          </Permission>
        ),
      },
    ]
    return base
  }, [routeId])

  async function submit() {
    if (!editing) return
    setBusy(true)
    try {
      await api.put(`/api/agency/stock/${editing.routeId}`, { travel_date: editing.travelDate, total_seats: seats })
      message.success(`${editing.routeLabel} ${editing.travelDate} 名额已更新为 ${seats}`)
      setEditing(null)
      await loadStock()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      title="库存管理"
      extra={
        <Space>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {routeId ? '单线路视图' : `全部线路 · ${rows.length} 条`}
          </Text>
          <Select
            showSearch
            allowClear
            optionFilterProp="label"
            style={{ width: 280 }}
            placeholder="全部线路"
            value={routeId ?? null}
            onChange={(value) => setSearchParams(value ? { routeId: value } : {})}
            options={routes.map((route) => ({ value: route.id, label: `${route.product_no} · ${route.title}` }))}
          />
        </Space>
      }
    >
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="名额只能调不能低于「已锁定 + 已售出」；预热/补库存由定时任务负责，本页不提供手动触发。"
      />
      <Table<StockRow>
        rowKey={(row) => `${row.routeId}-${row.travelDate}`}
        loading={loading}
        dataSource={rows}
        pagination={rows.length > 20 ? { pageSize: 20, showSizeChanger: false, showTotal: (t) => `共 ${t} 条` } : false}
        locale={{ emptyText: routeId ? '该线路未来还没有排期库存' : '还没有任何线路的排期库存' }}
        columns={columns}
      />

      <Modal
        title={editing ? `修改 ${editing.routeLabel} ${editing.travelDate} 的名额` : '修改名额'}
        open={Boolean(editing)}
        onCancel={() => setEditing(null)}
        onOk={() => void submit()}
        okText="保存"
        confirmLoading={busy}
      >
        <p style={{ marginTop: 0, color: '#8c8c8c' }}>
          当前已锁定 {editing?.locked ?? 0} 席、已售出 {editing?.sold ?? 0} 席。
        </p>
        <InputNumber
          min={(editing?.locked ?? 0) + (editing?.sold ?? 0)}
          max={1000}
          value={seats}
          onChange={(value) => setSeats(Number(value ?? 0))}
          style={{ width: 200 }}
          addonAfter="席"
        />
      </Modal>
    </Card>
  )
}
