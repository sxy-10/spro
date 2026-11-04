import { Adapter, Enforcer, Helper, Model, newEnforcer, newModelFromString } from 'casbin';
import { RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/connection.js';
import {
  PolicyRequest,
  describeRequest,
  matchPolicyRequest,
  toPolicyRules
} from './permissionCode.js';

/**
 * Casbin 授权引擎（组员2 · 阶段二「授权介入」）
 *
 * ── 职责边界 ───────────────────────────────────────────────────────────────
 *   组员1 的 authenticateJwt：认证（Authentication）——「你是谁」，验签 + 校验 api_session。
 *   本模块：授权（Authorization）——「你能做什么」，只认策略，不碰密码与 Token。
 *   组员3 的业务接口：在路由上挂 requireAction(module, action) 即可，无需关心策略怎么来。
 *
 * ── 为什么用 Casbin 而不是继续写 if (role === 'ADMIN') ─────────────────────
 *   1. 权限规则从代码里搬到数据库（sys_role_permission），运营改权限不用改代码、不用重新发版；
 *   2. 策略模型（model）与策略数据（policy）分离，以后要加「数据级权限」「角色继承」只改模型；
 *   3. 判定入口唯一（enforce），不会出现这个接口查了表、那个接口忘了查的漏口。
 *
 * ── 本实现的模型（RBAC + 资源前缀通配）────────────────────────────────────
 *   [request_definition]  r = sub, obj, act        ← 谁 对 哪个资源 做 什么操作
 *   [policy_definition]   p = sub, obj, act        ← 角色 拥有 哪个资源 的 什么操作
 *   [role_definition]     g = _, _                 ← 用户 → 角色（sys_user_role）
 *   [matchers]            g(r.sub, p.sub) && keyMatch(r.obj, p.obj) && (r.act == p.act || p.act == "*")
 *
 *   obj / act 的取值口径由 permissionCode.ts 统一折算，例如：
 *     数据库权限码 system:role:add  →  p, <角色>, system:role, add
 *     数据库权限码 system:role      →  p, <角色>, system:role, view   （菜单只放行 view）
 *
 * ── 策略从哪来 ─────────────────────────────────────────────────────────────
 *   MySqlRbacAdapter 直连 MySQL 两张表（不引入额外 ORM）：
 *     g 规则 ← sys_user_role  JOIN sys_role           （用户ID → 角色码）
 *     p 规则 ← sys_role_permission JOIN sys_permission（角色码 → 权限码）
 *   策略缓存默认 30s；角色/权限发生写操作时由调用方 invalidatePolicyCache() 立即失效，
 *   所以「改完权限马上生效」和「不改权限时不打库」两个目标都成立。
 *
 * ── 判定失败怎么处理（可用性与安全性的取舍）──────────────────────────────
 *   策略库不可用（数据库抖动 / 05_rbac_schema.sql 未执行）时，退回 req.user 上的权限快照
 *   —— 那份快照本来就是认证阶段从同样两张表查出来的，口径一致；
 *   两者都拿不到 → 拒绝（fail-closed），绝不会因为引擎出错就放行。
 */

// ---------------------------------------------------------------------------
// 模型
// ---------------------------------------------------------------------------

/** Casbin 模型（对应 Casbin 官方的 model.conf，这里内联成常量，避免 tsc 构建时漏拷 .conf 文件） */
export const RBAC_MODEL_TEXT = `
[request_definition]
r = sub, obj, act

[policy_definition]
p = sub, obj, act

[role_definition]
g = _, _

[policy_effect]
e = some(where (p.eft == allow))

[matchers]
m = g(r.sub, p.sub) && keyMatch(r.obj, p.obj) && (r.act == p.act || p.act == "*")
`.trim();

// ---------------------------------------------------------------------------
// 适配器：把 MySQL 里的 RBAC 表读成 Casbin 策略
// ---------------------------------------------------------------------------

/**
 * 只读 Adapter：Casbin 的策略改动一律走 api/rbacRouter.ts 的业务事务（带幂等、带校验），
 * 引擎层不提供 savePolicy，避免出现两条写策略的路径。
 */
export class MySqlRbacAdapter implements Adapter {
  /** 用户 → 角色 的 g 规则 */
  private async loadGroupingPolicies(model: Model): Promise<number> {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT CAST(ur.user_id AS CHAR) AS user_id, r.code AS role_code
         FROM sys_user_role ur
         JOIN sys_role r ON r.id = ur.role_id
        WHERE r.status = 'ENABLED'`
    );
    let loaded = 0;
    for (const row of rows as RowDataPacket[]) {
      const userId = String(row.user_id ?? '').trim();
      const roleCode = String(row.role_code ?? '').trim();
      if (!userId || !roleCode) continue;
      Helper.loadPolicyLine(`g, ${userId}, ${roleCode}`, model);
      loaded += 1;
    }
    return loaded;
  }

  /** 角色 → 权限 的 p 规则 */
  private async loadPolicyRules(model: Model): Promise<number> {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT r.code AS role_code, p.code AS permission_code
         FROM sys_role_permission rp
         JOIN sys_role r       ON r.id = rp.role_id
         JOIN sys_permission p ON p.id = rp.permission_id
        WHERE r.status = 'ENABLED' AND p.status = 'ENABLED'`
    );
    const emitted = new Set<string>();
    let loaded = 0;
    for (const row of rows as RowDataPacket[]) {
      const roleCode = String(row.role_code ?? '').trim();
      const permissionCode = String(row.permission_code ?? '').trim();
      if (!roleCode || !permissionCode) continue;
      for (const rule of toPolicyRules(permissionCode)) {
        const line = `p, ${roleCode}, ${rule.obj}, ${rule.act}`;
        if (emitted.has(line)) continue; // 同角色多渠道授予同一权限时去重，策略表不膨胀
        emitted.add(line);
        Helper.loadPolicyLine(line, model);
        loaded += 1;
      }
    }
    return loaded;
  }

  async loadPolicy(model: Model): Promise<void> {
    const groups = await this.loadGroupingPolicies(model);
    const rules = await this.loadPolicyRules(model);
    console.log(JSON.stringify({
      level: 'info', event: 'rbac.policy.loaded', grouping_rules: groups, policy_rules: rules
    }));
  }

  async savePolicy(): Promise<boolean> {
    throw new Error('MySqlRbacAdapter 为只读适配器：请通过 /v1/roles/:id/permissions 接口调整授权');
  }

  async addPolicy(): Promise<void> {
    throw new Error('MySqlRbacAdapter 为只读适配器');
  }

  async removePolicy(): Promise<void> {
    throw new Error('MySqlRbacAdapter 为只读适配器');
  }

  async removeFilteredPolicy(): Promise<void> {
    throw new Error('MySqlRbacAdapter 为只读适配器');
  }
}

