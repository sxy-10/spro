import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Alert, Button, Card, Form, Input, InputNumber, Select, Space, Spin } from 'antd'
import { api, ApiError, qs } from '../../lib/http'
import type { PageResult, RouteRow } from '../../lib/types'

interface FormValues {
  title: string
  destination: string
  default_days: number
  style_tag: string
  base_price_rmb: number
  status?: RouteRow['status']
}

/**
 * 线路表单：新建与编辑共用。
 *
 * <p>Node 没有"管理端单条详情"接口（S1 已冻结 Node），而列表接口返回了表单需要的全部字段，
 * 所以编辑时按 id 在列表里找一次回填。线路数量在演示规模内（<100），这个代价可以接受。
 */
export default function RouteFormPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const editing = Boolean(id)
  const [form] = Form.useForm<FormValues>()
  const [loading, setLoading] = useState(editing)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadExisting = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const data = await api.get<PageResult<RouteRow>>(`/api/agency/routes${qs({ page: 1, size: 100, sort: '-created_at' })}`)
      const row = data.list.find((item) => item.id === id)
      if (!row) {
        setError('没有找到这条线路，可能已被删除或不属于当前机构')
        return
      }
      form.setFieldsValue({
        title: row.title,
        destination: row.destination,
        default_days: row.default_days,
        style_tag: row.style_tag ?? '',
        base_price_rmb: Number(row.base_price_rmb),
        status: row.status,
      })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [form, id])

  useEffect(() => {
    void loadExisting()
  }, [loadExisting])

  async function onFinish(values: FormValues) {
    setBusy(true)
    setError(null)
    try {
      if (editing) {
        await api.patch(`/api/agency/routes/${id}`, {
          title: values.title,
          destination: values.destination,
          default_days: values.default_days,
          style_tag: values.style_tag,
          base_price_rmb: values.base_price_rmb,
          status: values.status,
        })
      } else {
        await api.post('/api/agency/routes', {
          title: values.title,
          destination: values.destination,
          default_days: values.default_days,
          style_tag: values.style_tag,
          base_price_rmb: values.base_price_rmb,
        })
      }
      navigate('/agency/routes')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={editing ? '编辑线路' : '新建线路'} extra={<Button onClick={() => navigate('/agency/routes')}>返回列表</Button>}>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin />
        </div>
      ) : (
        <Form form={form} layout="vertical" onFinish={(values) => void onFinish(values)} style={{ maxWidth: 560 }}>
          <Form.Item name="title" label="线路名称" rules={[{ required: true, message: '请输入线路名称' }]}>
            <Input maxLength={100} placeholder="如：成都 4 日人文深度游" />
          </Form.Item>
          <Form.Item name="destination" label="目的地" rules={[{ required: true, message: '请输入目的地' }]}>
            <Input maxLength={100} placeholder="如：成都" />
          </Form.Item>
          <Space size={16} style={{ display: 'flex' }}>
            <Form.Item name="default_days" label="默认天数" rules={[{ required: true, message: '请输入天数' }]} style={{ flex: 1 }}>
              <InputNumber min={1} max={30} style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="style_tag" label="风格标签" rules={[{ required: true, message: '请输入风格标签' }]} style={{ flex: 1 }}>
              <Input maxLength={30} placeholder="如：亲子 / 摄影" style={{ width: 200 }} />
            </Form.Item>
          </Space>
          <Form.Item name="base_price_rmb" label="基础价（元）" rules={[{ required: true, message: '请输入价格' }]}>
            <InputNumber min={0.01} max={999999999} precision={2} style={{ width: 200 }} />
          </Form.Item>
          {editing && (
            <Form.Item name="status" label="上架状态">
              <Select
                style={{ width: 200 }}
                options={[
                  { value: 'DRAFT', label: '草稿' },
                  { value: 'ON_SALE', label: '在售' },
                  { value: 'OFF_SALE', label: '已下架' },
                ]}
              />
            </Form.Item>
          )}
          <Button type="primary" htmlType="submit" loading={busy}>
            {editing ? '保存修改' : '创建线路'}
          </Button>
        </Form>
      )}
    </Card>
  )
}
