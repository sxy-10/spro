import { useEffect, useState } from 'react'
import { Alert, Card, Col, Progress, Row, Space, Spin, Statistic, Table, Tag, Typography } from 'antd'
import { api, ApiError } from '../../lib/http'
import type { DestinationHeat, PlatformOverview, PlatformTopProduct } from '../../lib/types'
import PlatformTrendChart from '../../components/PlatformTrendChart'

const { Text } = Typography

export default function OverviewPage() {
  const [data, setData] = useState<PlatformOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api
      .get<PlatformOverview>('/api/platform/overview')
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof ApiError ? `${e.message}（HTTP ${e.status} / code ${e.code}）` : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (loading && !data) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin />
      </div>
    )
  }

  const kpi = data?.kpi
  const maxHeat = Math.max(
    ...(data?.destination_heat ?? []).map((item: DestinationHeat) => Number(item.visits)),
    1,
  )

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {error && <Alert type="error" showIcon message="总览加载失败" description={error} />}

      <Row gutter={16}>
        <Col span={4}>
          <Card><Statistic title="注册游客" value={kpi?.tourist_count ?? 0} suffix="人" /></Card>
        </Col>
        <Col span={4}>
          <Card><Statistic title="在营机构" value={kpi?.agency_count ?? 0} suffix="家" /></Card>
        </Col>
        <Col span={4}>
          <Card><Statistic title="在售线路" value={kpi?.route_onsale ?? 0} suffix="条" /></Card>
        </Col>
        <Col span={4}>
          <Card><Statistic title="在售特产" value={kpi?.souvenir_onsale ?? 0} suffix="件" /></Card>
        </Col>
        <Col span={4}>
          <Card><Statistic title="今日订单" value={kpi?.today_orders ?? 0} suffix="单" /></Card>
        </Col>
        <Col span={4}>
          <Card><Statistic title="今日成交额" value={kpi?.today_amount ?? '0'} prefix="¥" /></Card>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={6}>
          <Card>
            <Statistic
              title="待审核（线路 + 特产）"
              value={kpi?.pending_audits ?? 0}
              valueStyle={{ color: kpi?.pending_audits ? '#fa8c16' : undefined }}
              suffix="项"
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              前往「内容审核」处理
            </Text>
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="待确认订单"
              value={kpi?.pending_confirms ?? 0}
              valueStyle={{ color: kpi?.pending_confirms ? '#fa8c16' : undefined }}
              suffix="单"
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              已支付待旅行社确认
            </Text>
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="待结算单"
              value={kpi?.pending_settlements ?? 0}
              valueStyle={{ color: kpi?.pending_settlements ? '#fa8c16' : undefined }}
              suffix="笔"
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              前往「财务结算」处理
            </Text>
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="累计退款金额" value={kpi?.refund_amount ?? '0'} prefix="¥" valueStyle={{ color: '#cf1322' }} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              全部已退款订单合计
            </Text>
          </Card>
        </Col>
      </Row>

      <Card title="近 14 天平台趋势">
        <PlatformTrendChart data={data?.trend ?? []} />
      </Card>

      <Row gutter={16}>
        <Col span={14}>
          <Card title="热销线路 Top5（按转化率）" size="small">
            <Table<PlatformTopProduct>
              rowKey="route_id"
              size="small"
              pagination={false}
              dataSource={data?.top_products ?? []}
              locale={{ emptyText: '暂无在售线路' }}
              columns={[
                { title: '编号', dataIndex: 'product_no', width: 120 },
                { title: '线路', dataIndex: 'title', ellipsis: true },
                { title: '所属机构', dataIndex: 'agency_name', width: 150, ellipsis: true },
                { title: '访问', dataIndex: 'visitor_count', width: 80, align: 'right' },
                { title: '下单', dataIndex: 'order_count', width: 70, align: 'right' },
                {
                  title: '转化率',
                  dataIndex: 'conversion_rate',
                  width: 90,
                  align: 'right',
                  render: (value?: string) => {
                    const percent = Number(value ?? 0) * 100
                    return <Tag color="geekblue">{percent.toFixed(1)}%</Tag>
                  },
                },
              ]}
            />
          </Card>
        </Col>
        <Col span={10}>
          <Card title="目的地热度 Top5（按访问量）" size="small">
            <Space direction="vertical" size={14} style={{ width: '100%' }}>
              {(data?.destination_heat ?? []).length === 0 && (
                <Text type="secondary">暂无访问数据</Text>
              )}
              {(data?.destination_heat ?? []).map((item: DestinationHeat) => (
                <div key={item.destination}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text strong>{item.destination}</Text>
                    <Text type="secondary">{Number(item.visits)} 人次</Text>
                  </div>
                  <Progress percent={Math.round((Number(item.visits) / maxHeat) * 100)} showInfo={false} strokeColor="#1677ff" />
                </div>
              ))}
            </Space>
          </Card>
        </Col>
      </Row>
    </Space>
  )
}
