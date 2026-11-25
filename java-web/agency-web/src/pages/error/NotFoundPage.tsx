import { Button, Result } from 'antd'
import { useNavigate } from 'react-router-dom'

export default function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <Result
      status="404"
      title="404"
      subTitle="页面不存在，可能是地址输错或功能已下线。"
      extra={
        <Button type="primary" onClick={() => navigate('/agency/dashboard')}>
          回到工作台
        </Button>
      }
    />
  )
}
