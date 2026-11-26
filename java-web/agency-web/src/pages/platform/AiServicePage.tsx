import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  Input,
  Modal,
  Progress,
  Row,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { ApiOutlined, ReloadOutlined } from '@ant-design/icons'
import { api, ApiError } from '../../lib/http'
import type { AiServiceData, AiToolDistribution } from '../../lib/types'
import { useAuth } from '../../lib/auth'

const { Text, Paragraph } = Typography

const fmtTime = (value: string | null) => (value ? value.slice(0, 19).replace('T', ' ') : value)

/** tools_json 五开关的中文名与顺序。 */
const TOOLS: Array<{ key: string; label: string }> = [
  { key: 'attractions', label: '景点查询' },
  { key: 'transport', label: '交通查询' },
  { key: 'hotel', label: '酒店查询' },
  { key: 'food', label: '美食推荐' },
  { key: 'weather', label: '天气查询' },
]

interface TestResult {
  ok: boolean
  model: string
  latency_ms: number
  tokens: number | null
  reply: string
  provider: string
  base_url: string
}

export default function AiServicePage() {
  const { can } = useAuth()
  const [data, setData] = useState<AiServiceData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [configOpen, setConfigOpen] = useState(false)
  const [persona, setPersona] = useState('')
  const [modelParams, setModelParams] = useState('')
  const [tools, setTools] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [testError, setTestError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await api.get<AiServiceData>('/api/platform/ai-service')
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

  const canConfig = can('ai:service:config')

  const openConfig = () => {
    if (!data) return
    setPersona(data.config?.persona ?? '')
    setModelParams(data.config?.model_params ?? '')
    let parsed: Record<string, unknown> = {}
    try {
      parsed = data.config?.tools_json ? (JSON.parse(data.config.tools_json) as Record<string, unknown>) : {}
    } catch {
      parsed = {}
    }
    // 未配置过的开关默认开（与客服端默认全开一致）
    setTools(Object.fromEntries(TOOLS.map((t) => [t.key, parsed[t.key] !== false])))
    setConfigOpen(true)
  }

  const saveConfig = async () => {
    setSaving(true)
    try {
      await api.put('/api/platform/ai-service/config', {
        persona: persona.trim() || undefined,
        model_params: modelParams.trim() || undefined,
        tools,
      })
      message.success('配置已保存')
      setConfigOpen(false)
      void load()
    } catch (e) {
      message.error(e instanceof ApiError ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const runTest = async () => {
    setTesting(true)
    setTestResult(null)
    setTestError(null)
    try {
      const result = await api.post<TestResult>('/api/platform/ai-service/test', {})
      setTestResult(result)
    } catch (e) {
      setTestError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setTesting(false)
    }
  }

  if (loading && !data) {
    return (
      <Card title="AI 智能服务">
        <div style={{ textAlign: 'center', padding: 60 }}>
          <Spin tip="加载 AI 服务运行数据…" />
        </div>
      </Card>
    )
  }

  const kpi = data?.kpi
  const maxCalls = Math.max(...(data?.tool_distribution ?? []).map((item) => Number(item.calls)), 1)

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {error && <Alert type="error" showIcon message={error} />}
      <Card
        title="AI 智能服务"
        extra={
          <Space>
            {canConfig && (
              <>
                <Button onClick={() => void runTest()} loading={testing} icon={<ApiOutlined />}>
                  连通性测试
                </Button>
                <Button type="primary" onClick={openConfig}>
                  编辑配置
                </Button>
              </>
            )}
            <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading} />
          </Space>
        }
      >
        <Row gutter={[16, 16]}>
          <Col span={4}>
            <Card size="small"><StatisticBox label="今日会话" value={kpi?.today_sessions} suffix="个" /></Card>
          </Col>
          <Col span={4}>
            <Card size="small"><StatisticBox label="进行中会话" value={kpi?.active_sessions} suffix="个" /></Card>
          </Col>
          <Col span={4}>
            <Card size="small"><StatisticBox label="今日消息" value={kpi?.today_messages} suffix="条" /></Card>
          </Col>
          <Col span={4}>
            <Card size="small"><StatisticBox label="今日工具调用" value={kpi?.today_tool_calls} suffix="次" /></Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <StatisticBox
                label="平均响应耗时"
                value={kpi?.avg_latency_ms ? Math.round(Number(kpi.avg_latency_ms)) : '0'}
                suffix="ms"
              />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <StatisticBox
                label="超24h未关闭"
                value={kpi?.unclosed_sessions}
                suffix="个"
                highlight={Number(kpi?.unclosed_sessions ?? 0) > 0}
              />
            </Card>
          </Col>
        </Row>
        <Space style={{ marginTop: 16 }} wrap>
          <Tag color={data?.llm.enabled ? 'green' : 'red'}>
            {data?.llm.enabled ? '智能体服务已启用' : '智能体服务已停用'}
          </Tag>
          <Text type="secondary">
            供应商 {data?.llm.provider} · 模型 {data?.llm.model} ·{' '}
            {data?.llm.key_configured ? '密钥已配置' : '密钥未配置（自检会失败）'}
          </Text>
        </Space>
        {testResult && (
          <Alert
            type="success"
            showIcon
            style={{ marginTop: 12 }}
            message={`连通正常：${testResult.model} / ${testResult.latency_ms}ms / ${testResult.tokens ?? '-'} tokens`}
            description={`模型回复：${testResult.reply}`}
          />
        )}
        {testError && <Alert type="error" showIcon style={{ marginTop: 12 }} message={`连通失败：${testError}`} />}
      </Card>

      <Row gutter={16}>
        <Col span={12}>
          <Card title="工具调用分布（累计）">
            {(data?.tool_distribution ?? []).map((item: AiToolDistribution) => (
              <div key={item.tool_name} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text strong>{item.tool_name}</Text>
                  <Text type="secondary">
                    {item.calls} 次 · 成功 {item.success_calls} / 失败 {item.failed_calls}
                  </Text>
                </div>
                <Progress
                  percent={Math.round((Number(item.calls) / maxCalls) * 100)}
                  showInfo={false}
                  strokeColor={Number(item.failed_calls) > 0 ? '#faad14' : '#1677ff'}
                />
              </div>
            ))}
            {(data?.tool_distribution ?? []).length === 0 && <Text type="secondary">暂无调用记录</Text>}
          </Card>
        </Col>
        <Col span={12}>
          <Card title="热门提问 Top5">
            {(data?.hot_questions ?? []).map((item, index) => (
              <div key={index} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                <Text ellipsis style={{ maxWidth: '80%' }}>{item.content}</Text>
                <Text type="secondary">{item.cnt} 次</Text>
              </div>
            ))}
            {(data?.hot_questions ?? []).length === 0 && <Text type="secondary">暂无提问记录</Text>}
          </Card>
        </Col>
      </Row>

      <Card title="异常会话（工具失败/超时 或 超24小时未关闭）">
        <Table
          rowKey="session_id"
          dataSource={data?.abnormal_sessions ?? []}
          pagination={false}
          size="small"
          columns={[
            { title: '会话ID', dataIndex: 'session_id', width: 220, render: (v: string) => <Text code>{v}</Text> },
            { title: '标题', dataIndex: 'title', ellipsis: true, render: (v: string | null) => v || '—' },
            { title: '用户', dataIndex: 'user_id', width: 200 },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (v: string) => <Tag color={v === 'ACTIVE' ? 'orange' : 'default'}>{v === 'ACTIVE' ? '进行中' : '已关闭'}</Tag>,
            },
            { title: '最近活跃', dataIndex: 'last_active_at', width: 170, render: fmtTime },
          ]}
        />
      </Card>

      <Modal
        title="编辑 AI 服务配置"
        open={configOpen}
        onCancel={() => setConfigOpen(false)}
        onOk={() => void saveConfig()}
        confirmLoading={saving}
        okText="保存"
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <div>
            <Text strong>人设提示词（persona）</Text>
            <Input.TextArea
              rows={4}
              maxLength={255}
              showCount
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              placeholder="客服智能体的角色设定，如：你是XX旅行社的贴心客服…"
            />
          </div>
          <div>
            <Text strong>模型参数（model_params）</Text>
            <Input
              maxLength={255}
              value={modelParams}
              onChange={(e) => setModelParams(e.target.value)}
              placeholder="如 temperature=0.6,max_tokens=1024"
            />
          </div>
          <div>
            <Text strong>工具开关</Text>
            <div style={{ marginTop: 8 }}>
              {TOOLS.map((tool) => (
                <div key={tool.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                  <Text>{tool.label}</Text>
                  <Switch
                    checked={tools[tool.key] !== false}
                    onChange={(checked) => setTools((prev) => ({ ...prev, [tool.key]: checked }))}
                  />
                </div>
              ))}
            </div>
          </div>
          <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
            工具开关只关闭对应查询能力，不影响基础对话；保存立即生效。
          </Paragraph>
        </Space>
      </Modal>
    </Space>
  )
}

function StatisticBox({
  label,
  value,
  suffix,
  highlight,
}: {
  label: string
  value: string | number | undefined
  suffix: string
  highlight?: boolean
}) {
  return (
    <div>
      <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color: highlight ? '#fa541c' : undefined }}>
        {value ?? 0}
        <span style={{ fontSize: 12, fontWeight: 400, marginLeft: 4 }}>{suffix}</span>
      </div>
    </div>
  )
}
