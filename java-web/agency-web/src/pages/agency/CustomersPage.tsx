import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, Descriptions, Drawer, Input, Space, Table, Tag, message } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { api, ApiError, qs } from '../../lib/http'
import type { CustomerDetail, CustomerRow, PageResult } from '../../lib/types'
import { Permission } from '../../components/Permission'

export default function CustomersPage() {
  const [rows, setRows] = useState<CustomerRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(10)
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [detail, setDetail] = useState<CustomerDetail | null>(null)
  const [note, setNote] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<PageResult<CustomerRow>>(
        `/api/agency/customers${qs({ page, size, sort: '-last_order_at', keyword })}`,
      )
      setRows(data.list)
      setTotal(data.total)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [page, size, keyword])

  useEffect(() => {
    void load()
  }, [load])

  async function openDetail(row: CustomerRow) {
    setOpen(true)
    setDetail(null)
    try {
      const data = await api.get<CustomerDetail>(`/api/agency/customers/${row.user_id}`)
      setDetail(data)
      setNote(data.follow_up_note ?? '')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    }
  }

  async function saveNote() {
    if (!detail) return
    setBusy(true)
    try {
      await api.put(`/api/agency/customers/${detail.user_id}/note`, { note })
      message.success('回访备注已保存')
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      title="客户管理"
      extra={
        <Space>
          <Input.Search
            allowClear
            placeholder="昵称 / 手机号"
            style={{ width: 220 }}
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
      <Table<CustomerRow>
        rowKey="user_id"
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
          { title: '昵称', dataIndex: 'nickname', render: (value: string | null) => value || '游客' },
          { title: '手机号', dataIndex: 'masked_phone', width: 140 },
          { title: '出发城市', dataIndex: 'departure_city', width: 110, render: (value: string | null) => value || '—' },
          { title: '订单数', dataIndex: 'total_orders', width: 90 },
          { title: '累计消费', dataIndex: 'total_spend', width: 120, render: (value: string) => `¥${value}` },
          { title: '最近下单', dataIndex: 'last_order_at', width: 170, render: (value: string | null) => value || '—' },
          {
            title: '兴趣标签',
            dataIndex: 'preference_tags',
            render: (tags: string[]) =>
              (tags ?? []).length > 0 ? (
                <Space wrap size={4}>
                  {tags.map((tag) => (
                    <Tag key={tag} color="blue">
                      {tag}
                    </Tag>
                  ))}
                </Space>
              ) : (
                '—'
              ),
          },
          {
            title: '操作',
            width: 90,
            render: (_, row) => <a onClick={() => void openDetail(row)}>详情</a>,
          },
        ]}
      />

      <Drawer
        title={detail ? `客户 ${detail.nickname || detail.user_id}` : '客户详情'}
        open={open}
        width={560}
        onClose={() => setOpen(false)}
      >
        {detail ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="手机号">{detail.phone || '—'}</Descriptions.Item>
              <Descriptions.Item label="出发城市">{detail.departure_city || '—'}</Descriptions.Item>
              <Descriptions.Item label="注册时间">{detail.register_time}</Descriptions.Item>
              <Descriptions.Item label="兴趣标签">
                {(detail.preference_tags ?? []).length > 0
                  ? detail.preference_tags.map((tag) => (
                      <Tag key={tag} color="blue">
                        {tag}
                      </Tag>
                    ))
                  : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="偏好目的地">
                {(detail.preference_destinations ?? []).join('、') || '—'}
              </Descriptions.Item>
            </Descriptions>

            <div>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>历史订单（最近 20 条）</div>
              <Table
                rowKey="order_no"
                size="small"
                pagination={false}
                dataSource={detail.orders}
                locale={{ emptyText: '暂无订单' }}
                columns={[
                  { title: '订单号', dataIndex: 'order_no' },
                  { title: '线路', dataIndex: 'route_title' },
                  { title: '金额', dataIndex: 'amount', width: 100, render: (value: string) => `¥${value}` },
                  { title: '状态', dataIndex: 'status', width: 90 },
                ]}
              />
            </div>

            <div>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>回访备注</div>
              <Input.TextArea
                rows={3}
                maxLength={500}
                showCount
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="记录客户的偏好、顾虑、跟进结论（最多 500 字）"
              />
              <Permission code="customer:customer:update">
                <Button type="primary" style={{ marginTop: 8 }} loading={busy} onClick={() => void saveNote()}>
                  保存备注
                </Button>
              </Permission>
            </div>
          </Space>
        ) : (
          <div>加载中…</div>
        )}
      </Drawer>
    </Card>
  )
}
