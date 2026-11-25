import { Button, Result } from 'antd'
import { useNavigate } from 'react-router-dom'

export default function ForbiddenPage() {
  const navigate = useNavigate()
  return (
    <Result
      status="403"
      title="403"
      subTitle="当前账号没有访问该页面的权限（权限码由 Node 下发，改角色后需重新登录）。"
      extra={
        <Button type="primary" onClick={() => navigate('/agency/dashboard')}>
          回到工作台
        </Button>
      }
    />
  )
}
