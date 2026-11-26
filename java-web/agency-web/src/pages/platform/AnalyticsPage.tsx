import { useCallback, useEffect, useState } from 'react'
import { Alert, Card, Col, Progress, Row, Segmented, Space, Spin, Statistic, Table, Tag, Typography } from 'antd'
import { api, ApiError } from '../../lib/http'
import type { AnalyticsData } from '../../lib/types'
import PlatformTrendChart from '../../components/PlatformTrendChart'

const { Text } = Typography

const FUNNEL_STEPS = [
  { key: 'visits', label: '访问' },
  { key: 'plans', label: '生成行程' },
  { key: 'orders', label: '下单' },
  { key: 'deals', label: '有效成交' },
] as const

function rate(part: string, whole: string) {
  const w = Number(whole)
  if (!w) return '—'
  return `${((Number(part) / w) * 100).toFixed(1)}%`
}

export default function AnalyticsPage() {
  const [days, setDays] = useState<number>(30)
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await api.get<AnalyticsData>(`/api/platform/analytics?days=${days}`))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [days])

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

  const funnel = data?.funnel
  const maxTag = Math.max(...(data?.tag_distribution ?? []).map((item) => Number(item.cnt)), 1)
  const maxCity = Math.max(...(data?.city_distribution ?? []).map((item) => Number(item.cnt)), 1)
  // 有效成交 GMV 合计：口径与财务结算页 total_gmv 一致（PAID+CONFIRMED+COMPLETED）
  const dealGmv = (data?.agency_performance ?? []).reduce((sum, item) => sum + Number(item.total_amount), 0)

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {error && <Alert type="error" showIcon message="分析数据加载失败" description={error} />}

      <Card
        title="数据分析中心"
        extra={
          <Segmented
            value={days}
            onChange={(value) => setDays(value as number)}
            options={[
              { value: 7, label: '近 7 天' },
              { value: 30, label: '近 30 天' },
              { value: 90, label: '近 90 天' },
            ]}
          />
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="统计口径说明"
          description={
            <Text type="secondary" style={{ fontSize: 12 }}>
              订单量与趋势图口径与「订单监督」页一致（全部状态）；有效成交 = 已确认 + 已完成；
              成交额（GMV）口径与「财务结算」页总 GMV 一致（已支付 + 已确认 + 已完成），不含已退款订单。
            </Text>
          }
        />
        <Row gutter={16}>
          {FUNNEL_STEPS.map((step, index) => (
            <Col span={6} key={step.key}>
              <Card size="small">
                <Statistic title={step.label} value={funnel?.[step.key] ?? '0'} />
                {index > 0 && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    上层转化率 {rate(funnel?.[step.key] ?? '0', funnel?.[FUNNEL_STEPS[index - 1].key] ?? '0')}
                  </Text>
                )}
              </Card>
            </Col>
          ))}
        </Row>
      </Card>

      <Card title={`近 ${data?.days ?? days} 天订单与成交额趋势（口径同订单监督页）`}>
        <PlatformTrendChart data={data?.trend ?? []} />
      </Card>

      <Row gutter={16}>
        <Col span={14}>
          <Card title="产品转化排行 Top8" size="small">
            <Table<AnalyticsData['product_rank'][number]>
              rowKey="route_id"
              size="small"
              pagination={false}
              dataSource={data?.product_rank ?? []}
              columns={[
                { title: '编号', dataIndex: 'product_no', width: 110 },
                { title: '线路', dataIndex: 'title', ellipsis: true },
                { title: '机构', dataIndex: 'agency_name', width: 130, ellipsis: true },
                { title: '访问', dataIndex: 'visitor_count', width: 70, align: 'right' },
                { title: '下单', dataIndex: 'order_count', width: 70, align: 'right' },
                {
                  title: '转化率',
                  dataIndex: 'conversion_rate',
                  width: 90,
                  align: 'right',
                  render: (value?: string) => <Tag color="geekblue">{(Number(value ?? 0) * 100).toFixed(1)}%</Tag>,
                },
              ]}
            />
          </Card>
        </Col>
        <Col span={10}>
          <Card title="目的地热度 Top6（累计访问 / 下单）" size="small">
            <Table<AnalyticsData['destination_heat'][number]>
              rowKey="destination"
              size="small"
              pagination={false}
              dataSource={data?.destination_heat ?? []}
              columns={[
                { title: '目的地', dataIndex: 'destination' },
                { title: '访问', dataIndex: 'visits', width: 80, align: 'right', render: (v: string) => Number(v) },
                { title: '下单', dataIndex: 'orders', width: 80, align: 'right', render: (v: string) => Number(v) },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          <Card title="机构业绩 Top6（有效成交口径 = 财务 GMV）" size="small">
            <Table<AnalyticsData['agency_performance'][number]>
              rowKey="agency_id"
              size="small"
              pagination={false}
              dataSource={data?.agency_performance ?? []}
              columns={[
                { title: '机构', dataIndex: 'agency_name', ellipsis: true },
                { title: '在售', dataIndex: 'onsale_products', width: 70, align: 'right', render: (v: string) => Number(v) },
                { title: '有效订单', dataIndex: 'order_count', width: 90, align: 'right', render: (v: string) => Number(v) },
                {
                  title: '成交额',
                  dataIndex: 'total_amount',
                  width: 110,
                  align: 'right',
                  render: (v: string) => `¥${v}`,
                },
              ]}
              summary={(pageData) => (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0}>
                    <Text strong>合计</Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right" colSpan={1} />
                  <Table.Summary.Cell index={2} align="right">
                    <Text strong>{pageData.reduce((sum, item) => sum + Number(item.order_count), 0)}</Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="right">
                    <Text strong>¥{dealGmv.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</Text>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              )}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card title="兴趣标签分布 Top6" size="small">
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              {(data?.tag_distribution ?? []).length === 0 && <Text type="secondary">暂无数据</Text>}
              {(data?.tag_distribution ?? []).map((item) => (
                <div key={item.tag_value}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <Text>{item.tag_value}</Text>
                    <Text type="secondary">{Number(item.cnt)}</Text>
                  </div>
                  <Progress percent={Math.round((Number(item.cnt) / maxTag) * 100)} showInfo={false} strokeColor="#722ed1" size={['100%', 8]} />
                </div>
              ))}
            </Space>
          </Card>
        </Col>
        <Col span={6}>
          <Card title="客源城市 Top6" size="small">
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              {(data?.city_distribution ?? []).length === 0 && <Text type="secondary">暂无数据</Text>}
              {(data?.city_distribution ?? []).map((item) => (
                <div key={item.city}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <Text>{item.city}</Text>
                    <Text type="secondary">{Number(item.cnt)}</Text>
                  </div>
                  <Progress percent={Math.round((Number(item.cnt) / maxCity) * 100)} showInfo={false} strokeColor="#13c2c2" size={['100%', 8]} />
                </div>
              ))}
            </Space>
          </Card>
        </Col>
      </Row>
    </Space>
  )
}
