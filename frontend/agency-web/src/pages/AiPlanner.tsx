/**
 * 页面二：AI 智能规划。
 * 真实链路：POST /plans（后端智能体生成行程快照）→ PATCH /plans/{id}（按调整要求出新版本）
 * → 「转为旅游产品」POST /admin/routes（进入本社线路库）。
 * 后端响应如实返回 is_estimated=true（当前智能体为规则模板实现）。
 */
import { useState } from 'react';
import { createRoute, generatePlan, optimizePlan } from '../api/admin';
import { ApiError } from '../api/client';
import { Card, EmptyState, Modal, Skeleton, toast } from '../components/ui';
import type { PlanSnapshot } from '../types';

const PREFERENCE_TAGS = ['自然风光', '古城镇', '美食体验', '休闲度假', '摄影打卡', '民族风情', '历史人文', '亲子出行', '商务出行'];
const isoDate = (date: string) => `${date}T00:00:00.000Z`;
const addDays = (date: string, days: number) => {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
};
const fmtDate = (utc?: string) => (utc ? utc.slice(0, 10).replace(/-/g, '/').slice(5) : '');

interface PlannerForm {
  destination: string;
  departure: string;
  startDate: string;
  days: number;
  budget: string;
  adults: number;
  children: number;
  tags: string[];
  remark: string;
}

const initialForm: PlannerForm = {
  destination: '云南省（昆明、大理、丽江）',
  departure: '上海',
  startDate: new Date().toISOString().slice(0, 10),
  days: 6,
  budget: '',
  adults: 2,
  children: 0,
  tags: ['自然风光'],
  remark: ''
};

/** 把表单拼成一段自然语言需求，交给后端智能体解析 */
function buildPrompt(form: PlannerForm): string {
  const parts: string[] = [];
  if (form.departure.trim()) parts.push(`从${form.departure.trim()}出发`);
  parts.push(`规划${form.days}天行程`);
  parts.push(`${form.adults}位成人${form.children ? `、${form.children}位儿童` : ''}出行`);
  if (form.budget.trim()) parts.push(`预算${form.budget.trim()}元`);
  if (form.tags.length) parts.push(`偏好：${form.tags.join('、')}`);
  if (form.remark.trim()) parts.push(`其他要求：${form.remark.trim()}`);
  return parts.join('，');
}

