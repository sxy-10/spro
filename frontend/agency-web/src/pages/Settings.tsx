/**
 * 页面八：旅行社设置。
 * 真实接口：GET /users/me + PUT /users/{id}（机构资料）；GET/POST/PUT/DELETE /admin/users（子账号，需 system:user:* 权限）。
 * 权限不足时降级为提示，不伪造数据。
 */
import { useState } from 'react';
import { createAdminUser, disableAdminUser, fetchAdminUsers, fetchMe, fetchRoles, updateMe } from '../api/admin';
import { ApiError } from '../api/client';
import { Card, EmptyRow, EmptyState, Modal, Skeleton, StatusTag, toast, useAsync } from '../components/ui';
import type { AdminUserRow, RoleBrief } from '../types';

const maskMobile = (phone: string) => (phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : phone);

export function SettingsScreen() {
  const me = useAsync(() => fetchMe(), []);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>旅行社设置</h1>
          <p>维护机构资料、当前账号信息与子账号</p>
        </div>
      </div>
      {me.loading ? (
        <Card><Skeleton h={140} /></Card>
      ) : me.error ? (
        <Card><EmptyState icon="⚠️" title="资料加载失败" description={me.error.message} /></Card>
      ) : (
        me.data && (
          <>
            <ProfileCard
              userId={me.data.user_id}
              nickname={me.data.nickname ?? ''}
              phone={maskMobile(me.data.phone)}
              role={me.data.roles?.[0]?.name ?? me.data.role}
              agencyId={me.data.agency_id ?? '—'}
              createTime={me.data.create_time}
              onSaved={() => me.reload()}
            />
            <SubAccountCard currentUserId={me.data.user_id} />
          </>
        )
      )}
    </>
  );
}

function ProfileCard(props: {
  userId: string; nickname: string; phone: string; role: string; agencyId: string; createTime: string; onSaved: () => void;
}) {
  const [nickname, setNickname] = useState(props.nickname);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await updateMe(props.userId, { nickname: nickname.trim() });
      toast.success('资料已保存');
      props.onSaved();
    } catch (error) {
      if (error instanceof ApiError) toast.error(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="机构与账号资料">
      <div className="setting-row"><span className="lbl">手机号</span><span>{props.phone}（平台脱敏展示）</span></div>
      <div className="setting-row"><span className="lbl">角色</span><span><span className="tag on-sale">{props.role}</span></span></div>
      <div className="setting-row"><span className="lbl">所属机构 ID</span><span>{props.agencyId}</span></div>
      <div className="setting-row"><span className="lbl">账号创建时间</span><span>{props.createTime?.replace('T', ' ').slice(0, 16)} UTC</span></div>
      <div className="setting-row">
        <span className="lbl">昵称</span>
        <input className="input" style={{ width: 260 }} value={nickname} maxLength={50} onChange={(event) => setNickname(event.target.value)} />
        <button className="btn sm" onClick={save} disabled={saving || !nickname.trim()}>{saving ? '保存中…' : '保存'}</button>
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--ink-400)' }}>
        资料修改走 PUT /v1/users/:id（仅限本人）；机构名称等企业字段由平台方维护。
      </p>
    </Card>
  );
}

function SubAccountCard(props: { currentUserId: string }) {
  const state = useAsync(() => fetchAdminUsers({ size: 100 }), []);
  const roles = useAsync(() => fetchRoles(), []);
  const [creating, setCreating] = useState(false);

  if (state.error?.isForbidden) {
    return (
      <Card title="子账号管理">
        <EmptyState
          icon="🔒"
          title="无子账号管理权限"
          description="子账号管理需要「用户管理」权限（system:user:query 等）。旅行社管理员默认未授予 system 子树，该能力由平台方在「系统管理」中操作。"
        />
      </Card>
    );
  }

  const disable = async (row: AdminUserRow) => {
    try {
      await disableAdminUser(row.user_id);
      toast.success('已停用（登录态已撤销）');
      state.reload();
    } catch (error) {
      if (error instanceof ApiError) toast.error(error);
    }
  };

  const roleOptions: RoleBrief[] = Array.isArray(roles.data) ? roles.data : roles.data?.list ?? [];

  return (
    <Card
      title="子账号管理"
      side={state.data ? <button className="btn sm" onClick={() => setCreating(true)} disabled={roleOptions.length === 0}>＋ 新建子账号</button> : undefined}
    >
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>账号</th><th>手机号</th><th>角色</th><th>状态</th><th>创建时间(UTC)</th><th>操作</th></tr>
          </thead>
          <tbody>
            {state.loading ? (
              <tr><td colSpan={6} className="table-empty"><Skeleton h={60} /></td></tr>
            ) : (state.data?.list ?? []).length === 0 ? (
              <EmptyRow colSpan={6} text="暂无子账号" />
            ) : (
              (state.data?.list ?? []).map((row) => (
                <tr key={row.user_id}>
                  <td className="primary-cell"><b>{row.nickname ?? row.username ?? '—'}</b><span>ID {row.user_id}</span></td>
                  <td>{maskMobile(row.phone)}</td>
                  <td>{row.roles.map((role) => <span key={role.role_id} className="tag info" style={{ marginRight: 4 }}>{role.name}</span>)}</td>
                  <td><StatusTag value={row.status} /></td>
                  <td style={{ color: 'var(--ink-400)', fontSize: 12 }}>{row.created_at.replace('T', ' ').slice(0, 16)}</td>
                  <td>
                    {row.user_id !== props.currentUserId && row.status === 'ACTIVE' && (
                      <button className="link-btn danger" onClick={() => void disable(row)}>停用</button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {creating && (
        <CreateSubAccountModal
          roleOptions={roleOptions}
          onClose={() => setCreating(false)}
          onDone={() => { setCreating(false); state.reload(); }}
        />
      )}
    </Card>
  );
}

function CreateSubAccountModal(props: { roleOptions: RoleBrief[]; onClose: () => void; onDone: () => void }) {
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [roleId, setRoleId] = useState(props.roleOptions[0]?.role_id ?? '');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      await createAdminUser({ mobile: mobile.trim(), password, nickname: nickname.trim() || undefined, role_ids: [roleId] });
      toast.success('子账号已创建');
      props.onDone();
    } catch (error) {
      if (error instanceof ApiError) toast.error(error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="新建子账号"
      onClose={props.onClose}
      footer={
        <>
          <button className="btn ghost" onClick={props.onClose}>取消</button>
          <button className="btn" onClick={submit} disabled={submitting || !mobile.trim() || password.length < 8 || !roleId}>
            {submitting ? '创建中…' : '创建'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field">
          <label className="req">手机号</label>
          <input className="input" value={mobile} onChange={(event) => setMobile(event.target.value)} placeholder="11 位手机号" />
        </div>
        <div className="field">
          <label className="req">初始密码（8-72 位）</label>
          <input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </div>
        <div className="field">
          <label>昵称</label>
          <input className="input" value={nickname} maxLength={50} onChange={(event) => setNickname(event.target.value)} />
        </div>
        <div className="field">
          <label className="req">分配角色</label>
          <select className="select" value={roleId} onChange={(event) => setRoleId(event.target.value)}>
            {props.roleOptions.map((role) => (
              <option key={role.role_id} value={role.role_id}>{role.name}（{role.code}）</option>
            ))}
          </select>
        </div>
      </div>
    </Modal>
  );
}
