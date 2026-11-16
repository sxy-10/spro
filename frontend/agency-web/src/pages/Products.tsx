/**
 * 页面三：旅游产品管理。
 *   线路管理：GET /admin/routes + POST/PATCH /admin/routes（真实接口）
 *   特产管理：后端接口尚未开放，展示空态与所需契约
 */
import { useMemo, useState } from 'react';
import { createRoute, fetchRoutes, fetchStock, patchRoute } from '../api/admin';
import { ApiError } from '../api/client';
import { Card, EmptyRow, EmptyState, Modal, Pagination, Skeleton, StatusTag, toast, useAsync } from '../components/ui';
import type { RouteRow } from '../types';

const PAGE_SIZE = 10;

export function ProductsScreen(props: { canQuery: boolean; canAdd: boolean; canUpdate: boolean }) {
  const [tab, setTab] = useState<'routes' | 'specialties'>('routes');
  return (
    <>
      <div className="page-head">
        <div>
          <h1>旅游产品管理</h1>
          <p>维护本社线路产品与地方特产商品</p>
        </div>
        <div className="page-head-actions">
          <button className={`btn ${tab === 'routes' ? '' : 'ghost'}`} onClick={() => setTab('routes')}>线路管理</button>
          <button className={`btn ${tab === 'specialties' ? '' : 'ghost'}`} onClick={() => setTab('specialties')}>特产管理</button>
        </div>
      </div>
      {tab === 'routes' ? (
        <RoutesPanel canQuery={props.canQuery} canAdd={props.canAdd} canUpdate={props.canUpdate} />
      ) : (
        <SpecialtiesPanel />
      )}
    </>
  );
}

/* ==================== 线路管理 ==================== */

