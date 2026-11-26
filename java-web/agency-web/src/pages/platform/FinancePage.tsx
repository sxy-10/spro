import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, Col, Popconfirm, Row, Select, Space, Statistic, Table, Tag, Typography, message } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { api, ApiError, qs } from '../../lib/http'
import type { FinanceSummary, PageResult, RefundRow, SettlementRow } from '../../lib/types'
import { Permission } from '../../components/Permission'

const { Text } = Typography

/** MySQL DATETIME 经 Node serialize 是 ISO 串，统一转 YYYY-MM-DD HH:mm:ss */
const fmtTime = (value: string | null) => (value ? value.slice(0, 19).replace('T', ' ') : value)

const SETTLE_STATUS: Record<SettlementRow['status'], { text: string; color: string }> = {
  PENDING: { text: '待结算', color: 'orange' },
  SETTLED: { text: '已结算', color: 'green' },
  REJECTED: { text: '已驳回', color: 'red' },
}

export default function FinancePage() {
  const [summary, setSummary] = useState<FinanceSummary | null>(null)
  const [rows, setRows] = useState<SettlementRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(10)
  const [status, setStatus] = useState<string | undefined>()
  const [refunds, setRefunds] = useState<RefundRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // 财务三查（summary / settlements / refunds）口径同源：全部来自 finance:platform 域
      const [sum, list, ref] = await Promise.all([
        api.get<FinanceSummary>('/api/platform/finance/summary'),
        api.get<PageResult<SettlementRow>>(
          `/api/platform/settlements${qs({ page, size, sort: '-created_at', status })}`,
        ),
        api.get<{ list: RefundRow[] }>('/api/platform/refunds'),
      ])
      setSummary(sum)
      setRows(list.list)
      setTotal(list.total)
      setRefunds(ref.list)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [page, size, status])

  useEffect(() => {
    void load()
  }, [load])

  async function confirmSettle(row: SettlementRow) {
    setConfirming(row.settlement_id)
    try {
      await api.post(`/api/platform/settlements/${row.settlement_id}/confirm`)
      message.success(`结算单 ${row.settlement_no} 已确认结算`)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setConfirming(null)
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {error && <Alert type="error" showIcon message="财务数据加载失败" description={error} closable onClose={() => setError(null)} />}

      <Row gutter={16}>
        <Col span={4}>
          <Card><Statistic title="平台总 GMV" value={summary?.total_gmv ?? '0'} prefix="¥" /></Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic
              title="待结算金额"
              value={summary?.pending_settle ?? '0'}
              prefix="¥"
              valueStyle={{ color: Number(summary?.pending_settle ?? 0) > 0 ? '#fa8c16' : undefined }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              涉及 {summary?.pending_agencies ?? 0} 家机构
            </Text>
          </Card>
        </Col>
        <Col span={4}>
          <Card><Statistic title="已结算金额" value={summary?.settled_amount ?? '0'} prefix="¥" /></Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic title="累计退款" value={summary?.refund_amount ?? '0'} prefix="¥" valueStyle={{ color: '#cf1322' }} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              共 {summary?.refund_count ?? 0} 单
            </Text>
          </Card>
        </Col>
      </Row>

      <Card
        title="结算单"
        extra={
          <Space>
            <Select
              allowClear
              placeholder="结算状态"
              style={{ width: 120 }}
              value={status}
              onChange={(value) => {
                setStatus(value)
                setPage(1)
              }}
              options={Object.entries(SETTLE_STATUS).map(([value, meta]) => ({ value, label: meta.text }))}
            />
            <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading} />
          </Space>
        }
      >
        <Table<SettlementRow>
          rowKey="settlement_id"
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
            { title: '结算单号', dataIndex: 'settlement_no', width: 180, render: (v: string) => <Text code>{v}</Text> },
            { title: '机构', dataIndex: 'agency_name', width: 150, ellipsis: true },
            { title: '结算周期', dataIndex: 'period_label', width: 130 },
            { title: '订单数', dataIndex: 'order_count', width: 80, align: 'right', render: (v: string | number) => Number(v) },
            { title: '订单总额', dataIndex: 'gross_amount', width: 110, align: 'right', render: (v: string) => `¥${v}` },
            {
              title: '佣金',
              width: 170,
              align: 'right',
              render: (_, row) => (
                <span>
                  ¥{row.commission_amount}
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {' '}
                    （{Number(row.commission_rate) * 100}%）
                  </Text>
                </span>
              ),
            },
            { title: '应付机构', dataIndex: 'payable_amount', width: 110, align: 'right', render: (v: string) => <Text strong>¥{v}</Text> },
            {
              title: '状态',
              dataIndex: 'status',
              width: 90,
              render: (v: SettlementRow['status']) => (
                <Tag color={SETTLE_STATUS[v]?.color}>{SETTLE_STATUS[v]?.text ?? v}</Tag>
              ),
            },
            {
              title: '驳回原因',
              dataIndex: 'reject_reason',
              width: 140,
              ellipsis: true,
              render: (v: string | null) => v || '—',
            },
            { title: '创建时间', dataIndex: 'created_at', width: 170, render: fmtTime },
            {
              title: '结算时间',
              dataIndex: 'settled_at',
              width: 170,
              render: (v: string | null) => fmtTime(v) ?? '—',
            },
            {
              title: '操作',
              width: 110,
              render: (_, row) =>
                row.status === 'PENDING' ? (
                  <Permission code="finance:platform:settle">
                    <Popconfirm
                      title={`确认结算 ${row.settlement_no}？`}
                      description={`将向机构 ${row.agency_name} 支付 ¥${row.payable_amount}。`}
                      okText="确认结算"
                      cancelText="取消"
                      onConfirm={() => void confirmSettle(row)}
                    >
                      <a>确认结算</a>
                    </Popconfirm>
                  </Permission>
                ) : (
                  <Text type="secondary">—</Text>
                ),
            },
          ]}
        />
      </Card>

      <Card title="最近退款（20 条）" size="small">
        <Table<RefundRow>
          rowKey="order_no"
          size="small"
          pagination={false}
          dataSource={refunds}
          locale={{ emptyText: '暂无退款记录' }}
          columns={[
            { title: '订单号', dataIndex: 'order_no', render: (v: string) => <Text code>{v}</Text> },
            { title: '客户', dataIndex: 'customer', render: (v: string | null) => v || '—' },
            { title: '联系电话', dataIndex: 'masked_phone', width: 130 },
            { title: '机构', dataIndex: 'agency_name', width: 150, ellipsis: true },
            { title: '退款金额', dataIndex: 'amount', width: 100, align: 'right', render: (v: string) => <Text type="danger">¥{v}</Text> },
            { title: '退款原因', dataIndex: 'refund_reason', ellipsis: true, render: (v: string | null) => v || '—' },
            { title: '退款时间', dataIndex: 'refunded_at', width: 170, render: fmtTime },
          ]}
        />
      </Card>
    </Space>
  )
}
