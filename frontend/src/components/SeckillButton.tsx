import React, { useState, useEffect, useRef } from 'react';
import { sendSeckill, pollSeckillResult } from '../lib/http';
import { Icon } from './Icon';

export type SeckillButtonStatus =
  | 'WAITING'     // 活动未开始，倒计时
  | 'READY'       // 到点可抢
  | 'SUBMITTING'  // 提交中（防连点，置灰 + loading）
  | 'POLLING'     // 轮询排队出票中 (X/10)
  | 'SUCCESS'     // 抢购成功
  | 'SOLD_OUT'    // 已售罄
  | 'FAILED'      // 抢购失败
  | 'TIMEOUT';    // 排队超时

interface SeckillButtonProps {
  routeId: number | string;
  travelDate: string;
  peopleCount: number;
  targetStartTime?: Date | string | null;
  isLoggedIn?: boolean;
  onOpenLogin?: () => void;
  disabled?: boolean;
  priceText?: string;
  onSuccess?: (orderId: number | string) => void;
  onError?: (message: string) => void;
  onSoldOut?: () => void;
  className?: string;
}

export const SeckillButton: React.FC<SeckillButtonProps> = ({
  routeId,
  travelDate,
  peopleCount,
  targetStartTime = null,
  isLoggedIn = true,
  onOpenLogin,
  disabled = false,
  priceText = '¥99',
  onSuccess,
  onError,
  onSoldOut,
  className = ''
}) => {
  const [status, setStatus] = useState<SeckillButtonStatus>('READY');
  const [countdownText, setCountdownText] = useState<string>('');
  const [pollingAttempt, setPollingAttempt] = useState<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // 计算倒计时
  useEffect(() => {
    if (!targetStartTime) {
      setStatus((prev) => (prev === 'WAITING' ? 'READY' : prev));
      return;
    }

    const targetMs = new Date(targetStartTime).getTime();

    const updateCountdown = () => {
      const diff = targetMs - Date.now();
      if (diff <= 0) {
        setStatus('READY');
        setCountdownText('');
        if (timerRef.current) clearInterval(timerRef.current);
      } else {
        setStatus('WAITING');
        const hours = Math.floor(diff / 3600000);
        const minutes = Math.floor((diff % 3600000) / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);
        const pad = (n: number) => String(n).padStart(2, '0');
        setCountdownText(`${pad(hours)}:${pad(minutes)}:${pad(seconds)}`);
      }
    };

    updateCountdown();
    timerRef.current = setInterval(updateCountdown, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [targetStartTime]);

  // 执行秒杀点击
  const handleClickSeckill = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (disabled || status === 'SUBMITTING' || status === 'POLLING' || status === 'SOLD_OUT' || status === 'WAITING') {
      return;
    }

    // 未登录时引导登录
    if (!isLoggedIn) {
      if (onOpenLogin) {
        onOpenLogin();
        return;
      }
      if (onError) onError('请先登录账号后再参与秒杀抢购');
      return;
    }

    // 1. 防连点：立即置灰 + loading
    setStatus('SUBMITTING');

    try {
      // 2. 发起预扣请求 POST /v1/seckill/:routeId
      const submitRes = await sendSeckill(routeId, travelDate, peopleCount);

      // 若售罄
      if (submitRes.status === 'sold_out') {
        setStatus('SOLD_OUT');
        onSoldOut?.();
        return;
      }

      const reqId = submitRes.req_id;
      if (!reqId) {
        throw new Error('未获取到排队凭据号');
      }

      // 3. 进入轮询状态
      setStatus('POLLING');
      setPollingAttempt(1);

      // 4. 轮询 GET /v1/seckill/result/:reqId (1s 一次，最多 10 次)
      const pollRes = await pollSeckillResult(reqId, 10, 1000, (attempt) => {
        setPollingAttempt(attempt);
      });

      if (pollRes.status === 'success') {
        setStatus('SUCCESS');
        onSuccess?.(pollRes.order_id ?? 'SK' + Date.now());
      } else if (pollRes.status === 'failed') {
        setStatus('FAILED');
        onError?.('很遗憾，当前名额已被抢完或订单创建失败');
      } else if (pollRes.status === 'timeout') {
        setStatus('TIMEOUT');
        onError?.('当前秒杀排队人数极多，请稍后前往「我的订单」查看最终出票结果');
      }
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : '秒杀服务暂时繁忙，请稍后重试';
      // 区分售罄与一般错误
      if (errMsg.includes('sold_out') || errMsg.includes('售罄') || errMsg.includes('不足')) {
        setStatus('SOLD_OUT');
        onSoldOut?.();
      } else {
        setStatus('FAILED');
        onError?.(errMsg);
      }
    }
  };

  // 渲染按钮文案与图标
  const renderButtonContent = () => {
    switch (status) {
      case 'WAITING':
        return (
          <span className="seckill-btn-content">
            <span className="seckill-clock-icon">⏰</span>
            <span>距开抢 {countdownText}</span>
          </span>
        );
      case 'SUBMITTING':
        return (
          <span className="seckill-btn-content">
            <span className="seckill-spinner-icon"></span>
            <span>极速抢位中…</span>
          </span>
        );
      case 'POLLING':
        return (
          <span className="seckill-btn-content">
            <span className="seckill-spinner-icon"></span>
            <span>排队出票中 ({pollingAttempt}/10s)…</span>
          </span>
        );
      case 'SUCCESS':
        return (
          <span className="seckill-btn-content">
            <span><Icon name="check-circle" size={16} /> 抢购成功！</span>
          </span>
        );
      case 'SOLD_OUT':
        return (
          <span className="seckill-btn-content">
            <span>已售罄 (名额已抢完)</span>
          </span>
        );
      case 'FAILED':
        return (
          <span className="seckill-btn-content">
            <span>抢购失败 (点击重试)</span>
          </span>
        );
      case 'TIMEOUT':
        return (
          <span className="seckill-btn-content">
            <span>排队超时 (去订单查看)</span>
          </span>
        );
      case 'READY':
      default:
        return (
          <span className="seckill-btn-content">
            <span className="seckill-flash-icon"><Icon name="flame" size={16} /></span>
            <span>立即秒杀抢购 ({priceText}/人)</span>
          </span>
        );
    }
  };

  const isButtonDisabled =
    disabled ||
    status === 'WAITING' ||
    status === 'SUBMITTING' ||
    status === 'POLLING' ||
    status === 'SOLD_OUT';

  return (
    <button
      type="button"
      className={`seckill-action-button status-${status.toLowerCase()} ${className}`}
      disabled={isButtonDisabled}
      onClick={handleClickSeckill}
      aria-label="秒杀抢购按钮"
    >
      {renderButtonContent()}
    </button>
  );
};

export default SeckillButton;
