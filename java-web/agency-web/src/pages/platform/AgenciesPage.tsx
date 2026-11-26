import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { api, ApiError, qs } from '../../lib/http'
import type { AgencyDetail, AgencyRow, PageResult } from '../../lib/types'
import { Permission } from '../../components/Permission'

const { Text } = Typography

function statusTag(status: AgencyRow['status']) {
  return status === 'ACTIVE' ? <Tag color="green">启用</Tag> : <Tag color="red">已停用</Tag>
}

/** 新增/编辑共用表单字段。编辑时表单会预填整行数据。 */
interface AgencyFormValues {
  agency_name: string
  license_no: string
  contact_name?: string
  contact_phone?: string
  intro?: string
}

export default function AgenciesPage() {
  const [rows, setRows] = useState<AgencyRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(10)
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [editing, setEditing] = useState<AgencyRow | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form] = Form.useForm<AgencyFormValues>()
  const [busy, setBusy] = useState(false)

  const [detail, setDetail] = useState<AgencyDetail | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<PageResult<AgencyRow>>(
        `/api/platform/agencies${qs({ page, size, sort: '-created_at', keyword, status })}`,
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

  function openCreate() {
    setEditing(null)
    form.resetFields()
    setFormOpen(true)
  }

  function openEdit(row: AgencyRow) {
    setEditing(row)
    form.setFieldsValue({
      agency_name: row.agency_name,
      license_no: row.license_no,
      contact_name: row.contact_name ?? undefined,
      contact_phone: row.contact_phone ?? undefined,
    })
    setFormOpen(true)
  }

  async function submitForm() {
    const values = await form.validateFields()
    setBusy(true)
    try {
      if (editing) {
        await api.put(`/api/platform/agencies/${editing.agency_id}`, values)
        message.success('机构信息已更新')
      } else {
        await api.post('/api/platform/agencies', values)
        message.success('机构已创建')
        setPage(1)
      }
      setFormOpen(false)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function toggleStatus(row: AgencyRow) {
    const next = row.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'
    try {
      await api.patch(`/api/platform/agencies/${row.agency_id}`, { status: next })
      message.success(next === 'DISABLED' ? '已停用（机构名下管理员账号同步禁用）' : '已启用')
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    }
  }

  async function openDetail(row: AgencyRow) {
    setDetailOpen(true)
    setDetail(null)
    try {
      const data = await api.get<AgencyDetail>(`/api/platform/agencies/${row.agency_id}`)
      setDetail(data)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    }
  }

  return (
    <Card
      title="旅行社管理"
      extra={
        <Space>
          <Input.Search
            allowClear
            placeholder="机构名称 / 许可证号"
            style={{ width: 220 }}
            onSearch={(value) => {
              setKeyword(value.trim())
              setPage(1)
            }}
          />
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 110 }}
            value={status}
            onChange={(value) => {
              setStatus(value)
              setPage(1)
            }}
            options={[
              { value: 'ACTIVE', label: '启用' },
              { value: 'DISABLED', label: '已停用' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading} />
          <Permission code="system:agency:add">
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增机构
            </Button>
          </Permission>
        </Space>
      }
    >
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      <Table<AgencyRow>
        rowKey="agency_id"
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
          { title: '机构名称', dataIndex: 'agency_name', render: (v: string) => <Text strong>{v}</Text> },
          { title: '许可证号', dataIndex: 'license_no', width: 170 },
          { title: '联系人', dataIndex: 'contact_name', width: 110, render: (v: string | null) => v || '—' },
          { title: '联系电话', dataIndex: 'contact_phone', width: 140, render: (v: string | null) => v || '—' },
          { title: '在售产品', dataIndex: 'onsale_products', width: 100, align: 'right' },
          { title: '订单数', dataIndex: 'order_count', width: 90, align: 'right' },
          { title: '状态', dataIndex: 'status', width: 90, render: statusTag },
          { title: '创建时间', dataIndex: 'created_at', width: 170 },
          {
            title: '操作',
            width: 170,
            render: (_, row) => (
              <Space size={8}>
                <a onClick={() => void openDetail(row)}>详情</a>
                <Permission code="system:agency:update">
                  <a onClick={() => openEdit(row)}>编辑</a>
                  <Popconfirm
                    title={row.status === 'ACTIVE' ? '确认停用该机构？' : '确认启用该机构？'}
                    description={
                      row.status === 'ACTIVE'
                        ? '机构名下的管理员账号将被一并禁用。'
                        : '机构名下的管理员账号将恢复可用。'
                    }
                    okText={row.status === 'ACTIVE' ? '停用' : '启用'}
                    cancelText="取消"
                    onConfirm={() => void toggleStatus(row)}
                  >
                    <a style={row.status === 'ACTIVE' ? { color: '#cf1322' } : { color: '#389e0d' }}>
                      {row.status === 'ACTIVE' ? '停用' : '启用'}
                    </a>
                  </Popconfirm>
                </Permission>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? `编辑机构：${editing.agency_name}` : '新增机构'}
        open={formOpen}
        onCancel={() => setFormOpen(false)}
        onOk={() => void submitForm()}
        confirmLoading={busy}
        okText={editing ? '保存' : '创建'}
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item
            name="agency_name"
            label="机构名称"
            rules={[
              { required: true, message: '请输入机构名称' },
              { max: 100, message: '不超过 100 字' },
            ]}
          >
            <Input placeholder="如：四川山水行国际旅行社" />
          </Form.Item>
          <Form.Item
            name="license_no"
            label="许可证号"
            rules={[
              { required: true, message: '请输入许可证号' },
              { min: 4, message: '至少 4 个字符' },
              { max: 50, message: '不超过 50 个字符' },
            ]}
          >
            <Input placeholder="如：L-SC-100001" />
          </Form.Item>
          <Form.Item name="contact_name" label="联系人" rules={[{ max: 50, message: '不超过 50 字' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="contact_phone" label="联系电话" rules={[{ max: 20, message: '不超过 20 个字符' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="intro" label="简介" rules={[{ max: 500, message: '不超过 500 字' }]}>
            <Input.TextArea rows={3} showCount maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={detail ? `机构详情：${detail.agency_name}` : '机构详情'}
        open={detailOpen}
        width={560}
        onClose={() => setDetailOpen(false)}
      >
        {detail ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="状态">{statusTag(detail.status)}</Descriptions.Item>
              <Descriptions.Item label="许可证号">{detail.license_no}</Descriptions.Item>
              <Descriptions.Item label="联系人">{detail.contact_name || '—'}</Descriptions.Item>
              <Descriptions.Item label="联系电话">{detail.contact_phone || '—'}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{detail.created_at}</Descriptions.Item>
              <Descriptions.Item label="在售产品">{detail.stats.onsale_products}</Descriptions.Item>
              <Descriptions.Item label="累计订单">{detail.stats.order_count}</Descriptions.Item>
              <Descriptions.Item label="累计流水">¥{detail.stats.total_amount}</Descriptions.Item>
              <Descriptions.Item label="简介">{detail.intro || '—'}</Descriptions.Item>
            </Descriptions>

            <div>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>机构管理员</div>
              <Table
                rowKey="username"
                size="small"
                pagination={false}
                dataSource={detail.members}
                locale={{ emptyText: '该机构暂无管理员账号' }}
                columns={[
                  { title: '账号', dataIndex: 'username' },
                  { title: '昵称', dataIndex: 'nickname', render: (v: string | null) => v || '—' },
                  {
                    title: '状态',
                    dataIndex: 'status',
                    width: 90,
                    render: (v: string) => (v === 'ACTIVE' ? <Tag color="green">正常</Tag> : <Tag color="red">禁用</Tag>),
                  },
                  {
                    title: '最近登录',
                    dataIndex: 'last_login_at',
                    width: 170,
                    render: (v: string | null) => v || '从未登录',
                  },
                ]}
              />
            </div>
          </Space>
        ) : (
          <div>加载中…</div>
        )}
      </Drawer>
    </Card>
  )
}
