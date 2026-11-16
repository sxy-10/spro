import { useEffect, useState } from 'react';
import { request } from '../api';
import { SeckillButton } from './SeckillButton';

interface BookingScreenProps {
  defaultMobile?: string;
  isLoggedIn?: boolean;
  onOpenLogin?: () => void;
}

export function BookingScreen({ defaultMobile = '', isLoggedIn = true, onOpenLogin }: BookingScreenProps) {
  const [bookingMode, setBookingMode] = useState<'normal' | 'seckill'>('normal');
  const [routes, setRoutes] = useState<any[]>([]);
  const [routeId, setRouteId] = useState('');
  const [date, setDate] = useState('');
  const [people, setPeople] = useState(1);
  const [mobile, setMobile] = useState(defaultMobile);
  const [stock, setStock] = useState<{ total_seats: number; available_seats: number; is_sellable: boolean } | null>(null);
  const [stockLoading, setStockLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    request('/routes')
      .then((data) => {
        if (active) setRoutes(data.list || []);
      })
      .catch((e) => {
        if (active) setMessage({ type: 'error', text: e.message });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setStock(null);
    setMessage(null);
    if (routeId && date) {
      setStockLoading(true);
      request(`/routes/${routeId}/stock?travel_date=${encodeURIComponent(date)}`)
        .then((data) => {
          if (active) setStock(data);
        })
        .catch((e) => {
          if (active) setMessage({ type: 'error', text: e.message });
        })
        .finally(() => {
          if (active) setStockLoading(false);
        });
    }
    return () => {
      active = false;
    };
  }, [routeId, date]);

  const selectedRoute = routes.find((r) => String(r.route_id || r.id) === String(routeId));
  const totalEstimatedPrice = selectedRoute?.base_price_rmb
    ? (Number(selectedRoute.base_price_rmb) * people).toFixed(2)
    : null;

  // 计算秒杀折扣价（3折）
  const seckillUnitPrice = selectedRoute?.base_price_rmb
    ? Math.max(99, Math.round(Number(selectedRoute.base_price_rmb) * 0.3))
    : 199;
  const totalSeckillPrice = (seckillUnitPrice * people).toFixed(2);

  const minDate = new Date().toISOString().split('T')[0];

  const book = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const latest = await request(`/routes/${routeId}/stock?travel_date=${encodeURIComponent(date)}`);
      setStock(latest);
      if (!latest.is_sellable || latest.available_seats < people) {
        throw new Error('该日期余位不足，请更换出行日期或减少人数');
      }
      const order = await request('/orders', 'POST', {
        route_id: routeId,
        travel_date: date,
        people_count: people,
        contact_mobile: mobile
      });
      setMessage({
        type: 'success',
        text: `🎉 订单 #${order.order_id} 锁定成功！金额 ¥${order.amount}，请在 15 分钟内完成确认。`
      });
      setStock(await request(`/routes/${routeId}/stock?travel_date=${encodeURIComponent(date)}`));
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : '预订失败，请稍后重试' });
    } finally {
      setBusy(false);
    }
  };

  const isSubmittable =
    !busy &&
    Boolean(routeId) &&
    Boolean(date) &&
    /^1[3-9]\d{9}$/.test(mobile) &&
    people >= 1 &&
    Boolean(stock?.is_sellable) &&
    Number(stock?.available_seats ?? 0) >= people;

  return (
    <div className="profile-booking-card">
      <div className="booking-card-header">
        <div className="booking-header-title-box">
          <span className="booking-header-icon" aria-hidden="true">🎫</span>
          <h3 className="booking-card-title">出行线路快速预订</h3>
        </div>
        {stockLoading ? (
          <span className="booking-stock-pill checking">余位查询中…</span>
        ) : stock ? (
          stock.is_sellable && stock.available_seats >= people ? (
            <span className="booking-stock-pill available">剩余 {stock.available_seats} 席</span>
          ) : (
            <span className="booking-stock-pill soldout">
              {stock.available_seats === 0 ? '已售罄' : `余位不足(${stock.available_seats}席)`}
            </span>
          )
        ) : null}
      </div>

      {/* 预订模式切换 Tab：常规预订 vs 限时秒杀 */}
      <div className="booking-mode-toggle-bar">
        <button
          type="button"
          className={`mode-toggle-btn ${bookingMode === 'normal' ? 'active' : ''}`}
          onClick={() => { setBookingMode('normal'); setMessage(null); }}
        >
          <span>🎫 常规预订</span>
        </button>
        <button
          type="button"
          className={`mode-toggle-btn seckill-mode ${bookingMode === 'seckill' ? 'active' : ''}`}
          onClick={() => { setBookingMode('seckill'); setMessage(null); }}
        >
          <span className="flash-flame">⚡</span>
          <span>限时秒杀专区</span>
          <span className="badge-discount-mini">3折起</span>
        </button>
      </div>

      {bookingMode === 'seckill' && (
        <div className="seckill-intro-banner">
          <div className="banner-title-line">
            <span className="badge-pulsing-red">LIVE</span>
            <strong>爆款秒杀 · 削峰通道</strong>
          </div>
          <p className="banner-desc">
            采用 Redis Lua 毫秒级原子预扣 + Stream 队列异步建单，高并发不超卖。
          </p>
        </div>
      )}

      <form className="booking-form" onSubmit={(e) => { e.preventDefault(); void book(); }}>
        <div className="booking-field">
          <label className="booking-label">
            <span>选择旅游路线</span>
            {selectedRoute?.destination && (
              <span className="booking-label-hint">{selectedRoute.destination} · {selectedRoute.default_days}天</span>
            )}
          </label>
          <select
            className="booking-select"
            required
            disabled={busy}
            value={routeId}
            onChange={(e) => setRouteId(e.target.value)}
          >
            <option value="">请选择心仪路线</option>
            {routes.map((r) => (
              <option key={r.route_id} value={r.route_id}>
                {r.title} (¥{r.base_price_rmb}/人)
              </option>
            ))}
          </select>
        </div>

        <div className="booking-row-2col">
          <div className="booking-field">
            <label className="booking-label">出行日期</label>
            <input
              className="booking-input"
              required
              disabled={busy}
              type="date"
              min={minDate}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="booking-field">
            <label className="booking-label">出行人数</label>
            <input
              className="booking-input"
              required
              disabled={busy}
              type="number"
              min={1}
              max={50}
              value={people}
              onChange={(e) => setPeople(Math.max(1, Number(e.target.value)))}
            />
          </div>
        </div>

        <div className="booking-field">
          <label className="booking-label">联系手机号</label>
          <input
            className="booking-input"
            required
            disabled={busy}
            type="tel"
            inputMode="numeric"
            maxLength={11}
            placeholder="接收行程订单短信"
            value={mobile}
            onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 11))}
          />
        </div>

        {totalEstimatedPrice && (
          bookingMode === 'normal' ? (
            <div className="booking-summary-banner">
              <div className="booking-summary-left">
                <span className="booking-summary-label">预计应付总额</span>
                <span className="booking-summary-sub">{people} 位旅客 · 包含交通与门票</span>
              </div>
              <span className="booking-summary-price">¥{totalEstimatedPrice}</span>
            </div>
          ) : (
            <div className="booking-summary-banner seckill-summary">
              <div className="booking-summary-left">
                <div className="seckill-price-row">
                  <span className="booking-summary-label">⚡ 秒杀特惠立减</span>
                  <span className="original-strike-price">原价 ¥{totalEstimatedPrice}</span>
                </div>
                <span className="booking-summary-sub">{people} 位旅客 · 限量 3 折秒杀席位</span>
              </div>
              <div className="seckill-final-price-box">
                <span className="price-currency">¥</span>
                <span className="seckill-big-price">{totalSeckillPrice}</span>
              </div>
            </div>
          )
        )}

        {message && (
          <div className={`booking-alert-box ${message.type}`} role="status">
            {message.text}
          </div>
        )}

        {bookingMode === 'normal' ? (
          <button className="booking-submit-button" disabled={!isSubmittable} type="submit">
            {busy ? '正在锁定名额…' : '立即提交预订'}
          </button>
        ) : (
          <SeckillButton
            routeId={routeId}
            travelDate={date}
            peopleCount={people}
            isLoggedIn={isLoggedIn}
            onOpenLogin={onOpenLogin}
            disabled={!routeId || !date || people < 1}
            priceText={`¥${seckillUnitPrice}`}
            onSuccess={(orderId) => {
              setMessage({
                type: 'success',
                text: `🎉 秒杀成功！订单 #${orderId} 已由 Redis 削峰队列落库生成，请尽快完成支付！`
              });
            }}
            onError={(err) => {
              setMessage({ type: 'error', text: err });
            }}
            onSoldOut={() => {
              setMessage({ type: 'error', text: '⚡ 该路线在所选日期的秒杀名额已售罄 (Sold Out)！' });
            }}
          />
        )}
      </form>
    </div>
  );
}
