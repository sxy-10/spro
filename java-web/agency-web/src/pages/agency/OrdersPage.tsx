import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, Descriptions, Drawer, Input, Modal, Select, Space, Table, Tag, Timeline, message } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { api, ApiError, qs } from '../../lib/http'
import type { OrderDetail, OrderRow, PageResult } from '../../lib/types'
import { Permission } from '../../components/Permission'

const STATUS: Record<string, { text: string; color: string }> = {
  PENDING: { text: '待支付', color: 'default' },
  PAID: { text: '待确认', color: 'orange' },
  CONFIRMED: { text: '已确认', color: 'green' },
  CANCELLED: { text: '已取消', color: 'default' },
  COMPLETED: { text: '已完成', color: 'blue' },
  REFUNDED: { text: '已退款', color: 'red' },
}

export default function OrdersPage() {
  const [rows, setRows] = useState<OrderRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(10)
  const [status, setStatus] = useState<string | undefined>()
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [detail, setDetail] = useState<OrderDetail | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [confirming, setConfirming] = useState<OrderRow | null>(null)
  const [remark, setRemark] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<PageResult<OrderRow>>(
        `/api/agency/orders${qs({ page, size, sort: '-created_at', status, keyword })}`,
      )
      setRows(data.list)
      setTotal(data.total)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [page, size, status, keyword])

  useEffect(() => {
    void load()
  }, [load])

  async function openDetail(row: OrderRow) {
    setDetailOpen(true)
    setDetail(null)
    try {
      setDetail(await api.get<OrderDetail>(`/api/agency/orders/${row.order_id}`))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    }
  }

  async function submitConfirm() {
    if (!confirming) return
    setBusy(true)
    try {
      await api.post(`/api/agency/orders/${confirming.order_id}/confirm`, remark.trim() ? { remark: remark.trim() } : {})
      message.success(`订单 ${confirming.order_no} 已确认`)
      setConfirming(null)
      setRemark('')
      setDetailOpen(false)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      title="订单管理"
      extra={
        <Space>
          <Input.Search
            allowClear
            placeholder="订单号 / 手机号 / 联系人"
            style={{ width: 240 }}
            onSearch={(value) => {
              setKeyword(value.trim())
              setPage(1)
            }}
          />
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 130 }}
            value={status}
            onChange={(value) => {
              setStatus(value)
              setPage(1)
            }}
            options={Object.entries(STATUS).map(([value, meta]) => ({ value, label: meta.text }))}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading} />
        </Space>
      }
    >
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}

      <Table<OrderRow>
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
          { title: '订单号', dataIndex: 'order_no', width: 170 },
          { title: '线路', dataIndex: 'route_title' },
          { title: '出行日期', dataIndex: 'travel_date', width: 110 },
          { title: '人数', dataIndex: 'people_count', width: 70 },
          { title: '金额', dataIndex: 'amount', width: 100, render: (value: string) => `¥${value}` },
          {
            title: '状态',
            dataIndex: 'status',
            width: 100,
            render: (value: string) => <Tag color={STATUS[value]?.color}>{STATUS[value]?.text ?? value}</Tag>,
          },
          { title: '联系人', dataIndex: 'contact_name', width: 100, render: (value?: string | null) => value || '—' },
          { title: '联系电话', dataIndex: 'contact_phone', width: 130 },
          {
            title: '操作',
            width: 150,
            render: (_, row) => (
              <Space>
                <a onClick={() => void openDetail(row)}>详情</a>
                {row.status === 'PAID' && (
                  <Permission code="order:manage:update">
                    <a
                      onClick={() => {
                        setConfirming(row)
                        setRemark('')
                      }}
                    >
                      确认
                    </a>
                  </Permission>
                )}
              </Space>
            ),
          },
        ]}
      />

      <Drawer title={detail ? `订单 ${detail.order_no}` : '订单详情'} open={detailOpen} width={520} onClose={() => setDetailOpen(false)}>
        {detail ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="线路">{detail.route_title}</Descriptions.Item>
              <Descriptions.Item label="出行日期">{detail.travel_date}</Descriptions.Item>
              <Descriptions.Item label="人数">{detail.people_count}</Descriptions.Item>
              <Descriptions.Item label="金额">¥{detail.amount}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={STATUS[detail.status]?.color}>{STATUS[detail.status]?.text ?? detail.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="联系人">{detail.contact_name || '—'}</Descriptions.Item>
              <Descriptions.Item label="联系电话">{detail.contact_phone || '—'}</Descriptions.Item>
            </Descriptions>
            <div>
              <div style={{ marginBottom: 12, fontWeight: 500 }}>状态时间线</div>
              <Timeline
                items={detail.timeline.map((item) => ({
                  color: item.done ? 'green' : 'gray',
                  children: (
                    <div>
                      <div>{item.step}</div>
                      <div style={{ color: '#8c8c8c' }}>{item.time ?? '—'}</div>
                    </div>
                  ),
                }))}
              />
            </div>
            {detail.status === 'PAID' && (
              <Permission code="order:manage:update">
                <Button
                  type="primary"
                  onClick={() => {
                    setConfirming({ ...detail })
                    setRemark('')
                  }}
                >
                  确认处理
                </Button>
              </Permission>
            )}
          </Space>
        ) : (
          <div>加载中…</div>
        )}
      </Drawer>

      <Modal
        title={confirming ? `确认订单 ${confirming.order_no}` : '确认订单'}
        open={Boolean(confirming)}
        onCancel={() => setConfirming(null)}
        onOk={() => void submitConfirm()}
        okText="确认"
        confirmLoading={busy}
      >
        <p style={{ marginTop: 0, color: '#8c8c8c' }}>确认后订单状态变为「已确认」，请确认已与客户核对出行信息。</p>
        <Input.TextArea
          rows={3}
          maxLength={200}
          showCount
          placeholder="处理备注（可选，最多 200 字）"
          value={remark}
          onChange={(event) => setRemark(event.target.value)}
        />
      </Modal>
    </Card>
  )
}
