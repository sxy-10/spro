import { useEffect, useState } from 'react';
import { request } from '../api';

export function BookingScreen() {
  const [routes,setRoutes]=useState<any[]>([]), [routeId,setRouteId]=useState('');
  const [date,setDate]=useState(''), [people,setPeople]=useState(1), [mobile,setMobile]=useState('');
  const [stock,setStock]=useState<{total_seats:number;available_seats:number;is_sellable:boolean}|null>(null);
  const [message,setMessage]=useState(''), [busy,setBusy]=useState(false);
  useEffect(()=>{
    let active=true;
    request('/routes').then(data=>{if(active) setRoutes(data.list);}).catch(e=>{if(active)setMessage(e.message);});
    return ()=>{active=false;};
  },[]);
  useEffect(()=>{
    let active=true; setStock(null); setMessage('');
    if(routeId&&date) request(`/routes/${routeId}/stock?travel_date=${encodeURIComponent(date)}`)
      .then(data=>{if(active)setStock(data);}).catch(e=>{if(active)setMessage(e.message);});
    return ()=>{active=false;};
  },[routeId,date]);
  const book=async()=>{
    setBusy(true);setMessage('');
    try {
      // Check again for display; the server's transactional check remains authoritative.
      const latest=await request(`/routes/${routeId}/stock?travel_date=${encodeURIComponent(date)}`);
      setStock(latest);
      if(!latest.is_sellable||latest.available_seats<people) throw new Error('该日期余位不足');
      const order=await request('/orders','POST',{route_id:routeId,travel_date:date,people_count:people,contact_mobile:mobile});
      setMessage(`订单 ${order.order_id} 已创建，金额 ¥${order.amount}。请在15分钟内完成支付，超时自动取消。`);
      setStock(await request(`/routes/${routeId}/stock?travel_date=${encodeURIComponent(date)}`));
    } catch(e) {setMessage(e instanceof Error?e.message:'预订失败');}
    finally {setBusy(false);}
  };
  return <section>
    <h3>线路预订</h3>
    <form onSubmit={e=>{e.preventDefault();void book();}}>
      <p><label>线路 <select required disabled={busy} value={routeId} onChange={e=>setRouteId(e.target.value)}>
        <option value="">请选择线路</option>{routes.map(r=><option key={r.route_id} value={r.route_id}>{r.title} · ¥{r.base_price_rmb}/人</option>)}
      </select></label></p>
      <p><label>出行日期 <input required disabled={busy} type="date" value={date} onChange={e=>setDate(e.target.value)} /></label></p>
      {stock&&<p aria-live="polite">总名额 {stock.total_seats}，剩余 {stock.available_seats}，{stock.is_sellable?'可预订':'不可预订'}</p>}
      <p><label>人数 <input required disabled={busy} type="number" min={1} max={100} value={people} onChange={e=>setPeople(Number(e.target.value))} /></label></p>
      <p><label>联系手机号 <input required disabled={busy} type="tel" pattern="1[0-9]{10}" value={mobile} onChange={e=>setMobile(e.target.value)} /></label></p>
      <button disabled={busy||!stock?.is_sellable||people<1||people>stock.available_seats} type="submit">{busy?'提交中…':'提交订单'}</button>
      {message&&<p role="status">{message}</p>}
    </form>
  </section>;
}