function RoutesPanel(props: { canQuery: boolean; canAdd: boolean; canUpdate: boolean }) {
  const state = useAsync(() => fetchRoutes({ size: 100 }), []);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<RouteRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [stockRoute, setStockRoute] = useState<RouteRow | null>(null);

  const list = state.data?.list ?? [];
  const filtered = useMemo(
    () =>
      list.filter((row) => {
        const hitKeyword = !keyword.trim() || row.title.includes(keyword.trim()) || row.destination.includes(keyword.trim());
        const hitStatus = !statusFilter || row.status === statusFilter;
        return hitKeyword && hitStatus;
      }),
    [list, keyword, statusFilter]
  );
  const pageList = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (!props.canQuery) {
    return (
      <Card>
        <EmptyState
          icon="🔒"
          title="无权查看线路库"
          description="需要「线路查询」权限（route:line:query）。当前账号未被授予该权限，请联系平台方开通。"
        />
      </Card>
    );
  }

  const toggleStatus = async (row: RouteRow) => {
    const next = row.status === 'ON_SALE' ? 'OFF_SALE' : 'ON_SALE';
    try {
      await patchRoute(row.route_id, { status: next });
      toast.success(next === 'ON_SALE' ? '已上架' : '已下架（逻辑删除，可重新上架）');
      state.reload();
    } catch (error) {
      if (error instanceof ApiError) toast.error(error);
    }
  };

  return (
    <Card
      title={`线路列表（本社共 ${state.data?.total ?? 0} 条）`}
      side={
        <span style={{ display: 'flex', gap: 8 }}>
          <input className="input" style={{ width: 180 }} placeholder="搜索名称/目的地" value={keyword} onChange={(event) => { setKeyword(event.target.value); setPage(1); }} />
          <select className="select" style={{ width: 120 }} value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}>
            <option value="">全部状态</option>
            <option value="ON_SALE">在售</option>
            <option value="OFF_SALE">已下架</option>
            <option value="DRAFT">草稿</option>
          </select>
          {props.canAdd && <button className="btn sm" onClick={() => setCreating(true)}>＋ 新建线路</button>}
        </span>
      }
    >
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>线路</th><th>目的地</th><th>天数</th><th>风格</th><th>售价</th><th>状态</th><th>创建时间(UTC)</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            {state.loading ? (
              <tr><td colSpan={8} className="table-empty"><Skeleton h={60} /></td></tr>
            ) : pageList.length === 0 ? (
              <EmptyRow colSpan={8} text="暂无线路，点击右上角「新建线路」或用 AI 规划一键生成" />
            ) : (
              pageList.map((row) => (
                <tr key={row.route_id}>
                  <td className="primary-cell"><b>{row.title}</b><span>{row.product_no}</span></td>
                  <td>{row.destination}</td>
                  <td>{row.default_days} 天</td>
                  <td>{row.style_tag ? <span className="tag info">{row.style_tag}</span> : '—'}</td>
                  <td>¥{row.base_price_rmb}</td>
                  <td><StatusTag value={row.status} /></td>
                  <td style={{ color: 'var(--ink-400)', fontSize: 12 }}>{row.created_at.replace('T', ' ').slice(0, 16)}</td>
                  <td>
                    <div className="actions">
                      {props.canUpdate && (
                        <>
                          <button className="link-btn" onClick={() => setEditing(row)}>编辑</button>
                          <button className="link-btn" onClick={() => setStockRoute(row)}>余位</button>
                          <button className={`link-btn ${row.status === 'ON_SALE' ? 'danger' : ''}`} onClick={() => void toggleStatus(row)}>
                            {row.status === 'ON_SALE' ? '下架' : '上架'}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Pagination page={page} size={PAGE_SIZE} total={filtered.length} onChange={setPage} />

      {(creating || editing) && (
        <RouteFormModal
          initial={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onDone={() => {
            setCreating(false);
            setEditing(null);
            state.reload();
          }}
        />
      )}
      {stockRoute && <StockModal route={stockRoute} onClose={() => setStockRoute(null)} />}
    </Card>
  );
}

/* ---------- 新建/编辑线路 ---------- */
function RouteFormModal(props: { initial: RouteRow | null; onClose: () => void; onDone: () => void }) {
  const isEdit = Boolean(props.initial);
  const [title, setTitle] = useState(props.initial?.title ?? '');
  const [destination, setDestination] = useState(props.initial?.destination ?? '');
  const [days, setDays] = useState(props.initial?.default_days ?? 4);
  const [styleTag, setStyleTag] = useState(props.initial?.style_tag ?? '');
  const [price, setPrice] = useState(props.initial?.base_price_rmb ?? '');
  const [description, setDescription] = useState(props.initial?.description ?? '');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      if (isEdit && props.initial) {
        await patchRoute(props.initial.route_id, {
          title: title.trim(),
          destination: destination.trim(),
          default_days: Math.max(1, Math.min(30, days)),
          style_tag: styleTag.trim() || null,
          base_price_rmb: price.trim(),
          description: description.trim() || null
        });
        toast.success('线路已更新');
      } else {
        await createRoute({
          title: title.trim(),
          destination: destination.trim(),
          default_days: Math.max(1, Math.min(30, days)),
          style_tag: styleTag.trim() || '休闲',
          base_price_rmb: price.trim()
        });
        toast.success('线路已发布（在售）');
      }
      props.onDone();
    } catch (error) {
      if (error instanceof ApiError) toast.error(error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={isEdit ? '编辑线路' : '新建线路'}
      onClose={props.onClose}
      footer={
        <>
          <button className="btn ghost" onClick={props.onClose}>取消</button>
          <button className="btn" onClick={submit} disabled={submitting || !title.trim() || !destination.trim() || !price.trim()}>
            {submitting ? '保存中…' : '保存'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field span2">
          <label className="req">线路名称（≤100 字）</label>
          <input className="input" value={title} maxLength={100} onChange={(event) => setTitle(event.target.value)} placeholder="如：云南丽江大理5日游" />
        </div>
        <div className="field">
          <label className="req">目的地（≤100 字）</label>
          <input className="input" value={destination} maxLength={100} onChange={(event) => setDestination(event.target.value)} placeholder="如：云南丽江" />
        </div>
        <div className="field">
          <label className="req">行程天数（1-30）</label>
          <input className="input" type="number" min={1} max={30} value={days} onChange={(event) => setDays(Number(event.target.value) || 1)} />
        </div>
        <div className="field">
          <label>风格标签（≤30 字）</label>
          <input className="input" value={styleTag} maxLength={30} onChange={(event) => setStyleTag(event.target.value)} placeholder="如：小团纯玩" />
        </div>
        <div className="field">
          <label className="req">基础售价（元）</label>
          <input className="input" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="如：2680.00" />
        </div>
        <div className="field span2">
          <label>线路介绍（选填，≤5000 字）</label>
          <textarea className="textarea" value={description} maxLength={5000} onChange={(event) => setDescription(event.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

/* ---------- 余位查看（公开接口 GET /routes/{id}/stock，仅在售线路） ---------- */
function StockModal(props: { route: RouteRow; onClose: () => void }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const query = useAsync(() => fetchStock(props.route.route_id, date), [props.route.route_id, date]);

  return (
    <Modal title={`余位查询 · ${props.route.title}`} onClose={props.onClose}>
      <div className="field">
        <label>出行日期</label>
        <input className="input" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
      </div>
      <div style={{ marginTop: 14 }}>
        {query.loading ? (
          <Skeleton h={70} />
        ) : query.error ? (
          <EmptyState
            icon="⚠️"
            title={query.error.isForbidden ? '无权查询' : query.error.message}
            description={query.error.isForbidden
              ? '余位接口为公开接口，403 通常意味着线路已被下架或机构隔离校验未通过。'
              : '该日期未配置库存时，平台返回余位 0 且不可售；请先由运营配置 route_stock。'}
          />
        ) : query.data ? (
          <div className="grid grid-3">
            <StatMini label="总名额" value={query.data.total_seats} />
            <StatMini label="可售余位" value={query.data.available_seats} />
            <StatMini label="可售状态" value={query.data.is_sellable ? '可售' : '不可售'} tone={query.data.is_sellable} />
          </div>
        ) : null}
      </div>
      <p style={{ margin: '14px 0 0', fontSize: 12, color: 'var(--ink-500)' }}>
        余位实时计算（total − locked − sold），由后端 route_stock 原子维护，本系统任何页面不做本地计算。
      </p>
    </Modal>
  );
}

function StatMini(props: { label: string; value: string | number; tone?: boolean }) {
  return (
    <div className="stat-card">
      <div className="stat-meta">
        <div className="stat-label">{props.label}</div>
        <div className="stat-value" style={{ color: props.tone === undefined ? undefined : props.tone ? 'var(--g-600)' : 'var(--danger)' }}>{props.value}</div>
      </div>
    </div>
  );
}

/* ==================== 特产管理（后端未开放） ==================== */
function SpecialtiesPanel() {
  return (
    <Card>
      <EmptyState
        icon="🛍️"
        title="特产管理 · 后端接口尚未开放"
        description="页面结构已按原型预留，等待后端提供特产（SPU）管理接口后即可接线。当前不会伪造数据。"
        need={
          <>
            <b>所需接口（规划中）：</b><br />
            <code>GET /v1/admin/specialties</code>&nbsp;&nbsp;分页查询（关键词/状态筛选）<br />
            <code>POST /v1/admin/specialties</code>&nbsp;&nbsp;新建特产（默认下架）<br />
            <code>PATCH /v1/admin/specialties/:id</code>&nbsp;&nbsp;编辑/上下架/改库存<br />
            <code>DELETE /v1/admin/specialties/:id</code>&nbsp;&nbsp;逻辑下架
          </>
        }
      />
    </Card>
  );
}
