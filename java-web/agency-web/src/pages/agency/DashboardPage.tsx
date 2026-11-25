import { useCallback, useEffect, useState } from 'react'
import { Alert, Card, Col, List, Row, Space, Spin, Statistic, Table, Tag, Typography } from 'antd'
import { api, ApiError } from '../../lib/http'
import type { DashboardData, OrderRow, RouteRow } from '../../lib/types'
import TrendChart from '../../components/TrendChart'

const { Text } = Typography

const ORDER_STATUS: Record<string, { text: string; color: string }> = {
  PENDING: { text: '待支付', color: 'default' },
  PAID: { text: '待确认', color: 'orange' },
  CONFIRMED: { text: '已确认', color: 'green' },
  CANCELLED: { text: '已取消', color: 'default' },
  COMPLETED: { text: '已完成', color: 'blue' },
  REFUNDED: { text: '已退款', color: 'red' },
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await api.get<DashboardData>('/api/agency/dashboard'))
    } catch (e) {
      setError(e instanceof ApiError ? `${e.message}（HTTP ${e.status} / code ${e.code}）` : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading && !data) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin />
      </div>
    )
  }

  const kpi = data?.kpi

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {error && <Alert type="error" showIcon message="工作台加载失败" description={error} />}

      <Row gutter={16}>
        <Col span={5}>
          <Card><Statistic title="在售线路" value={kpi?.onsale_count ?? 0} suffix="条" /></Card>
        </Col>
        <Col span={5}>
          <Card><Statistic title="今日订单" value={kpi?.today_orders ?? 0} suffix="单" /></Card>
        </Col>
        <Col span={5}>
          <Card><Statistic title="待确认" value={kpi?.pending_confirms ?? 0} valueStyle={{ color: '#fa8c16' }} suffix="单" /></Card>
        </Col>
        <Col span={5}>
          <Card><Statistic title="今日成交额" value={kpi?.today_amount ?? '0'} prefix="¥" /></Card>
        </Col>
        <Col span={4}>
          <Card><Statistic title="转化率" value={kpi?.conversion_rate ?? 0} suffix="%" /></Card>
        </Col>
      </Row>

      <Card title="近 14 天趋势">
        <TrendChart data={data?.trend ?? []} />
      </Card>

      <Row gutter={16}>
        <Col span={14}>
          <Card title="Top 线路（按转化率）" size="small">
            <Table<RouteRow>
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={data?.top_products ?? []}
              columns={[
                { title: '线路', dataIndex: 'title' },
                { title: '天数', dataIndex: 'default_days', width: 70 },
                { title: '价格', dataIndex: 'base_price_rmb', width: 100, render: (value: string) => `¥${value}` },
                { title: '访问', dataIndex: 'visitor_count', width: 80 },
                { title: '下单', dataIndex: 'order_count', width: 70 },
                {
                  title: '转化率',
                  dataIndex: 'conversion_rate',
                  width: 90,
                  render: (value?: number) => `${value ?? 0}%`,
                },
              ]}
            />
          </Card>
        </Col>
        <Col span={10}>
          <Card title="今日待办" size="small">
            <List
              size="small"
              header={<Text type="secondary">待确认订单</Text>}
              dataSource={data?.todos.pending_orders ?? []}
              locale={{ emptyText: '没有待确认订单' }}
              renderItem={(order: OrderRow) => (
                <List.Item>
                  <Space split="·">
                    <Text code>{order.order_no}</Text>
                    <span>{order.route_title}</span>
                    <Text type="secondary">{order.people_count} 人</Text>
                  </Space>
                </List.Item>
              )}
            />
            <List
              size="small"
              style={{ marginTop: 12 }}
              header={<Text type="secondary">库存告急（≤5 席）</Text>}
              dataSource={data?.todos.low_stock ?? []}
              locale={{ emptyText: '没有库存告急的日期' }}
              renderItem={(item) => (
                <List.Item>
                  <Space split="·">
                    <span>{item.title}</span>
                    <Text type="secondary">{item.travel_date}</Text>
                    <Tag color="red">余 {item.available_seats}</Tag>
                  </Space>
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>

      <Card title="最近订单" size="small">
        <Table<OrderRow>
          rowKey="order_id"
          size="small"
          pagination={false}
          dataSource={data?.recent_orders ?? []}
          columns={[
            { title: '订单号', dataIndex: 'order_no' },
            { title: '线路', dataIndex: 'route_title' },
            { title: '出行日期', dataIndex: 'travel_date', width: 110 },
            { title: '人数', dataIndex: 'people_count', width: 70 },
            { title: '金额', dataIndex: 'amount', width: 100, render: (value: string) => `¥${value}` },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (status: string) => <Tag color={ORDER_STATUS[status]?.color}>{ORDER_STATUS[status]?.text ?? status}</Tag>,
            },
            { title: '联系电话', dataIndex: 'contact_phone', width: 130 },
          ]}
        />
      </Card>
    </Space>
  )
}
