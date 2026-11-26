import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, Input, Modal, Radio, Select, Space, Table, Tag, Typography, message } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { api, ApiError, qs } from '../../lib/http'
import type { AuditRow, AuditType, PageResult } from '../../lib/types'
import { useAuth } from '../../lib/auth'

const { Text } = Typography

const fmtTime = (value: string | null) => (value ? value.slice(0, 19).replace('T', ' ') : value)

const AUDIT_STATUS: Record<AuditRow['audit_status'], { text: string; color: string }> = {
  NONE: { text: '未提交', color: 'default' },
  PENDING: { text: '待审核', color: 'orange' },
  APPROVED: { text: '已通过', color: 'green' },
  REJECTED: { text: '已驳回', color: 'red' },
}

const PRODUCT_STATUS: Record<string, { text: string; color: string }> = {
  DRAFT: { text: '草稿', color: 'default' },
  ON_SALE: { text: '在售', color: 'green' },
  OFF_SALE: { text: '下架', color: 'default' },
}

/** 平台审核是写操作：线路走 route:line:audit，特产走 route:souvenir:audit（Node Casbin 真闸门）。 */
const AUDIT_ACTION_CODE: Record<AuditType, string> = {
  route: 'route:line:audit',
  souvenir: 'route:souvenir:audit',
}

interface AuditForm {
  open: boolean
  type: AuditType
  row: AuditRow | null
  result: 'APPROVED' | 'REJECTED'
  remark: string
}

export default function AuditsPage() {
  const { can } = useAuth()
  const [type, setType] = useState<AuditType>('route')
  const [auditStatus, setAuditStatus] = useState('PENDING')
  const [keyword, setKeyword] = useState('')
  const [rows, setRows] = useState<AuditRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(10)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<AuditForm>({
    open: false, type: 'route', row: null, result: 'APPROVED', remark: '',
  })
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<PageResult<AuditRow>>(
        `/api/platform/audits${qs({ page, size, type, audit_status: auditStatus, keyword, sort: '-updated_at' })}`,
      )
      setRows(data.list)
      setTotal(data.total)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [page, size, type, auditStatus, keyword])

  useEffect(() => {
    void load()
  }, [load])

  const openAudit = (row: AuditRow) => {
    setForm({ open: true, type, row, result: 'APPROVED', remark: '' })
  }

  const submitAudit = async () => {
    if (!form.row) return
    if (form.result === 'REJECTED' && !form.remark.trim()) {
      message.warning('驳回时请填写驳回原因，商家需要知道改什么')
      return
    }
    setSubmitting(true)
    try {
      await api.post(`/api/platform/audits/${form.type}/${form.row.product_id}`, {
        result: form.result,
        remark: form.remark.trim() || undefined,
      })
      message.success(form.result === 'APPROVED' ? '已通过，产品已自动上架' : '已驳回，理由已回传商家')
      setForm((prev) => ({ ...prev, open: false }))
      void load()
    } catch (e) {
      message.error(e instanceof ApiError ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  const canAct = can(AUDIT_ACTION_CODE[type])

  return (
    <Card
      title="内容审核"
      extra={
        <Space>
          <Select
            placeholder="审核状态"
            style={{ width: 110 }}
            value={auditStatus}
            onChange={(value) => {
              setAuditStatus(value)
              setPage(1)
            }}
            options={Object.entries(AUDIT_STATUS)
              .filter(([value]) => value !== 'NONE')
              .map(([value, meta]) => ({ value, label: meta.text }))}
          />
          <Input.Search
            allowClear
            placeholder="标题 / 编号"
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
      <Radio.Group
        value={type}
        onChange={(e) => {
          setType(e.target.value as AuditType)
          setPage(1)
        }}
        style={{ marginBottom: 16 }}
        optionType="button"
        buttonStyle="solid"
        options={[
          { value: 'route', label: '旅游线路' },
          { value: 'souvenir', label: '本地特产' },
        ]}
      />
      {!canAct && (
        <Alert
          type="info"
          showIcon
          message="当前账号无审核权限（需 route:line:audit / route:souvenir:audit），只能查看"
          style={{ marginBottom: 12 }}
        />
      )}
      <Table<AuditRow>
        rowKey="product_id"
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
          { title: '编号', dataIndex: 'product_no', width: 140, render: (v: string) => <Text code>{v}</Text> },
          { title: '标题', dataIndex: 'title', ellipsis: true },
          { title: type === 'route' ? '目的地' : '品类', dataIndex: 'destination', width: 100 },
          { title: '所属机构', dataIndex: 'agency_name', width: 150, ellipsis: true },
          { title: '价格', dataIndex: 'price', width: 100, align: 'right', render: (v: string) => `¥${v}` },
          {
            title: '审核状态',
            dataIndex: 'audit_status',
            width: 90,
            render: (v: AuditRow['audit_status']) => <Tag color={AUDIT_STATUS[v]?.color}>{AUDIT_STATUS[v]?.text ?? v}</Tag>,
          },
          {
            title: '上架状态',
            dataIndex: 'product_status',
            width: 90,
            render: (v: string) => <Tag color={PRODUCT_STATUS[v]?.color}>{PRODUCT_STATUS[v]?.text ?? v}</Tag>,
          },
          {
            title: '审核备注',
            dataIndex: 'audit_remark',
            ellipsis: true,
            render: (v: string | null) => v || '—',
          },
          { title: '提交时间', dataIndex: 'submitted_at', width: 170, render: fmtTime },
          {
            title: '操作',
            width: 110,
            render: (_, row) =>
              canAct && row.audit_status === 'PENDING' ? (
                <Button type="link" size="small" onClick={() => openAudit(row)}>
                  审核
                </Button>
              ) : (
                <Text type="secondary">—</Text>
              ),
          },
        ]}
      />
      <Modal
        title={`审核${form.type === 'route' ? '线路' : '特产'}：${form.row?.title ?? ''}`}
        open={form.open}
        onCancel={() => setForm((prev) => ({ ...prev, open: false }))}
        onOk={() => void submitAudit()}
        confirmLoading={submitting}
        okText={form.result === 'APPROVED' ? '通过并上架' : '确认驳回'}
        okButtonProps={{ danger: form.result === 'REJECTED' }}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Radio.Group
            value={form.result}
            onChange={(e) => setForm((prev) => ({ ...prev, result: e.target.value }))}
            optionType="button"
            buttonStyle="solid"
            options={[
              { value: 'APPROVED', label: '通过（自动上架）' },
              { value: 'REJECTED', label: '驳回' },
            ]}
          />
          <Input.TextArea
            rows={3}
            maxLength={255}
            showCount
            placeholder={form.result === 'REJECTED' ? '必填：请说明驳回原因（商家可见）' : '选填：备注说明'}
            value={form.remark}
            onChange={(e) => setForm((prev) => ({ ...prev, remark: e.target.value }))}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            通过后产品状态自动置为在售；驳回则维持现态并把理由回传给提交商家。
          </Text>
        </Space>
      </Modal>
    </Card>
  )
}
