import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert, Button, Card, InputNumber, Modal, Select, Space, Table, Tag, message } from 'antd'
import { api, ApiError, qs } from '../../lib/http'
import type { PageResult, RouteRow, StockView } from '../../lib/types'
import { Permission } from '../../components/Permission'

type StockDate = StockView['dates'][number]

export default function StockPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const routeId = searchParams.get('routeId') ?? undefined
  const [routes, setRoutes] = useState<RouteRow[]>([])
  const [stock, setStock] = useState<StockView | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<StockDate | null>(null)
  const [seats, setSeats] = useState<number>(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const data = await api.get<PageResult<RouteRow>>(`/api/agency/routes${qs({ page: 1, size: 100, sort: '-created_at' })}`)
        setRoutes(data.list)
        if (!routeId && data.list.length > 0) {
          setSearchParams({ routeId: data.list[0].id }, { replace: true })
        }
      } catch (e) {
        setError(e instanceof ApiError ? e.message : String(e))
      }
    })()
    // routeId 变化不需要重新拉线路列表
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadStock = useCallback(async () => {
    if (!routeId) return
    setLoading(true)
    setError(null)
    try {
      setStock(await api.get<StockView>(`/api/agency/stock/${routeId}`))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
      setStock(null)
    } finally {
      setLoading(false)
    }
  }, [routeId])

  useEffect(() => {
    void loadStock()
  }, [loadStock])

  async function submit() {
    if (!routeId || !editing) return
    setBusy(true)
    try {
      await api.put(`/api/agency/stock/${routeId}`, { travel_date: editing.travel_date, total_seats: seats })
      message.success(`${editing.travel_date} 名额已更新为 ${seats}`)
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
          <Select
            showSearch
            optionFilterProp="label"
            style={{ width: 280 }}
            placeholder="选择线路"
            value={routeId}
            onChange={(value) => setSearchParams({ routeId: value })}
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
      <Table<StockDate>
        rowKey="travel_date"
        loading={loading}
        dataSource={stock?.dates ?? []}
        pagination={false}
        locale={{ emptyText: '未来 14 天还没有排期库存' }}
        columns={[
          { title: '出行日期', dataIndex: 'travel_date', width: 140 },
          { title: '总名额', dataIndex: 'total_seats', width: 100 },
          { title: '已锁定', dataIndex: 'locked_seats', width: 100 },
          { title: '已售出', dataIndex: 'sold_seats', width: 100 },
          {
            title: '可售',
            dataIndex: 'available_seats',
            width: 100,
            render: (value: number) => <Tag color={value <= 5 ? 'red' : 'green'}>{value}</Tag>,
          },
          {
            title: '操作',
            width: 120,
            render: (_, row) => (
              <Permission code="route:line:update">
                <a
                  onClick={() => {
                    setEditing(row)
                    setSeats(row.total_seats)
                  }}
                >
                  修改名额
                </a>
              </Permission>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? `修改 ${editing.travel_date} 的名额` : '修改名额'}
        open={Boolean(editing)}
        onCancel={() => setEditing(null)}
        onOk={() => void submit()}
        okText="保存"
        confirmLoading={busy}
      >
        <p style={{ marginTop: 0, color: '#8c8c8c' }}>
          当前已锁定 {editing?.locked_seats ?? 0} 席、已售出 {editing?.sold_seats ?? 0} 席。
        </p>
        <InputNumber
          min={(editing?.locked_seats ?? 0) + (editing?.sold_seats ?? 0)}
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