/**
 * 静态策略适配器：把策略写成 Casbin 的行格式（`p, 角色, obj, act` / `g, 用户ID, 角色`）。
 * 用途：单元测试、离线演示、排障时对比「数据库里的策略」与「期望的策略」。
 */
export class StaticPolicyAdapter implements Adapter {
  constructor(private readonly lines: string[]) {}

  async loadPolicy(model: Model): Promise<void> {
    for (const line of this.lines) Helper.loadPolicyLine(line, model);
  }

  async savePolicy(): Promise<boolean> { return false; }
  async addPolicy(): Promise<void> { /* 静态策略不落库 */ }
  async removePolicy(): Promise<void> { /* 静态策略不落库 */ }
  async removeFilteredPolicy(): Promise<void> { /* 静态策略不落库 */ }
}

// ---------------------------------------------------------------------------
// 引擎实例与缓存
// ---------------------------------------------------------------------------

/** 策略缓存时长（毫秒）：默认 30s，可用 RBAC_POLICY_TTL_MS 调整；0 表示每次请求都重载 */
export const POLICY_CACHE_TTL_MS = (() => {
  const raw = Number(process.env.RBAC_POLICY_TTL_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 30_000;
})();

let adapterOverride: Adapter | null = null;
let cachedEnforcer: Enforcer | null = null;
let cacheExpiresAt = 0;
let inflight: Promise<Enforcer> | null = null;
let loadFailureLogged = false;

async function buildEnforcer(adapter: Adapter): Promise<Enforcer> {
  const model = newModelFromString(RBAC_MODEL_TEXT);
  const enforcer = await newEnforcer(model, adapter);
  enforcer.enableAutoSave(false);
  return enforcer;
}

function activeAdapter(): Adapter {
  return adapterOverride ?? new MySqlRbacAdapter();
}

/**
 * 取当前引擎实例（带 TTL 缓存）。
 * @param forceReload true 时跳缓存重新读库（授权写操作后由 invalidatePolicyCache 触发）
 */
export async function getEnforcer(forceReload = false): Promise<Enforcer> {
  if (!forceReload && cachedEnforcer && Date.now() < cacheExpiresAt) return cachedEnforcer;
  if (!inflight) {
    inflight = buildEnforcer(activeAdapter())
      .then((enforcer) => {
        cachedEnforcer = enforcer;
        cacheExpiresAt = Date.now() + POLICY_CACHE_TTL_MS;
        loadFailureLogged = false;
        return enforcer;
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/**
 * 让策略缓存立即失效。
 * 必须在对 sys_role / sys_permission / sys_role_permission / sys_user_role 的写事务提交后调用，
 * 否则「刚给角色加完权限，用户要等 30s 才能用」。
 */
export function invalidatePolicyCache(reason = 'manual'): void {
  cachedEnforcer = null;
  cacheExpiresAt = 0;
  console.log(JSON.stringify({ level: 'info', event: 'rbac.policy.invalidated', reason }));
}

/** 测试 / 离线演示入口：注入静态策略；传 null 恢复 MySQL 适配器 */
export function setPolicyAdapter(adapter: Adapter | null): void {
  adapterOverride = adapter;
  invalidatePolicyCache(adapter ? 'adapter:static' : 'adapter:mysql');
}

/** 当前引擎加载到的策略快照（排障、答辩演示、验收自查用） */
export async function getPolicySnapshot(): Promise<{ p: string[][]; g: string[][] }> {
  const enforcer = await getEnforcer();
  return { p: await enforcer.getPolicy(), g: await enforcer.getGroupingPolicy() };
}

// ---------------------------------------------------------------------------
// 判定
// ---------------------------------------------------------------------------

/** 授权判定的主体：只依赖认证阶段产出的字段，不重复查库 */
export interface AuthorizationSubject {
  id: string | number;
  roles?: string[];
  permissions?: string[];
}

/** 判定结果：allowed 决定放行，engine 用于日志定位「是策略判的，还是快照兜的」 */
export interface AuthorizationDecision {
  allowed: boolean;
  engine: 'casbin' | 'snapshot';
  missing: string[];
}

export type DecisionMode = 'all' | 'any';

/** 快照兜底：用 req.user.permissions 做与 Casbin 同口径的匹配 */
function snapshotAllows(subject: AuthorizationSubject, request: PolicyRequest): boolean {
  return (subject.permissions ?? []).some((code) => matchPolicyRequest(request.obj, request.act, code));
}

/**
 * 批量判定。
 * @param requests 需要校验的 (obj, act) 集合
 * @param mode     all = 必须全部满足（默认，写接口用）；any = 满足其一即可（编排类接口用）
 */
export async function evaluateRequests(
  subject: AuthorizationSubject,
  requests: PolicyRequest[],
  mode: DecisionMode = 'all'
): Promise<AuthorizationDecision> {
  const labels = requests.map(describeRequest);
  if (requests.length === 0) return { allowed: false, engine: 'casbin', missing: labels };

  // 主体候选：用户ID（走 g 规则）优先，其次认证阶段聚合的角色码（策略缓存 TTL 内角色刚变更时兜住）
  const subjects = [String(subject.id ?? ''), ...(subject.roles ?? [])]
    .map((item) => String(item).trim())
    .filter(Boolean);

  const verdicts: boolean[] = [];
  let engine: 'casbin' | 'snapshot' = 'casbin';

  try {
    const enforcer = await getEnforcer();
    const policyEmpty = (await enforcer.getPolicy()).length === 0;
    for (const request of requests) {
      if (policyEmpty) {
        // 策略表为空：典型场景是 05_rbac_schema.sql 还没执行，退回权限快照，保证不误拒
        engine = 'snapshot';
        verdicts.push(snapshotAllows(subject, request));
        continue;
      }
      let passed = false;
      for (const sub of subjects) {
        // enforce 是唯一判定入口：角色继承、通配、act 全等都在模型里完成
        if (await enforcer.enforce(sub, request.obj, request.act)) { passed = true; break; }
      }
      verdicts.push(passed);
    }
  } catch (error: any) {
    // 策略库不可用：降级到快照判定，并在日志里留痕，便于发现「权限引擎没读到库」这种隐性故障
    if (!loadFailureLogged) {
      loadFailureLogged = true;
      console.warn(JSON.stringify({
        level: 'warn', event: 'rbac.policy.load_failed', message: error?.message ?? String(error)
      }));
    }
    engine = 'snapshot';
    verdicts.length = 0;
    for (const request of requests) verdicts.push(snapshotAllows(subject, request));
  }

  const allowed = mode === 'any' ? verdicts.some(Boolean) : verdicts.every(Boolean);
  const missing = labels.filter((_, index) => !verdicts[index]);
  return { allowed, engine, missing };
}

/** 单个权限码 / (module, action) 判定的简写 */
export async function isAllowed(
  subject: AuthorizationSubject,
  request: PolicyRequest
): Promise<boolean> {
  return (await evaluateRequests(subject, [request], 'all')).allowed;
}
