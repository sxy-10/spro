import type { RowDataPacket } from 'mysql2/promise';
import { pool } from './connection.js';
import { cacheGetJson, cacheSetJson, getRedis, isRedisReady } from './redis.js';

interface HotList {
  list: RowDataPacket[];
  total: number;
  has_more: boolean;
}

const HOT_LIST_SIZE = 20;
const HOT_CACHE_TTL_SECONDS = 120;
const defaultPage = { page: 1, size: HOT_LIST_SIZE, sort: '-created_at' };
const cacheStats: Record<'routes:hot' | 'spots:hot', { hits: number; misses: number }> = {
  'routes:hot': { hits: 0, misses: 0 },
  'spots:hot': { hits: 0, misses: 0 }
};

const log = (event: string, extra: Record<string, unknown> = {}) => {
  console.log(JSON.stringify({ event, ...extra }));
};

function recordCacheResult(key: 'routes:hot' | 'spots:hot', hit: boolean): void {
  const stats = cacheStats[key];
  if (hit) stats.hits += 1;
  else stats.misses += 1;
  log(`catalog.cache.${hit ? 'hit' : 'miss'}`, { key });
  log('catalog.cache.rate', {
    key,
    hits: stats.hits,
    misses: stats.misses,
    hitRate: Number((stats.hits / (stats.hits + stats.misses)).toFixed(4))
  });
}

async function fetchHotRoutes(): Promise<HotList> {
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT id,id AS route_id,product_no,title,destination,default_days,style_tag,
           base_price_rmb,cover_image_url,status,is_active,created_at
      FROM travel_product
     WHERE status='ON_SALE'
     ORDER BY created_at DESC,id DESC
     LIMIT ?
  `, [HOT_LIST_SIZE]);
  const [counts] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM travel_product WHERE status='ON_SALE'"
  );
  const total = Number(counts[0]?.total ?? 0);
  return { list: rows, total, has_more: defaultPage.page * defaultPage.size < total };
}

async function fetchHotSpots(): Promise<HotList> {
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT id,id AS spot_id,name,city_name,address,rating,opening_hours,cover_image_url,created_at
      FROM poi
     WHERE poi_type='ATTRACTION' AND status='ACTIVE'
     ORDER BY created_at DESC,id DESC
     LIMIT ?
  `, [HOT_LIST_SIZE]);
  const [counts] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM poi WHERE poi_type='ATTRACTION' AND status='ACTIVE'"
  );
  const total = Number(counts[0]?.total ?? 0);
  return { list: rows, total, has_more: defaultPage.page * defaultPage.size < total };
}

async function getOrLoadHotList(key: 'routes:hot' | 'spots:hot', load: () => Promise<HotList>): Promise<HotList> {
  const cached = await cacheGetJson<HotList>(key);
  if (cached) {
    recordCacheResult(key, true);
    return cached;
  }

  recordCacheResult(key, false);
  const value = await load();
  const stored = await cacheSetJson(key, value, HOT_CACHE_TTL_SECONDS);
  log('catalog.cache.fill', { key, stored });
  return value;
}

export const getHotRoutes = (): Promise<HotList> =>
  getOrLoadHotList('routes:hot', fetchHotRoutes);

export const getHotSpots = (): Promise<HotList> =>
  getOrLoadHotList('spots:hot', fetchHotSpots);

export async function warmCache(): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    log('catalog.cache.warmup_skipped', { reason: 'redis_disabled' });
    return;
  }

  const deadline = Date.now() + 3000;
  while (!isRedisReady() && Date.now() < deadline) {
    await new Promise(resolveDelay => setTimeout(resolveDelay, 50));
  }
  if (!isRedisReady()) {
    log('catalog.cache.warmup_skipped', { reason: 'redis_unavailable' });
    return;
  }

  await Promise.all([getHotRoutes(), getHotSpots()]);
  log('catalog.cache.warmup_complete');
}
