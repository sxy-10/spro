import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { app } from '../app.js';
import { pool } from '../db/connection.js';
import { hash, serialize } from './core.js';
import { expireUnpaidOrders, settlePaidOrder } from './stock.js';

test('v1 HTTP contract, ownership, signing, idempotency and order state', async () => {
  process.env.JWT_SECRET='test-secret-with-at-least-32-characters';
  const originalQuery=pool.query, originalConnection=pool.getConnection;
  const cache=new Map<string,any>(), nonces=new Set<string>();
  let orders=0, status='PENDING';
  let locked=0,sold=0,total=9,expired=false;
  let failInsert=false;
  const query=async(sql:string,args:any[]=[])=>{
    if(sql.includes('api_rate_limit')) return [sql.startsWith('SELECT')?[{hits:1}]:{}];
    if(sql.includes('JOIN sys_user')) return [[{id:'1',role:'TOURIST',agency_id:null}]];
    if(sql.startsWith('INSERT IGNORE INTO api_idempotency')) { if(!cache.has(args[0])) cache.set(args[0],{request_hash:args[1]}); return [{}]; }
    if(sql.startsWith('SELECT * FROM api_idempotency')) return [[cache.get(args[0])]];
    if(sql.startsWith('UPDATE api_idempotency')) { Object.assign(cache.get(args[2]),{response_status:args[0],response_data:args[1]}); return [{}]; }
    if(sql.startsWith('INSERT INTO api_nonce')) { if(nonces.has(args[0])) throw Object.assign(new Error(),{code:'ER_DUP_ENTRY'}); nonces.add(args[0]);return [{}]; }
    if(sql.includes('SELECT id,base_price_rmb')) return [[{id:'7',base_price_rmb:'19.99'}]];
    if(sql.startsWith('SELECT id FROM travel_product')) return [[{id:'7'}]];
    if(sql.includes('FROM route_stock')) return [args[1]==='2026-12-02'?[]:[{total_seats:total,available_seats:total-locked-sold}]];
    if(sql.startsWith('UPDATE route_stock SET locked_seats=locked_seats+')) {
      if(args[2]==='2026-12-02'||total-locked-sold<args[0]) return [{affectedRows:0}];
      locked+=args[0]; return [{affectedRows:1}];
    }
    if(sql.startsWith('UPDATE route_stock')) {
      if(locked<args[0]) return [{affectedRows:0}];
      locked-=args[0];sold+=args[1];return [{affectedRows:1}];
    }
    if(sql.startsWith('INSERT INTO tour_order')) {if(failInsert) throw new Error('Simulated insert failure');orders++;return [{}];}
    if(sql.includes('WHERE order_no=')) return [[{id:'9007199254740993',order_id:'9007199254740993',amount:'59.97',status:'CREATED'}]];
    if(sql.startsWith('SELECT * FROM tour_order')) return sql.includes('SKIP LOCKED') ? [expired&&status==='PENDING'?[{id:'1',status,product_id:'7',travel_date:'2026-12-01',traveler_count:3,is_stock_locked:1}]:[]]
      : [[{id:'1',status,product_id:'7',travel_date:'2026-12-01',traveler_count:3,is_stock_locked:status==='PENDING'?1:0}]];
    if(sql.startsWith('SELECT *,expires_at')) return [[{id:'1',status,product_id:'7',travel_date:'2026-12-01',traveler_count:3,is_stock_locked:status==='PENDING'?1:0,is_expired:expired}]];
    if(sql.startsWith('UPDATE tour_order')) {status=sql.includes("status='PAID'")?'PAID':'CANCELLED';return [{}];}
    if(sql.startsWith('SELECT * FROM itinerary')) return [[]];
    if(sql.startsWith('UPDATE itinerary SET is_deleted')) return [{}];
    throw new Error(`Unexpected SQL in test: ${sql}`);
  };
  let queue=Promise.resolve();
  (pool as any).query=query;
  (pool as any).getConnection=async()=>{
    const previous=queue; let unlock!:()=>void;
    queue=new Promise<void>(resolve=>{unlock=resolve;}); await previous;
    const saved={locked,sold,orders,status,cache:structuredClone(cache),nonces:new Set(nonces)};
    return {query,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{
      ({locked,sold,orders,status}=saved);cache.clear();saved.cache.forEach((v,k)=>cache.set(k,v));nonces.clear();saved.nonces.forEach(v=>nonces.add(v));
    },release:()=>unlock()};
  };
  const server=app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address() as {port:number};
  const token=jwt.sign({},process.env.JWT_SECRET,{subject:'1',jwtid:'test-session',issuer:'travel-agent',audience:'travel-client',expiresIn:'10m'});
  const call=async(path:string,method='GET',body?:any,options:{key?:string;nonce?:string;auth?:boolean;signature?:string}={})=>{
    const headers:Record<string,string>={'Content-Type':'application/json'};
    if(options.auth!==false) headers.Authorization=`Bearer ${token}`;
    if(body!==undefined) {
      headers['Idempotency-Key']=options.key??randomUUID();
      headers['X-Timestamp']=new Date().toISOString(); headers['X-Nonce']=options.nonce??randomUUID();
      headers['X-Signature']=options.signature??createHmac('sha256',token).update(`${method}\n/v1${path}\n${headers['X-Timestamp']}\n${headers['X-Nonce']}\n${hash(JSON.stringify(body))}`).digest('hex');
    }
    const response=await fetch(`http://127.0.0.1:${address.port}/v1${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,body:response.status===204?null:await response.json() as any,headers:response.headers};
  };
  try {
    assert.equal((await call('/plans','GET',undefined,{auth:false})).status,401);
    assert.equal((await call('/users/2')).status,403);
    assert.equal((await call('/admin/routes')).status,403);
    assert.equal((await call('/plans/00000000000000000000000000')).status,404);
    assert.equal((await call('/routes?sort=title%3BDROP%20TABLE')).status,400);
    assert.equal((await call('/routes?size=101')).status,400);
    const stock=await call('/routes/7/stock?travel_date=2026-12-01','GET',undefined,{auth:false});
    assert.equal(stock.status,200);assert.deepEqual(stock.body.data,{total_seats:9,available_seats:9,is_sellable:true});
    assert.equal(stock.headers.get('cache-control'),'no-store');
    assert.equal((await call('/routes/7/stock?travel_date=2026-02-30')).status,400);
    assert.equal((await call('/routes/7/stock')).status,400);
    assert.deepEqual((await call('/routes/7/stock?travel_date=2026-12-02')).body.data,{total_seats:0,available_seats:0,is_sellable:false});
    const body={route_id:'7',travel_date:'2026-12-01',people_count:3,contact_mobile:'13800001234'};
    assert.equal((await call('/orders','POST',{...body,people_count:'3'})).status,400);
    assert.equal((await call('/orders','POST',body,{signature:'0'.repeat(64)})).status,403);
    failInsert=true;
    assert.equal((await call('/orders','POST',body)).status,500);assert.equal(locked,0);assert.equal(orders,0);
    failInsert=false;
    const key=randomUUID();
    const [first,repeated]=await Promise.all([call('/orders','POST',body,{key}),call('/orders','POST',body,{key})]);
    assert.equal(first.status,201); assert.equal(repeated.status,201); assert.equal(orders,1);
    assert.equal(locked,3);
    assert.deepEqual(first.body.data,repeated.body.data);
    assert.deepEqual(Object.keys(first.body).sort(),['code','data','message','trace_id']);
    assert.equal(first.body.data.amount,'59.97'); assert.equal(first.body.data.order_id,'9007199254740993');
    assert.equal((await call('/orders','POST',{...body,people_count:2},{key})).status,409);
    const nonce=randomUUID();
    await call('/orders','POST',body,{nonce});
    assert.equal((await call('/orders','POST',body,{nonce})).status,409);
    assert.equal(locked,6);
    const unavailable=await call('/orders','POST',{...body,travel_date:'2026-12-02'});
    assert.equal(unavailable.status,409);assert.equal(unavailable.body.code,20010);assert.equal(unavailable.body.message,'该日期余位不足');
    const results=await Promise.all([call('/orders','POST',body),call('/orders','POST',body)]);
    assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);assert.equal(locked,9);assert.equal(orders,3);
    assert.equal((await call('/orders/1/cancel','POST',{})).status,200);
    assert.equal(locked,6);
    assert.equal((await call('/orders/1/cancel','POST',{})).status,409);
    assert.equal(locked,6);
    status='PENDING'; expired=true;
    await assert.rejects(settlePaidOrder('1'),/订单当前状态不允许支付/);assert.equal(locked,6);
    await expireUnpaidOrders(); assert.equal(locked,3);assert.equal(status,'CANCELLED');
    await expireUnpaidOrders(); assert.equal(locked,3);
    status='PENDING'; expired=false;
    await settlePaidOrder('1');assert.equal(locked,0);assert.equal(sold,3);assert.equal(status,'PAID');
    await settlePaidOrder('1');assert.equal(sold,3);
    assert.equal((await call('/plans/00000000000000000000000000','DELETE')).status,204);
    assert.equal((await call('/plans/00000000000000000000000000','DELETE')).status,204);
    assert.deepEqual(serialize({createdAt:new Date('2026-10-01T00:00:00Z'),basePriceRmb:19.99,isActive:1}),{created_at:'2026-10-01T00:00:00.000Z',base_price_rmb:'19.99',is_active:true});
    (pool as any).query=async()=>{throw new Error('SECRET SQL /internal/path');};
    const failure=await call('/routes');
    assert.equal(failure.status,500); assert.equal(failure.body.code,50000);
    assert.ok(!JSON.stringify(failure.body).includes('SECRET'));
  } finally {
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    pool.query=originalQuery; pool.getConnection=originalConnection;
    await pool.end();
  }
});
