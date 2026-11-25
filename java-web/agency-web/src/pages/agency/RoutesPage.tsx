import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Button, Card, Input, Select, Space, Table, Tag } from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { api, ApiError, qs } from '../../lib/http'
import type { PageResult, RouteRow } from '../../lib/types'
import { Permission } from '../../components/Permission'

const STATUS: Record<string, { text: string; color: string }> = {
  DRAFT: { text: '草稿', color: 'default' },
  ON_SALE: { text: '在售', color: 'green' },
  OFF_SALE: { text: '已下架', color: 'red' },
}

export default function RoutesPage() {
  const [rows, setRows] = useState<RouteRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(10)
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<PageResult<RouteRow>>(
        `/api/agency/routes${qs({ page, size, sort: '-created_at', keyword, status })}`,
      )
      setRows(data.list)
      setTotal(data.total)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [page, size, keyword, status])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Card
      title="线路管理"
      extra={
        <Space>
          <Input.Search
            allowClear
            placeholder="线路名称 / 产品编号"
            style={{ width: 220 }}
            onSearch={(value) => {
              setKeyword(value.trim())
              setPage(1)
            }}
          />
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 120 }}
            value={status}
            onChange={(value) => {
              setStatus(value)
              setPage(1)
            }}
            options={Object.entries(STATUS).map(([value, meta]) => ({ value, label: meta.text }))}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading} />
          <Permission code="route:line:add">
            <Link to="/agency/routes/new">
              <Button type="primary" icon={<PlusOutlined />}>
                新建线路
              </Button>
            </Link>
          </Permission>
        </Space>
      }
    >
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      <Table<RouteRow>
        rowKey="id"
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
          { title: '产品编号', dataIndex: 'product_no', width: 160 },
          { title: '线路名称', dataIndex: 'title' },
          { title: '目的地', dataIndex: 'destination', width: 120 },
          { title: '天数', dataIndex: 'default_days', width: 70 },
          { title: '风格', dataIndex: 'style_tag', width: 100, render: (value: string | null) => value || '—' },
          {
            title: '基础价',
            dataIndex: 'base_price_rmb',
            width: 110,
            render: (value: string) => `¥${value}`,
          },
          {
            title: '状态',
            dataIndex: 'status',
            width: 90,
            render: (value: string) => <Tag color={STATUS[value]?.color}>{STATUS[value]?.text ?? value}</Tag>,
          },
          {
            title: '转化率',
            dataIndex: 'conversion_rate',
            width: 90,
            render: (value?: number) => `${value ?? 0}%`,
          },
          {
            title: '操作',
            width: 180,
            render: (_, row) => (
              <Space>
                <Permission code="route:line:update">
                  <Link to={`/agency/routes/${row.id}/edit`}>编辑</Link>
                </Permission>
                <Link to={`/agency/stock?routeId=${row.id}`}>库存</Link>
              </Space>
            ),
          },
        ]}
      />
    </Card>
  )
}
