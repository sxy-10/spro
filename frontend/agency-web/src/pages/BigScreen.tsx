/**
 * 第 5 棒 · 组员5（agency-web · 实时大屏 BigScreen）
 *
 * 对应分工文档 5.2 / 5.3：在线人数 / 今日订单 / 消息吞吐 / 秒杀 QPS 四块 + 折线；
 * 1s 补间、异常红闪；断开自动重连；**不轮询、不再秒打库**。
 *
 * 数据契约（第 2 棒 statsRouter.ts，每 5s 一拍）：
 *   { online_count, online_conn, today_order_count, message_count, seckill_qps, ts, degraded[] }
 *   - 服务端 5s 聚合一次、一条 SQL，10 个大屏窗口也只打一次库 —— 前端只消费不轮询；
 *   - degraded 标明哪些指标是降级值（Redis 不可用 / MySQL 异常）→ 对应块红闪；
 *   - 服务端推 event: error（单拍采集失败）→ 顶部横幅红闪，流不断。
 *
 * 取数通道：lib/sse.ts（fetch 流式实现，与 EventSource 同协议语义 ——
 * 原生 EventSource 无法携带 Authorization 头，取舍说明见该文件头注释）。
 *
 * 两个演示口径（答辩要讲得清）：
 *   - 「1s 补间」：数字从旧值滑到新值用 1s 缓动（rAF），大屏观感平滑，不掩盖 5s 一拍的真实节奏；
 *   - 「秒杀 QPS」= 最近 10s 实际成交订单数 / 10（下单速率口径，第 2 棒注释原文）。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getAccessToken } from '@auth';
import { openLiveStats, type LiveSnapshot } from '../lib/sse';

const HISTORY_LIMIT = 60; // 折线保留最近 60 拍（5s 一拍 ≈ 5 分钟窗口）
const TWEEN_MS = 1000; // 分工文档要求：1s 补间

/* ---------------- 单个数字的 1s 缓动 ---------------- */

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

interface AnimatedNumberProps {
  value: number;
  decimals?: number;
}

