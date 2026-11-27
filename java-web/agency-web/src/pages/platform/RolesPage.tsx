import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, Drawer, message, Space, Spin, Table, Tag, Tree } from 'antd'
import { ReloadOutlined, SafetyOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import type { DataNode } from 'antd/es/tree'
import { api, ApiError, qs } from '../../lib/http'
import type { MenuNode, PageResult, RoleRow } from '../../lib/types'

/** /v1/permissions 的按钮节点（types.ts 里已声明 PermissionButton，这里直接 import 也行） */
import type { PermissionsPayload } from '../../lib/types'

/** 把 Node 的"菜单树 + 扁平按钮"拼成 antd Tree 要的 DataNode 结构：
 *  按钮按 parent_id 挂回所属菜单节点下面。没有父级的按钮丢弃（本项目没有这种数据，防御一下）。 */
function buildTree(menus: MenuNode[], buttons: PermissionsPayload['buttons']): DataNode[] {
  const byParent = new Map<string, PermissionsPayload['buttons']>()
  for (const b of buttons) {
    if (!b.parent_id) continue
    const bucket = byParent.get(b.parent_id) ?? []
    bucket.push(b)
    byParent.set(b.parent_id, bucket)
  }
  // 递归转换；label 带上 code 方便对权限码（演示时老师看得懂）
  function convert(node: MenuNode): DataNode {
    const childMenus = (node.children ?? []).map(convert)
    const childButtons = (byParent.get(node.permission_id) ?? []).map((b) => ({
      key: b.permission_id,
      title: `${b.name}（${b.code}）`,
    }))
    const children = [...childMenus, ...childButtons]
    return {
      key: node.permission_id,
      title: `${node.name}（${node.code}）`,
      children: children.length > 0 ? children : undefined,
    }
  }
  return menus.map(convert)
}

/** 收集树里所有 key（用来判断"角色已授权 id 里哪些真实存在于当前权限树"） */
function collectKeys(nodes: DataNode[], into: Set<string>): void {
  for (const n of nodes) {
    into.add(String(n.key))
    if (n.children) collectKeys(n.children, into)
  }
}

/** 只收集叶子 key：Tree 勾选态用叶子渲染最稳（父节点勾选态由 antd 自动推导），
 *  保存时 Node 会自动补齐祖先菜单，所以只回传叶子不会丢权限。 */
function leafKeys(nodes: DataNode[], into: Set<string>): void {
  for (const n of nodes) {
    if (n.children && n.children.length > 0) leafKeys(n.children, into)
    else into.add(String(n.key))
  }
}

export default function RolesPage() {
  // ---- 角色列表状态（与 OrdersPage 同一套骨架） ----
  const [rows, setRows] = useState<RoleRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(10)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<PageResult<RoleRow>>(`/api/platform/roles${qs({ page, size })}`)
      setRows(data.list)
      setTotal(data.total)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [page, size])

  useEffect(() => {
    void load()
  }, [load])

  // ---- 权限抽屉状态 ----
  const [drawerRole, setDrawerRole] = useState<RoleRow | null>(null)
  const [treeData, setTreeData] = useState<DataNode[]>([])
  const [checkedKeys, setCheckedKeys] = useState<string[]>([])
  const [loadingTree, setLoadingTree] = useState(false)
  const [saving, setSaving] = useState(false)
  /** 保存失败必须显示在抽屉里：页面顶部 Alert 被抽屉遮罩盖住，用户会以为"点了没反应" */
  const [saveError, setSaveError] = useState<string | null>(null)

  /** 打开抽屉：并行拉"全量权限树"和"该角色已授权 id"，两个请求互不依赖所以 Promise.all */
  async function openPermissions(role: RoleRow) {
    setDrawerRole(role)
    setSaveError(null)
    setLoadingTree(true)
    try {
      const [perms, granted] = await Promise.all([
        api.get<PermissionsPayload>('/api/platform/permissions'),
        api.get<{ role_id: string; permission_ids: string[] }>(`/api/platform/roles/${role.role_id}/permissions`),
      ])
      const tree = buildTree(perms.list, perms.buttons)
      const all = new Set<string>()
      collectKeys(tree, all)
      const leaves = new Set<string>()
      leafKeys(tree, leaves)
      setTreeData(tree)
      // 已授权 id 里，只有真实存在且是叶子的才进勾选态；孤儿 id（权限被删过）自动忽略
      setCheckedKeys(granted.permission_ids.filter((id) => leaves.has(id)))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
      setDrawerRole(null)
    } finally {
      setLoadingTree(false)
    }
  }

  /** 保存：全量覆盖。Node 会补祖先菜单、清 Casbin 缓存、写审计日志 */
  async function savePermissions() {
    if (!drawerRole) return
    setSaving(true)
    setSaveError(null)
    try {
      await api.put(`/api/platform/roles/${drawerRole.role_id}/permissions`, {
        // 必须发 snake_case：Java 侧的 Jackson 全局是 SNAKE_CASE，
        // 发 permissionIds 会映射不上，后端拿到 null，Node 报 10001 参数错误
        permission_ids: checkedKeys,
      })
      message.success(`角色「${drawerRole.name}」权限已保存，受影响账号需重新登录生效`)
      setDrawerRole(null)
      await load() // permission_count 列变了，刷新列表
    } catch (e) {
      const text = e instanceof ApiError ? `${e.message}（HTTP ${e.status}）` : String(e)
      setSaveError(text)
      message.error('保存失败：' + text)
    } finally {
      setSaving(false)
    }
  }

  const columns: ColumnsType<RoleRow> = [
    { title: '角色名', dataIndex: 'name', width: 160 },
    { title: '编码', dataIndex: 'code', width: 160, render: (v: string) => <Tag color="geekblue">{v}</Tag> },
    { title: '描述', dataIndex: 'description', ellipsis: true, render: (v: string | null) => v || '—' },
    {
      title: '状态', dataIndex: 'status', width: 100,
      render: (v: string) => <Tag color={v === 'ENABLED' ? 'green' : 'default'}>{v}</Tag>,
    },
    { title: '成员数', dataIndex: 'user_count', width: 90 },
    { title: '权限数', dataIndex: 'permission_count', width: 90 },
    {
      title: '操作', width: 120,
      render: (_, row) => (
        <a onClick={() => void openPermissions(row)}>
          <SafetyOutlined /> 配置权限
        </a>
      ),
    },
  ]

  return (
    <Card
      title="角色与权限"
      extra={<Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading} />}
    >
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      <Table<RoleRow>
        rowKey="role_id"
        loading={loading}
        dataSource={rows}
        pagination={{
          current: page, pageSize: size, total,
          showTotal: (value) => `共 ${value} 条`,
          onChange: (nextPage, nextSize) => { setPage(nextPage); setSize(nextSize) },
        }}
        columns={columns}
      />

      <Drawer
        title={drawerRole ? `配置权限：${drawerRole.name}（${drawerRole.code}）` : '配置权限'}
        width={480}
        open={drawerRole !== null}
        onClose={() => setDrawerRole(null)}
        extra={
          <Space>
            <Button onClick={() => setDrawerRole(null)}>取消</Button>
            <Button type="primary" loading={saving} onClick={() => void savePermissions()}>保存</Button>
          </Space>
        }
      >
        {saveError && (
          <Alert type="error" showIcon message="保存失败" description={saveError} style={{ marginBottom: 12 }} />
        )}
        {loadingTree ? <Spin /> : <Tree checkable defaultExpandAll treeData={treeData} checkedKeys={checkedKeys} onCheck={(keys) => setCheckedKeys(keys as string[])} />}
      </Drawer>
    </Card>
  )
}