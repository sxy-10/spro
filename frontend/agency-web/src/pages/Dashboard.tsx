/**
 * 页面一：旅行社工作台。
 * 真实数据源：GET /admin/analytics（咨询/方案/转化率/热门目的地）+ GET /admin/routes（本社线路统计）。
 */
import { fetchAnalytics, fetchRoutes } from '../api/admin';
import { BarList } from '../components/charts';
import { Card, EmptyState, Skeleton, StatCard, StatusTag, useAsync } from '../components/ui';
import type { RouteRow } from '../types';

const formatDateTime = (utc: string) => utc.replace('T', ' ').slice(0, 16) + ' UTC';

export function DashboardScreen(props: { onNavigate: (key: string) => void }) {
  const analytics = useAsync(() => fetchAnalytics(), []);
  const routes = useAsync(() => fetchRoutes({ size: 100 }), []);

  const list = routes.data?.list ?? [];
  const onSale = list.filter((row) => row.status === 'ON_SALE').length;
  const offSale = list.filter((row) => row.status === 'OFF_SALE').length;

  if (analytics.error?.isForbidden) {
    return (
      <Card>
        <EmptyState
          icon="🔒"
          title="无权查看看板"
          description="工作台数据需要「订单看板查询」权限（order:manage:query）。当前账号未被授予该权限，请联系平台方在角色管理中开通。"
        />
      </Card>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>旅行社工作台</h1>
          <p>本社经营概况：咨询、方案生成、产品与转化一览</p>
        </div>
        <div className="page-head-actions">
          <button className="btn soft" onClick={() => props.onNavigate('planner')}>✦ AI智能规划</button>
          <button className="btn" onClick={() => props.onNavigate('products')}>＋ 发布线路</button>
        </div>
      </div>

      <div className="grid grid-6">
        <StatCard icon="💬" tone="#dcfce7" label="咨询总数" value={analytics.loading ? <Skeleton w={64} h={22} /> : analytics.data?.total_consultations ?? '—'} />
        <StatCard icon="🧭" tone="#dbeafe" label="生成方案数" value={analytics.loading ? <Skeleton w={64} h={22} /> : analytics.data?.plans_generated_count ?? '—'} />
        <StatCard icon="📈" tone="#ede9fe" label="成单转化率" value={analytics.loading ? <Skeleton w={64} h={22} /> : `${analytics.data?.conversion_rate_percent ?? '—'}%`} />
        <StatCard icon="🗺️" tone="#dcfce7" label="本社线路" value={routes.loading ? <Skeleton w={64} h={22} /> : routes.data?.total ?? '—'} />
        <StatCard icon="✅" tone="#e0f2fe" label="在售线路" value={routes.loading ? <Skeleton w={64} h={22} /> : onSale} />
        <StatCard icon="⏸️" tone="#fef3c7" label="已下架线路" value={routes.loading ? <Skeleton w={64} h={22} /> : offSale} />
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <Card title="热门目的地咨询分布" side={analytics.error ? '数据加载失败' : '来自 C 端偏好统计'}>
          {analytics.loading ? (
            <Skeleton h={150} />
          ) : analytics.data && analytics.data.popular_destinations.length > 0 ? (
            <BarList items={analytics.data.popular_destinations.map((row) => ({ label: row.city, value: row.count }))} />
          ) : (
            <EmptyState icon="🏜️" title="暂无偏好数据" description="游客在 C 端提交旅行偏好后，这里会按目的地汇总展示。" />
          )}
        </Card>

        <Card title="最近上线线路" side={<button className="link-btn" onClick={() => props.onNavigate('products')}>查看全部 ›</button>}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>线路</th><th>天数</th><th>售价</th><th>状态</th></tr>
              </thead>
              <tbody>
                {routes.loading ? (
                  <tr><td colSpan={4} className="table-empty"><Skeleton h={40} /></td></tr>
                ) : list.length === 0 ? (
                  <tr><td colSpan={4} className="table-empty">还没有线路，去「旅游产品管理」发布第一条吧</td></tr>
                ) : (
                  list.slice(0, 5).map((row: RouteRow) => (
                    <tr key={row.route_id}>
                      <td className="primary-cell"><b>{row.title}</b><span>{row.destination}</span></td>
                      <td>{row.default_days} 天</td>
                      <td>¥{row.base_price_rmb}</td>
                      <td><StatusTag value={row.status} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="grid grid-3" style={{ marginTop: 16 }}>
        <Card title="快捷操作">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button className="btn soft block" onClick={() => props.onNavigate('planner')}>✦ 生成旅行方案并转为产品</button>
            <button className="btn ghost block" onClick={() => props.onNavigate('products')}>🛫 线路管理 / 配置余位</button>
            <button className="btn ghost block" onClick={() => props.onNavigate('settings')}>⚙️ 旅行社资料与子账号</button>
          </div>
        </Card>
        <Card title="数据说明">
          <p style={{ margin: 0, color: 'var(--ink-500)', fontSize: 13, lineHeight: 1.8 }}>
            咨询总数与方案数来自平台 C 端对话与行程生成埋点；转化率 = 支付订单 / 生成方案。
            线路数据按本机构（agency）隔离，仅统计本社产品。
          </p>
        </Card>
        <Card title="最近动态">
          {routes.loading ? (
            <Skeleton h={90} />
          ) : list.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--ink-400)', fontSize: 13 }}>暂无动态</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
              {list.slice(0, 4).map((row) => (
                <div key={row.route_id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span>•</span>
                  <span style={{ flex: 1, color: 'var(--ink-700)' }}>线路「{row.title}」创建</span>
                  <span style={{ color: 'var(--ink-400)', fontSize: 12 }}>{formatDateTime(row.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
