import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Input, Space, Spin, Table, Tag, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { api, ApiError } from '../../lib/http'
import type { SystemMeta } from '../../lib/types'

const { Text } = Typography

const fmtTime = (value: string | null) => (value ? value.slice(0, 19).replace('T', ' ') : value)

/** sys_dict 里出现过的 dict_type 中文映射；未知类型直接显示原值。 */
const DICT_TYPE_NAMES: Record<string, string> = {
  destination: '目的地',
  category: '特产品类',
  tag: '偏好标签',
  banner: '轮播位',
  common: '通用配置',
  city: '客源城市',
  departure_city: '出发城市',
  ethnic: '民族',
  food: '美食',
  season: '季节',
  style: '玩法风格',
  style_tag: '风格标签',
}

export default function SystemMetaPage() {
  const [data, setData] = useState<SystemMeta | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [dictTypeFilter, setDictTypeFilter] = useState<string | undefined>()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await api.get<SystemMeta>('/api/platform/system-meta')
      setData(next)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const dictTypes = useMemo(
    () => Array.from(new Set((data?.dicts ?? []).map((item) => item.dict_type))),
    [data],
  )

  const filteredDicts = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return (data?.dicts ?? []).filter((item) => {
      if (dictTypeFilter && item.dict_type !== dictTypeFilter) return false
      if (!kw) return true
      return (
        item.dict_key.toLowerCase().includes(kw) ||
        item.dict_value.toLowerCase().includes(kw)
      )
    })
  }, [data, keyword, dictTypeFilter])

  const filteredLogs = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return data?.audit_logs ?? []
    return (data?.audit_logs ?? []).filter((item) =>
      [item.operator_name, item.action, item.object_type, item.object_no, item.detail]
        .join(' ')
        .toLowerCase()
        .includes(kw),
    )
  }, [data, keyword])

  if (loading && !data) {
    return (
      <Card title="系统参数">
        <div style={{ textAlign: 'center', padding: 60 }}>
          <Spin tip="加载系统元数据…" />
        </div>
      </Card>
    )
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {error && <Alert type="error" showIcon message={error} />}
      <Card
        title="系统字典（sys_dict）"
        extra={
          <Space>
            <Input.Search
              allowClear
              placeholder="搜索键 / 值 / 日志"
              style={{ width: 220 }}
              onSearch={(value) => setKeyword(value.trim())}
            />
            <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading} />
          </Space>
        }
      >
        <Space style={{ marginBottom: 12 }} wrap>
          <Tag
            style={{ cursor: 'pointer' }}
            color={!dictTypeFilter ? 'geekblue' : 'default'}
            onClick={() => setDictTypeFilter(undefined)}
          >
            全部
          </Tag>
          {dictTypes.map((type) => (
            <Tag
              key={type}
              style={{ cursor: 'pointer' }}
              color={dictTypeFilter === type ? 'geekblue' : 'default'}
              onClick={() => setDictTypeFilter(type)}
            >
              {DICT_TYPE_NAMES[type] ?? type}
            </Tag>
          ))}
        </Space>
        <Table
          rowKey={(row) => `${row.dict_type}-${row.dict_key}`}
          size="small"
          dataSource={filteredDicts}
          pagination={{ pageSize: 10, showTotal: (value) => `共 ${value} 条` }}
          columns={[
            { title: '类型', dataIndex: 'dict_type', width: 120, render: (v: string) => DICT_TYPE_NAMES[v] ?? v },
            { title: '键', dataIndex: 'dict_key', width: 180, render: (v: string) => <Text code>{v}</Text> },
            { title: '值', dataIndex: 'dict_value', ellipsis: true },
            { title: '排序', dataIndex: 'sort', width: 70, align: 'right' },
          ]}
        />
      </Card>

      <Card title="操作审计日志（最近 50 条，sys_audit_log）">
        <Table
          rowKey={(row) => `${row.trace_id ?? 'x'}-${row.created_at}-${row.object_no}`}
          size="small"
          dataSource={filteredLogs}
          pagination={{ pageSize: 10, showTotal: (value) => `共 ${value} 条` }}
          columns={[
            { title: '操作人', dataIndex: 'operator_name', width: 110, render: (v: string | null) => v || <Text type="secondary">已注销</Text> },
            { title: '动作', dataIndex: 'action', width: 130 },
            {
              title: '对象类型',
              dataIndex: 'object_type',
              width: 110,
              render: (v: string) => <Tag>{v}</Tag>,
            },
            { title: '对象编号', dataIndex: 'object_no', width: 180, render: (v: string) => <Text code>{v}</Text> },
            { title: '详情', dataIndex: 'detail', ellipsis: true, render: (v: string) => v || '—' },
            {
              title: '链路ID',
              dataIndex: 'trace_id',
              width: 140,
              render: (v: string | null) => (v ? <Text code style={{ fontSize: 12 }}>{v.slice(0, 8)}…</Text> : '—'),
            },
            { title: '时间', dataIndex: 'created_at', width: 170, render: fmtTime },
          ]}
        />
      </Card>
    </Space>
  )
}
