/**
 * 通用 UI 组件：Toast、卡片、统计卡、标签、弹窗、分页、空态、骨架屏、异步加载 Hook。
 * 原则：组件只管渲染与交互，不写业务判断。
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError } from '../api/client';

/* ---------------- Toast ---------------- */
type ToastKind = 'info' | 'success' | 'error';
let toastListener: ((kind: ToastKind, text: string) => void) | null = null;

export const toast = {
  info(text: string) { toastListener?.('info', text); },
  success(text: string) { toastListener?.('success', text); },
  error(error: unknown, fallback = '操作失败') {
    const text = error instanceof ApiError ? error.message : error instanceof Error ? error.message : fallback;
    toastListener?.('error', text);
  }
};

export function ToastHost() {
  const [items, setItems] = useState<{ id: number; kind: ToastKind; text: string }[]>([]);
  useEffect(() => {
    toastListener = (kind, text) => {
      const id = Date.now() + Math.random();
      setItems((prev) => [...prev, { id, kind, text }]);
      window.setTimeout(() => setItems((prev) => prev.filter((item) => item.id !== id)), 3200);
    };
    return () => { toastListener = null; };
  }, []);
  if (items.length === 0) return null;
  return (
    <div className="toast-box">
      {items.map((item) => (
        <div key={item.id} className={`toast ${item.kind}`}>{item.text}</div>
      ))}
    </div>
  );
}

/* ---------------- 卡片 / 统计卡 ---------------- */
export function Card({ title, side, children, className }: { title?: ReactNode; side?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ''}`}>
      {(title || side) && (
        <h3 className="card-title">
          {title}
          {side && <span className="side">{side}</span>}
        </h3>
      )}
      {children}
    </section>
  );
}

export function StatCard(props: {
  icon: string; tone: string; label: string; value: ReactNode; delta?: string; deltaTrend?: 'up' | 'down' | 'flat';
}) {
  return (
    <div className="stat-card">
      <div className="stat-icon" style={{ background: props.tone }}>{props.icon}</div>
      <div className="stat-meta">
        <div className="stat-label">{props.label}</div>
        <div className="stat-value">{props.value}</div>
        {props.delta && (
          <div className={`stat-delta ${props.deltaTrend ?? 'flat'}`}>
            较昨日 {props.deltaTrend === 'down' ? '↓' : props.deltaTrend === 'up' ? '↑' : '→'} {props.delta}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- 状态标签 ---------------- */
const TAG_STYLE: Record<string, string> = {
  ON_SALE: 'tag on-sale', OFF_SALE: 'tag off-sale', DRAFT: 'tag draft',
  ACTIVE: 'tag on-sale', DISABLED: 'tag off-sale'
};
const TAG_TEXT: Record<string, string> = {
  ON_SALE: '在售', OFF_SALE: '已下架', DRAFT: '草稿', ACTIVE: '启用', DISABLED: '已停用'
};
export function StatusTag({ value }: { value: string }) {
  return <span className={TAG_STYLE[value] ?? 'tag plain'}>{TAG_TEXT[value] ?? value}</span>;
}

/* ---------------- 弹窗 ---------------- */
export function Modal(props: { title: string; wide?: boolean; onClose: () => void; footer?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') props.onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="modal-mask" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
      <div className={`modal ${props.wide ? 'wide' : ''}`}>
        <div className="modal-head">
          <h3>{props.title}</h3>
          <button className="x" onClick={props.onClose} aria-label="关闭">✕</button>
        </div>
        <div className="modal-body">{props.children}</div>
        {props.footer && <div className="modal-foot">{props.footer}</div>}
      </div>
    </div>
  );
}

/* ---------------- 分页 ---------------- */
export function Pagination(props: { page: number; size: number; total: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(props.total / props.size));
  const windowed: (number | '...')[] = [];
  for (let index = 1; index <= pages; index += 1) {
    if (index <= 2 || index > pages - 2 || Math.abs(index - props.page) <= 1) windowed.push(index);
    else if (windowed[windowed.length - 1] !== '...') windowed.push('...');
  }
  return (
    <div className="pagination">
      <span className="info">共 {props.total} 条 / {pages} 页</span>
      <button className="page-btn" disabled={props.page <= 1} onClick={() => props.onChange(props.page - 1)}>‹</button>
      {windowed.map((item, index) =>
        item === '...' ? (
          <span key={`ellipsis-${index}`} className="page-btn" style={{ border: 'none', cursor: 'default' }}>…</span>
        ) : (
          <button key={item} className={`page-btn ${item === props.page ? 'cur' : ''}`} onClick={() => props.onChange(item)}>{item}</button>
        )
      )}
      <button className="page-btn" disabled={props.page >= pages} onClick={() => props.onChange(props.page + 1)}>›</button>
    </div>
  );
}

/* ---------------- 空态（含「接口未开放」说明） ---------------- */
export function EmptyState(props: { icon: string; title: string; description: string; need?: ReactNode; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="icon">{props.icon}</div>
      <h3>{props.title}</h3>
      <p>{props.description}</p>
      {props.need && <div className="need">{props.need}</div>}
      {props.children}
    </div>
  );
}

/** 表格空行 */
export function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="table-empty">{text}</td>
    </tr>
  );
}

/* ---------------- 骨架 ---------------- */
export function Skeleton({ w, h }: { w?: number | string; h?: number | string }) {
  return <div className="skeleton" style={{ width: w ?? '100%', height: typeof h === 'number' ? `${h}px` : (h ?? '14px') }} />;
}

/* ---------------- 异步加载 Hook ---------------- */
export interface AsyncState<T> {
  loading: boolean;
  data: T | null;
  error: ApiError | null;
  reload: () => void;
}

export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [state, setState] = useState<{ loading: boolean; data: T | null; error: ApiError | null }>({ loading: true, data: null, error: null });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    let alive = true;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    loader().then(
      (data) => { if (alive) setState({ loading: false, data, error: null }); },
      (error) => { if (alive) setState({ loading: false, data: null, error: error instanceof ApiError ? error : new ApiError(0, 0, String(error)) }); }
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { ...state, reload };
}