export function PlannerScreen(props: { canCreateRoute: boolean }) {
  const [form, setForm] = useState<PlannerForm>(initialForm);
  const [plan, setPlan] = useState<PlanSnapshot | null>(null);
  const [generating, setGenerating] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [optimizing, setOptimizing] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);

  const patch = (value: Partial<PlannerForm>) => setForm((prev) => ({ ...prev, ...value }));
  const toggleTag = (tag: string) =>
    patch({ tags: form.tags.includes(tag) ? form.tags.filter((item) => item !== tag) : [...form.tags, tag].slice(0, 20) });

  const generate = async () => {
    if (!form.destination.trim()) { toast.info('请填写目的地'); return; }
    setGenerating(true);
    try {
      const body = {
        destination: form.destination.trim(),
        start_date: isoDate(form.startDate),
        end_date: isoDate(addDays(form.startDate, Math.max(1, Math.min(30, form.days)) - 1)),
        ...(form.budget.trim() ? { budget: form.budget.trim() } : {}),
        ...(form.tags.length ? { tags: form.tags } : {}),
        prompt: buildPrompt(form)
      };
      const data = await generatePlan(body);
      setPlan(data);
      toast.success('方案已生成');
    } catch (error) {
      if (error instanceof ApiError) toast.error(error);
      else toast.error(error, '生成失败');
    } finally {
      setGenerating(false);
    }
  };

  const optimize = async () => {
    if (!plan || !instruction.trim()) return;
    setOptimizing(true);
    try {
      const data = await optimizePlan(plan.plan_id, { instruction: instruction.trim() });
      setPlan(data);
      setInstruction('');
      toast.success('已按调整要求生成新版本');
    } catch (error) {
      if (error instanceof ApiError) toast.error(error);
    } finally {
      setOptimizing(false);
    }
  };

  const planTitle = plan?.plan_title ?? '';
  const daysCount = plan?.user_preference?.days_count ?? plan?.days.length ?? 0;
  const budget = plan?.estimated_total_budget_rmb;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>AI智能规划</h1>
          <p>利用平台 AI 能力快速生成旅行行程方案，可一键转为旅游产品上架</p>
        </div>
      </div>

      <div className="planner">
        {/* ------------ 左：需求设置 ------------ */}
        <Card title="出行需求设置">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="field">
              <label className="req">目的地</label>
              <input className="input" value={form.destination} onChange={(event) => patch({ destination: event.target.value })} placeholder="如：云南省（昆明、大理、丽江）" />
            </div>
            <div className="field">
              <label>出发地</label>
              <input className="input" value={form.departure} onChange={(event) => patch({ departure: event.target.value })} placeholder="如：上海" />
            </div>
            <div className="form-grid">
              <div className="field">
                <label>出发日期</label>
                <input className="input" type="date" value={form.startDate} onChange={(event) => patch({ startDate: event.target.value })} />
              </div>
              <div className="field">
                <label>行程天数</label>
                <input
                  className="input" type="number" min={1} max={30} value={form.days}
                  onChange={(event) => patch({ days: Number(event.target.value) || 1 })}
                />
              </div>
            </div>
            <div className="form-grid">
              <div className="field">
                <label>成人人数</label>
                <input className="input" type="number" min={1} max={100} value={form.adults} onChange={(event) => patch({ adults: Number(event.target.value) || 1 })} />
              </div>
              <div className="field">
                <label>儿童人数</label>
                <input className="input" type="number" min={0} max={50} value={form.children} onChange={(event) => patch({ children: Number(event.target.value) || 0 })} />
              </div>
            </div>
            <div className="field">
              <label>预算范围（元，可留空）</label>
              <input className="input" value={form.budget} onChange={(event) => patch({ budget: event.target.value })} placeholder="如：3000-5000 或 6000" />
            </div>
            <div className="field">
              <label>出行偏好（可多选）</label>
              <div className="chips">
                {PREFERENCE_TAGS.map((tag) => (
                  <button key={tag} type="button" className={`chip ${form.tags.includes(tag) ? 'on' : ''}`} onClick={() => toggleTag(tag)}>{tag}</button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>其他需求（选填）</label>
              <textarea
                className="textarea" maxLength={200} value={form.remark}
                onChange={(event) => patch({ remark: event.target.value })}
                placeholder="希望行程节奏不要太赶，可以多留一些自由活动时间。"
              />
              <div className="input-count">{form.remark.length}/200</div>
            </div>
            <button className="btn block" onClick={generate} disabled={generating}>
              {generating ? '⏳ 智能生成中…' : '✦ 生成智能方案'}
            </button>
          </div>
        </Card>

        {/* ------------ 右：方案预览 ------------ */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card
            title={plan ? `AI生成方案（ID: ${plan.plan_id}）` : 'AI生成方案'}
            side={
              plan && (
                <span style={{ display: 'flex', gap: 8 }}>
                  <button className="btn ghost sm" onClick={generate} disabled={generating}>⟳ 重新生成</button>
                  <button className="btn soft sm" onClick={() => setConvertOpen(true)} disabled={!props.canCreateRoute}>转为旅游产品</button>
                </span>
              )
            }
          >
            {generating ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Skeleton w="55%" h={22} />
                <Skeleton h={14} /><Skeleton h={14} /><Skeleton w="80%" h={14} />
                <Skeleton h={120} />
              </div>
            ) : !plan ? (
              <EmptyState
                icon="✦"
                title="还没有生成方案"
                description="在左侧填写出行需求并点击「生成智能方案」，AI 会自动规划每日行程、景点与交通衔接，生成结果仅供参考，可继续调整。"
              />
            ) : (
              <>
                <div className="plan-head">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h2>{planTitle || '未命名方案'}</h2>
                    <div className="plan-tags">
                      <span className="tag on-sale">推荐方案</span>
                      {plan.user_preference?.travel_style && <span className="tag info">{plan.user_preference.travel_style}</span>}
                      {plan.is_estimated && <span className="tag plain">预估方案（AI 模板生成）</span>}
                      {plan.user_preference?.destination_cities?.map((city) => <span key={city} className="tag purple">{city}</span>)}
                    </div>
                    <p className="plan-summary">{plan.summary_description || ''}</p>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '8px 0 2px' }}>
                  <b style={{ fontSize: 14 }}>每日行程安排</b>
                  <span className="tag on-sale">Version {plan.version ?? 1} · {plan.status ?? ''}</span>
                </div>
                {plan.days.map((day) => (
                  <div className="day-row" key={day.day_index}>
                    <div>
                      <span className="day-badge">DAY{day.day_index}</span>
                    </div>
                    <div>
                      <div className="day-title">{day.theme_title || day.city_name || '当日安排'}</div>
                      <div className="day-desc">
                        {[
                          ...(day.transfers ?? []).map((item) => `${item.origin ?? ''}➔${item.destination ?? ''}（${item.transport_mode ?? '交通'}，约${item.estimated_duration_minutes ?? '?'}分钟）`),
                          ...(day.morning_activities ?? []).map((item) => `上午：${item.attraction_name ?? item.activity_name ?? ''}${item.recommended_reason ? `，${item.recommended_reason}` : ''}`),
                          ...(day.afternoon_activities ?? []).map((item) => `下午：${item.attraction_name ?? item.activity_name ?? ''}${item.recommended_reason ? `，${item.recommended_reason}` : ''}`),
                          ...(day.evening_activities ?? []).map((item) => `晚间：${item.attraction_name ?? item.activity_name ?? ''}`)
                        ].join('；')}
                      </div>
                    </div>
                    <div className="day-side">
                      <b>{day.city_name || '—'}</b>
                      <span>{fmtDate(day.date_string)}</span>
                    </div>
                  </div>
                ))}
                <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--ink-400)' }}>
                  ⓘ 以上行程由平台智能体自动生成，可根据实际需求继续调整；当前生成引擎为规则模板（is_estimated=true）。
                </p>
              </>
            )}
          </Card>

          {plan && (
            <div className="grid grid-2">
              <Card title="智能优化">
                <div className="field">
                  <label>调整要求</label>
                  <textarea
                    className="textarea" maxLength={500} value={instruction}
                    onChange={(event) => setInstruction(event.target.value)}
                    placeholder="如：减少当日车程、Day3 换成洱海骑行、整体节奏放慢"
                  />
                </div>
                <button className="btn" style={{ marginTop: 10 }} onClick={optimize} disabled={optimizing || !instruction.trim()}>
                  {optimizing ? '调整中…' : '✦ 提交调整要求（生成新版本）'}
                </button>
              </Card>
              <Card title="费用预估">
                <div className="cost-row"><span>行程天数</span><span>{daysCount} 天</span></div>
                <div className="cost-row"><span>出发日期</span><span>{plan.start_date?.slice(0, 10) ?? '—'}</span></div>
                <div className="cost-row"><span>结束日期</span><span>{plan.end_date?.slice(0, 10) ?? '—'}</span></div>
                <div className="cost-row total"><span>预估总预算</span><span className="amt">¥{budget ?? '—'}{plan.is_estimated && ' 起'}</span></div>
              </Card>
            </div>
          )}
        </div>
      </div>

      {convertOpen && plan && (
        <ConvertModal
          plan={plan}
          daysCount={daysCount}
          onClose={() => setConvertOpen(false)}
          onDone={() => { setConvertOpen(false); toast.success('已转为旅游产品，可在「旅游产品管理」中查看'); }}
        />
      )}
    </>
  );
}

