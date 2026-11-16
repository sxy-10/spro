/**
 * 页面四~七：订单管理 / 客户管理 / 导游与团队管理 / 财务管理。
 * 后端接口尚未开放（三端实施方案 §5.2 只规划了 /admin/orders 两项），
 * 这些页面按原型布局给出「接口未开放」空态，并标注所需契约；不做任何伪造数据。
 * 后端补齐后，将 EmptyState 换成真实列表即可（网络层已就绪）。
 */
import { Card, EmptyState } from '../components/ui';

interface ComingSoonProps {
  icon: string;
  title: string;
  description: string;
  endpoints: { method: string; path: string; note: string }[];
  children?: React.ReactNode;
}

function ComingSoon(props: ComingSoonProps) {
  return (
    <Card>
      <EmptyState
        icon={props.icon}
        title={`${props.title} · 后端接口尚未开放`}
        description={props.description}
        need={
          <>
            <b>所需接口契约（三端实施方案 §5.2 / 后续排期）：</b><br />
            {props.endpoints.map((endpoint) => (
              <span key={endpoint.path} style={{ display: 'block', marginTop: 4 }}>
                <code>{`${endpoint.method} ${endpoint.path}`}</code>&nbsp;&nbsp;{endpoint.note}
              </span>
            ))}
          </>
        }
      >
        {props.children}
      </EmptyState>
    </Card>
  );
}

export function OrdersScreen() {
  return (
    <>
      <div className="page-head">
        <div><h1>订单管理</h1><p>管理客户订单，处理订单确认、退款、售后等业务</p></div>
      </div>
      <ComingSoon
        icon="📋"
        title="订单管理"
        description="页面结构（筛选区/状态页签/表格/详情抽屉/批量操作）已按原型预留。订单事务与库存锁位都在平台后端，B 端仅做查询与确认，不会在本页伪造订单。"
        endpoints={[
          { method: 'GET', path: '/v1/admin/orders?status=&route_id=&page=&size=', note: '本社订单分页（AGENCY_ADMIN 按 agency_id 隔离）' },
          { method: 'POST', path: '/v1/admin/orders/{id}/confirm', note: '确认处理 CREATED→CONFIRMED（幂等，重复确认返回 20010）' },
          { method: 'GET', path: '/v1/admin/orders/{id}', note: '订单详情（联系人脱敏）' }
        ]}
      />
    </>
  );
}

export function CustomersScreen() {
  return (
    <>
      <div className="page-head">
        <div><h1>客户管理</h1><p>管理客户信息，维护客户关系，提升客户服务质量</p></div>
      </div>
      <ComingSoon
        icon="👥"
        title="客户管理"
        description="客户建档、标签分组、跟进记录与订单关联等能力需要独立的客户域表与接口，当前后端尚未提供。"
        endpoints={[
          { method: 'GET', path: '/v1/admin/customers?level=&group=&page=', note: '客户分页（等级/标签/来源筛选）' },
          { method: 'POST', path: '/v1/admin/customers', note: '新建客户档案（姓名/手机/标签）' },
          { method: 'GET', path: '/v1/admin/customers/{id}', note: '客户详情 + 历史订单聚合' },
          { method: 'PATCH', path: '/v1/admin/customers/{id}', note: '备注/分组/跟进状态' }
        ]}
      />
    </>
  );
}

export function GuidesScreen() {
  return (
    <>
      <div className="page-head">
        <div><h1>导游与团队管理</h1><p>维护导游档案，按日期与线路排团</p></div>
      </div>
      <ComingSoon
        icon="🧑‍✈️"
        title="导游与团队管理"
        description="导游档案、排团与团队状态流转（待排团→满员→已出团）需要排团域接口，当前后端尚未提供。"
        endpoints={[
          { method: 'GET/POST', path: '/v1/admin/guides', note: '导游档案（语言/联系方式/状态）' },
          { method: 'GET/POST', path: '/v1/admin/teams', note: '团队管理（线路+出行日期+人数上限）' },
          { method: 'PUT', path: '/v1/admin/teams/{team_no}', note: '排团（分配导游）/ 状态流转' }
        ]}
      />
    </>
  );
}

export function FinanceScreen() {
  return (
    <>
      <div className="page-head">
        <div><h1>财务管理</h1><p>收支流水、月度汇总与对账</p></div>
      </div>
      <ComingSoon
        icon="💰"
        title="财务管理"
        description="财务汇总与流水登记需要独立的财务域接口；金额一律为字符串保留 2 位小数，与平台契约一致。"
        endpoints={[
          { method: 'GET', path: '/v1/admin/finance/summary?month=', note: '月度汇总（收入/支出/净额）' },
          { method: 'GET', path: '/v1/admin/finance/flows?type=&page=', note: '流水分页（收入/支出筛选）' },
          { method: 'POST', path: '/v1/admin/finance/flows', note: '登记流水（幂等）' }
        ]}
      />
    </>
  );
}
