import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { api, ApiError, qs } from '../../lib/http'
import type { PageResult, RoleRow, UserRow } from '../../lib/types'
import { Permission } from '../../components/Permission'

const { Text } = Typography

function statusTag(status: UserRow['status']) {
  return status === 'ACTIVE' ? <Tag color="green">正常</Tag> : <Tag color="red">已禁用</Tag>
}

/** 新建账号表单。RBAC 建号口径：手机号即账号名，密码至少 8 位，角色至少 1 个。 */
interface CreateUserValues {
  mobile: string
  password: string
  nickname?: string
  role_ids: string[]
}

/** 编辑表单：昵称 + 全量覆盖角色（Node 的 PUT /admin/users/:id 是 delete-all-then-insert）。 */
interface UpdateUserValues {
  nickname?: string
  role_ids: string[]
}

export default function UsersPage() {
  const [rows, setRows] = useState<UserRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(10)
  const [keyword, setKeyword] = useState('')
  const [userType, setUserType] = useState<string | undefined>()
  const [status, setStatus] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [roles, setRoles] = useState<RoleRow[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm] = Form.useForm<CreateUserValues>()
  const [editing, setEditing] = useState<UserRow | null>(null)
  const [editForm] = Form.useForm<UpdateUserValues>()
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<PageResult<UserRow>>(
        `/api/platform/users${qs({ page, size, sort: '-created_at', keyword, user_type: userType, status })}`,
      )
      setRows(data.list)
      setTotal(data.total)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [page, size, keyword, userType, status])

  useEffect(() => {
    void load()
  }, [load])

  /** 角色下拉在打开弹窗时才拉取——页面初始少一次请求，且保证角色数据新鲜。 */
  async function loadRoles() {
    try {
      const data = await api.get<PageResult<RoleRow>>('/api/platform/roles')
      setRoles(data.list.filter((role) => role.status === 'ENABLED'))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    }
  }

  async function openCreate() {
    createForm.resetFields()
    setCreateOpen(true)
    await loadRoles()
  }

  async function openEdit(row: UserRow) {
    setEditing(row)
    editForm.resetFields()
    editForm.setFieldsValue({ nickname: row.nickname ?? undefined, role_ids: [] })
    await loadRoles()
    // role_names 是 GROUP_CONCAT 的展示字符串，按名称映射回 role_id 预填
    try {
      const data = await api.get<PageResult<RoleRow>>('/api/platform/roles')
      const currentNames = (row.role_names ?? '').split(',').map((name) => name.trim())
      editForm.setFieldsValue({
        role_ids: data.list.filter((role) => currentNames.includes(role.name)).map((role) => role.role_id),
      })
    } catch {
      /* 角色映射失败时保持空选，用户手动勾选即可 */
    }
  }

  async function submitCreate() {
    const values = await createForm.validateFields()
    setBusy(true)
    try {
      await api.post('/api/platform/users', {
        mobile: values.mobile.trim(),
        password: values.password,
        nickname: values.nickname?.trim() || undefined,
        role_ids: values.role_ids,
      })
      message.success('账号已创建')
      setCreateOpen(false)
      setPage(1)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function submitEdit() {
    if (!editing) return
    const values = await editForm.validateFields()
    setBusy(true)
    try {
      await api.put(`/api/platform/users/${editing.user_id}`, {
        nickname: values.nickname?.trim() || undefined,
        role_ids: values.role_ids,
      })
      message.success('账号已更新')
      setEditing(null)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  /** 启停用走 platform PATCH（ACTIVE/DISABLED 口径），禁用即撤销该账号全部会话。 */
  async function toggleStatus(row: UserRow, checked: boolean) {
    const next = checked ? 'ACTIVE' : 'DISABLED'
    try {
      await api.patch(`/api/platform/users/${row.user_id}`, { status: next })
      message.success(checked ? '账号已启用' : '账号已禁用（会话已全部撤销）')
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    }
  }

  return (
    <Card
      title="账号管理"
      extra={
        <Space>
          <Input.Search
            allowClear
            placeholder="昵称 / 账号 / 手机号"
            style={{ width: 200 }}
            onSearch={(value) => {
              setKeyword(value.trim())
              setPage(1)
            }}
          />
          <Select
            allowClear
            placeholder="账号类型"
            style={{ width: 120 }}
            value={userType}
            onChange={(value) => {
              setUserType(value)
              setPage(1)
            }}
            options={[
              { value: 'ADMIN', label: '后台账号' },
              { value: 'TOURIST', label: '游客' },
            ]}
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
              { value: 'ACTIVE', label: '正常' },
              { value: 'DISABLED', label: '已禁用' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading} />
          <Permission code="system:user:add">
            <Button type="primary" icon={<PlusOutlined />} onClick={() => void openCreate()}>
              新建账号
            </Button>
          </Permission>
        </Space>
      }
    >
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      <Table<UserRow>
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
          { title: '账号', dataIndex: 'username', render: (v: string) => <Text strong>{v}</Text> },
          { title: '昵称', dataIndex: 'nickname', width: 130, render: (v: string | null) => v || '—' },
          { title: '手机号', dataIndex: 'masked_phone', width: 140, render: (v: string | null) => v || '—' },
          {
            title: '角色',
            dataIndex: 'role_names',
            render: (v: string | null) =>
              v ? (
                <Space wrap size={4}>
                  {v.split(',').map((name) => (
                    <Tag key={name} color="geekblue">
                      {name.trim()}
                    </Tag>
                  ))}
                </Space>
              ) : (
                '—'
              ),
          },
          {
            title: '所属机构',
            dataIndex: 'agency_name',
            width: 150,
            render: (v: string | null) => v || <Text type="secondary">平台直管</Text>,
          },
          { title: '最近登录', dataIndex: 'last_login_at', width: 170, render: (v: string | null) => v || '从未登录' },
          {
            title: '状态',
            dataIndex: 'status',
            width: 110,
            render: (v: UserRow['status'], row) =>
              // super 是内置超级管理员，Node 侧禁止变更，开关直接锁死避免点了必报错
              row.username === 'super' ? (
                <Space size={6}>
                  {statusTag(v)}
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    内置
                  </Text>
                </Space>
              ) : (
                <Permission code="system:user:update">
                  <Switch size="small" checked={v === 'ACTIVE'} onChange={(checked) => void toggleStatus(row, checked)} />
                </Permission>
              ),
          },
          {
            title: '操作',
            width: 80,
            render: (_, row) =>
              row.username === 'super' ? (
                <Text type="secondary">—</Text>
              ) : (
                <Permission code="system:user:update">
                  <a onClick={() => void openEdit(row)}>编辑</a>
                </Permission>
              ),
          },
        ]}
      />

      <Modal
        title="新建后台账号"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void submitCreate()}
        confirmLoading={busy}
        okText="创建"
        cancelText="取消"
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          message="账号名即手机号；创建后可在列表中编辑昵称与角色。"
          style={{ margin: '8px 0 12px' }}
        />
        <Form form={createForm} layout="vertical">
          <Form.Item
            name="mobile"
            label="手机号（登录账号）"
            rules={[
              { required: true, message: '请输入手机号' },
              { pattern: /^1\d{10}$/, message: '请输入 11 位手机号' },
            ]}
          >
            <Input placeholder="如：13800000001" maxLength={11} />
          </Form.Item>
          <Form.Item
            name="password"
            label="初始密码"
            rules={[
              { required: true, message: '请输入初始密码' },
              { min: 8, message: '至少 8 位' },
              { max: 72, message: '不超过 72 位' },
            ]}
          >
            <Input.Password placeholder="至少 8 位，建议字母 + 数字组合" autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="nickname" label="昵称" rules={[{ max: 50, message: '不超过 50 字' }]}>
            <Input placeholder="选填" />
          </Form.Item>
          <Form.Item
            name="role_ids"
            label="分配角色"
            rules={[{ required: true, message: '至少选择 1 个角色' }]}
          >
            <Select
              mode="multiple"
              placeholder="选择角色"
              options={roles.map((role) => ({
                value: role.role_id,
                label: `${role.name}（${role.code}）`,
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editing ? `编辑账号：${editing.username}` : '编辑账号'}
        open={editing !== null}
        onCancel={() => setEditing(null)}
        onOk={() => void submitEdit()}
        confirmLoading={busy}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        {editing && (
          <>
            <Alert
              type="warning"
              showIcon
              message="保存会全量覆盖角色：只保留本次勾选的角色，未勾选的将被移除。"
              style={{ margin: '8px 0 12px' }}
            />
            <Form form={editForm} layout="vertical">
              <Form.Item name="nickname" label="昵称" rules={[{ max: 50, message: '不超过 50 字' }]}>
                <Input />
              </Form.Item>
              <Form.Item
                name="role_ids"
                label="角色"
                rules={[{ required: true, message: '至少选择 1 个角色' }]}
              >
                <Select
                  mode="multiple"
                  placeholder="选择角色"
                  options={roles.map((role) => ({
                    value: role.role_id,
                    label: `${role.name}（${role.code}）`,
                  }))}
                />
              </Form.Item>
            </Form>
          </>
        )}
      </Modal>
    </Card>
  )
}