const AnimatedNumber: React.FC<AnimatedNumberProps> = ({ value, decimals = 0 }) => {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = display;
    fromRef.current = from;
    const startTs = performance.now();
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);

    const tick = (now: number): void => {
      const progress = Math.min((now - startTs) / TWEEN_MS, 1);
      const eased = easeOutCubic(progress);
      setDisplay(from + (value - from) * eased);
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
      else rafRef.current = null;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <span className="bs-number">
      {display.toLocaleString('zh-CN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
    </span>
  );
};

/* ---------------- 迷你折线（SVG polyline，无第三方图表库） ---------------- */

const Sparkline: React.FC<{ points: number[] }> = ({ points }) => {
  const path = useMemo(() => {
    if (points.length < 2) return '';
    const max = Math.max(...points, 1);
    const min = Math.min(...points, 0);
    const span = Math.max(max - min, 1e-9);
    const width = 100;
    const height = 32;
    return points
      .map((v, i) => {
        const x = (i / (points.length - 1)) * width;
        const y = height - ((v - min) / span) * (height - 4) - 2;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  }, [points]);

  if (!path) return <div className="bs-sparkline bs-sparkline-empty">等待数据…</div>;
  return (
    <svg className="bs-sparkline" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

/* ---------------- 大屏主体 ---------------- */

interface MetricBlock {
  key: string;
  label: string;
  sub: string;
  decimals: number;
  /** degraded[] 里出现哪些标记时该块红闪 */
  degradeMarks: string[];
  pick: (s: LiveSnapshot) => number;
}

const METRICS: MetricBlock[] = [
  {
    key: 'online',
    label: '在线人数',
    sub: 'WS 真实在线（去重）· 括号内为连接数',
    decimals: 0,
    degradeMarks: ['online_count', 'online_conn'],
    pick: (s) => s.online_count
  },
  {
    key: 'orders',
    label: '今日订单',
    sub: 'MySQL tour_order 当日计数',
    decimals: 0,
    degradeMarks: ['mysql'],
    pick: (s) => s.today_order_count
  },
  {
    key: 'messages',
    label: '消息吞吐',
    sub: 'Redis im:stat:msg（缺失回退当日 SQL）',
    decimals: 0,
    degradeMarks: ['message_count', 'mysql'],
    pick: (s) => s.message_count
  },
  {
    key: 'qps',
    label: '秒杀 QPS',
    sub: '最近 10s 成交订单数 ÷ 10（下单速率口径）',
    decimals: 2,
    degradeMarks: ['mysql'],
    pick: (s) => s.seckill_qps
  }
];

export const BigScreen: React.FC = () => {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [downReason, setDownReason] = useState('');
  const [serverError, setServerError] = useState('');
  const [redFlash, setRedFlash] = useState(false);
  const [history, setHistory] = useState<Record<string, number[]>>({});

  useEffect(() => {
    const handle = openLiveStats({
      getToken: () => getAccessToken(),
      onOpen: () => {
        setConnected(true);
        setDownReason('');
      },
      onStats: (snap) => {
        setSnapshot(snap);
        setHistory((prev) => {
          const next: Record<string, number[]> = { ...prev };
          for (const metric of METRICS) {
            const list = [...(next[metric.key] ?? []), metric.pick(snap)];
            next[metric.key] = list.length > HISTORY_LIMIT ? list.slice(list.length - HISTORY_LIMIT) : list;
          }
          return next;
        });
        // 任何降级项出现 → 全屏红闪一下（CSS 动画 3 个脉冲，见 styles.css）
        if (snap.degraded.length > 0) {
          setRedFlash(true);
          window.setTimeout(() => setRedFlash(false), 1500);
        }
      },
      onServerError: (message) => {
        setServerError(message);
        setRedFlash(true);
        window.setTimeout(() => setRedFlash(false), 1500);
      },
      onDown: (reason) => {
        setConnected(false);
        setDownReason(reason);
      }
    });
    return () => handle.close();
  }, []);

  const connText = connected ? 'SSE 已连接 · 每 5s 推送' : downReason ? `重连中（${downReason}）` : '连接中…';

  return (
    <div className={`bigscreen ${redFlash ? 'bs-red-flash' : ''}`}>
      <header className="bs-header">
        <div>
          <h1>运营实时大屏</h1>
          <div className="bs-sub">
            数据源 GET /v1/stats/live（SSE 单向推送）· 不轮询 · 服务端每 5s 一条聚合 SQL
          </div>
        </div>
        <div className="bs-conn">
          <span className={`bs-conn-dot ${connected ? 'on' : ''}`} />
          <span className={connected ? '' : 'bs-conn-down'}>{connText}</span>
          {snapshot && <span className="bs-ts">更新于 {new Date(snapshot.ts).toLocaleTimeString('zh-CN')}</span>}
        </div>
      </header>

      {serverError && <div className="bs-error-banner">⚠ {serverError}（流未断，等待下一拍）</div>}
      {!connected && downReason && (
        <div className="bs-down-banner">连接断开：{downReason} · 正在按 retry 节奏自动重连，无需手动刷新</div>
      )}

      <div className="bs-grid">
        {METRICS.map((metric) => {
          const degraded = snapshot ? metric.degradeMarks.some((mark) => snapshot.degraded.includes(mark)) : false;
          return (
            <div key={metric.key} className={`bs-card ${degraded ? 'degraded' : ''}`}>
              <div className="bs-label">{metric.label}</div>
              <div className="bs-value">
                <AnimatedNumber
                  value={snapshot ? metric.pick(snapshot) : 0}
                  decimals={metric.decimals}
                />
                {metric.key === 'online' && snapshot && (
                  <span className="bs-online-conn">（连接 {snapshot.online_conn}）</span>
                )}
              </div>
              <Sparkline points={history[metric.key] ?? []} />
              <div className="bs-foot">
                {metric.sub}
                {degraded && <span className="bs-degraded-tag">降级值 · 红闪</span>}
              </div>
            </div>
          );
        })}
      </div>

      <footer className="bs-footer">
        演示提示：游客端发消息 → 「消息吞吐」下一拍 +1；再开一个客户端 → 「在线人数」下一拍 +1；
        停掉一个客户端 ≤60s 回落（presence TTL）。降级项详见接口文档与《大屏演示SOP.md》。
      </footer>
    </div>
  );
};

export default BigScreen;