/** 转为旅游产品：把方案关键字段预填进发布表单，确认后走 POST /admin/routes */
function ConvertModal(props: { plan: PlanSnapshot; daysCount: number; onClose: () => void; onDone: () => void }) {
  const preference = props.plan.user_preference;
  const [title, setTitle] = useState((props.plan.plan_title || '').slice(0, 100));
  const [destination, setDestination] = useState(preference?.destination_cities?.join('、') ?? '');
  const [days, setDays] = useState(props.daysCount || 1);
  const [styleTag, setStyleTag] = useState((preference?.travel_style ?? '休闲').slice(0, 30));
  const [price, setPrice] = useState(preference?.budget_total_rmb ?? props.plan.estimated_total_budget_rmb ?? '');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      await createRoute({
        title: title.trim(),
        destination: destination.trim(),
        default_days: Math.max(1, Math.min(30, days)),
        style_tag: styleTag.trim() || '休闲',
        base_price_rmb: price.trim()
      });
      props.onDone();
    } catch (error) {
      if (error instanceof ApiError) toast.error(error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="转为旅游产品"
      onClose={props.onClose}
      footer={
        <>
          <button className="btn ghost" onClick={props.onClose}>取消</button>
          <button className="btn" onClick={submit} disabled={submitting || !title.trim() || !destination.trim() || !price.trim()}>
            {submitting ? '发布中…' : '确认发布到线路库'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field span2">
          <label className="req">线路名称</label>
          <input className="input" value={title} maxLength={100} onChange={(event) => setTitle(event.target.value)} />
        </div>
        <div className="field">
          <label className="req">目的地</label>
          <input className="input" value={destination} maxLength={100} onChange={(event) => setDestination(event.target.value)} />
        </div>
        <div className="field">
          <label className="req">行程天数（1-30）</label>
          <input className="input" type="number" min={1} max={30} value={days} onChange={(event) => setDays(Number(event.target.value) || 1)} />
        </div>
        <div className="field">
          <label className="req">风格标签</label>
          <input className="input" value={styleTag} maxLength={30} onChange={(event) => setStyleTag(event.target.value)} />
        </div>
        <div className="field">
          <label className="req">基础售价（元）</label>
          <input className="input" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="如：2680.00" />
        </div>
      </div>
      <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--ink-500)' }}>
        发布后线路状态为「在售」，可到「旅游产品管理」维护详情与按日期配置余位库存。
      </p>
    </Modal>
  );
}
