import { Button, Result } from 'antd'
import { useNavigate } from 'react-router-dom'

export default function ServerErrorPage() {
  const navigate = useNavigate()
  return (
    <Result
      status="500"
      title="500"
      subTitle="服务器开小差了，请稍后重试；若持续出现，请联系管理员并提供 trace_id。"
      extra={
        <Button type="primary" onClick={() => navigate('/')}>
          回到首页
        </Button>
      }
    />
  )
}
