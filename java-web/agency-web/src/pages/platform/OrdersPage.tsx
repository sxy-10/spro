import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, Input, Select, Space, Table, Tag, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { api, ApiError, qs } from '../../lib/http'
import type { AgencyRow, PageResult, PlatformOrderRow } from '../../lib/types'

const { Text } = Typography

/** MySQL DATETIME 经 Node serialize 是 ISO 串，统一转 YYYY-MM-DD HH:mm:ss */
const fmtTime = (value: string | null) => (value ? value.slice(0, 19).replace('T', ' ') : value)

/** 状态口径与商家端订单管理一致；平台端只读监督，没有确认/取消操作。 */
const ORDER_STATUS: Record<PlatformOrderRow['status'], { text: string; color: string }> = {
  PENDING: { text: '待支付', color: 'default' },
  PAID: { text: '待确认', color: 'orange' },
  CONFIRMED: { text: '已确认', color: 'green' },
  CANCELLED: { text: '已取消', color: 'default' },
  COMPLETED: { text: '已完成', color: 'blue' },
  REFUNDED: { text: '已退款', color: 'red' },
}

export default function OrdersPage() {
  const [rows, setRows] = useState<PlatformOrderRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(10)
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState<string | undefined>()
  const [agencyId, setAgencyId] = useState<string | undefined>()
  const [sort, setSort] = useState('-created_at')
  const [agencies, setAgencies] = useState<AgencyRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<PageResult<PlatformOrderRow>>(
        `/api/platform/orders${qs({ page, size, sort, keyword, status, agencyId })}`,
      )
      setRows(data.list)
      setTotal(data.total)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [page, size, sort, keyword, status, agencyId])

  useEffect(() => {
    void load()
  }, [load])

  // 机构筛选下拉：一次性拉前 50 家，够演示用
  useEffect(() => {
    api
      .get<PageResult<AgencyRow>>('/api/platform/agencies?page=1&size=50')
      .then((data) => setAgencies(data.list))
      .catch(() => setAgencies([]))
  }, [])

  return (
    <Card
      title="订单监督（全量只读）"
      extra={
        <Space>
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="按机构筛选"
            style={{ width: 200 }}
            value={agencyId}
            onChange={(value) => {
              setAgencyId(value)
              setPage(1)
            }}
            options={agencies.map((a) => ({ value: a.agency_id, label: a.agency_name }))}
          />
          <Select
            allowClear
            placeholder="订单状态"
            style={{ width: 120 }}
            value={status}
            onChange={(value) => {
              setStatus(value)
              setPage(1)
            }}
            options={Object.entries(ORDER_STATUS).map(([value, meta]) => ({ value, label: meta.text }))}
          />
          <Select
            placeholder="排序"
            style={{ width: 130 }}
            value={sort}
            onChange={(value) => {
              setSort(value)
              setPage(1)
            }}
            options={[
              { value: '-created_at', label: '最新下单' },
              { value: '-total_amount', label: '金额最高' },
            ]}
          />
          <Input.Search
            allowClear
            placeholder="订单号 / 手机号"
            style={{ width: 200 }}
            onSearch={(value) => {
              setKeyword(value.trim())
              setPage(1)
            }}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading} />
        </Space>
      }
    >
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      <Table<PlatformOrderRow>
        rowKey="order_id"
        loading={loading}
        dataSource={rows}
        pagination={{
          current: page,
          pageSize: size,
          total,
          showSizeChanger: true,
          showTotal: (value) => `共 ${value} 条`,
          onChange: (nextPage, nextSize) => {
            setPage(nextPage)
            setSize(nextSize)
          },
        }}
        columns={[
          { title: '订单号', dataIndex: 'order_no', width: 190, render: (v: string) => <Text code>{v}</Text> },
          { title: '所属机构', dataIndex: 'agency_name', width: 150, ellipsis: true },
          { title: '线路', dataIndex: 'route_title', ellipsis: true },
          { title: '人数', dataIndex: 'people_count', width: 70, align: 'right' },
          { title: '金额', dataIndex: 'amount', width: 100, align: 'right', render: (v: string) => `¥${v}` },
          {
            title: '状态',
            dataIndex: 'status',
            width: 90,
            render: (v: PlatformOrderRow['status']) => <Tag color={ORDER_STATUS[v]?.color}>{ORDER_STATUS[v]?.text ?? v}</Tag>,
          },
          { title: '出行日期', dataIndex: 'travel_date', width: 110, render: (v: string | null) => v?.slice(0, 10) ?? '—' },
          { title: '联系人', dataIndex: 'contact_name', width: 90 },
          { title: '联系电话', dataIndex: 'contact_phone', width: 130 },
          { title: '下单时间', dataIndex: 'created_at', width: 170, render: fmtTime },
          {
            title: '支付时间',
            dataIndex: 'paid_at',
            width: 170,
            render: (v: string | null) => fmtTime(v) ?? <Text type="secondary">未支付</Text>,
          },
        ]}
      />
    </Card>
  )
}
