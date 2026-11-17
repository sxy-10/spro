import React, { useCallback, useEffect, useState } from 'react';
import { request } from '../../api';
import { usePermission } from '../../hooks/useAuth';
import { buildEditableTree, type PermissionTreeNode, type RawMenuNode } from '../../lib/permissionTree';
import { RoleManage, type RoleItem } from './RoleManage';

/**
 * 组员2（阶段5接线）：把组员5的角色管理骨架接到后端 9 个 RBAC 管理接口上。
 *
 * 接口契约（与 backend/src/api/rbacRouter.ts 一一对应）：
 *   GET  /v1/roles                    → data.list（分页，含 user_count / permission_count）
 *   GET  /v1/permissions              → data.list=菜单树（仅 MENU）+ data.buttons=按钮平铺（按 parent_id 归位）
 *   GET  /v1/roles/:id/permissions    → data.permission_ids（含祖先菜单，与 PUT 口径一致）
 *   PUT  /v1/roles/:id/permissions    → 全量覆盖（后端会再补一次祖先，双保险）
 *   POST /v1/roles                    → 新建角色（code 唯一，冲突 409/20015）
 *
 * 权限约束：整块由 system:role:query 控制可见；保存按钮由 RoleManage 内部的
 * system:role:update / system:permission:update 控制；SUPER_ADMIN 为内置全量权限，
 * 后端 403 拒改，前端直接置灰保存并给出提示。
 */

interface RoleRow {
  role_id: string;
  code: string;
  name: string;
  description: string | null;
  status: string;
  user_count: number;
  permission_count: number;
}

interface ButtonRow {
  permission_id: string;
  parent_id: string | null;
  name: string;
  code: string;
}

const SUPER_ADMIN_CODE = 'SUPER_ADMIN';

export const RoleAdminSection: React.FC = () => {
  const canQuery = usePermission('system:role:query');
  const canUpdateRole = usePermission('system:role:update');

  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [roleMeta, setRoleMeta] = useState<Map<string, RoleRow>>(new Map());
  const [tree, setTree] = useState<PermissionTreeNode[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 新建角色表单
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);

  const loadRoles = useCallback(async (): Promise<RoleRow[]> => {
    const data = await request<{ list: RoleRow[] }>('/roles');
    setRoles(data.list.map((row) => ({
      role_id: row.role_id,
      name: row.name,
      code: row.code,
      description: row.description,
      status: row.status
    })));
    setRoleMeta(new Map(data.list.map((row) => [row.role_id, row])));
    return data.list;
  }, []);

  const loadTree = useCallback(async () => {
    const data = await request<{ list: unknown[]; buttons: ButtonRow[] }>('/permissions');
    setTree(buildEditableTree(data.list as RawMenuNode[], data.buttons));  }, []);

  useEffect(() => {
    if (!canQuery) return;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [rows] = await Promise.all([loadRoles(), loadTree()]);
        // 默认选中第一个非内置角色，避免一进来就停在不允许修改的 SUPER_ADMIN 上
        const first = rows.find((row) => row.code !== SUPER_ADMIN_CODE) ?? rows[0];
        if (first) setSelectedRoleId(first.role_id);
      } catch (e) {
        setError(e instanceof Error ? e.message : '角色数据加载失败');
      } finally {
        setLoading(false);
      }
    })();
  }, [canQuery, loadRoles, loadTree]);

  // 选中角色后拉取已分配权限（GET 的口径已含祖先菜单，树上半选状态能正确还原）
  useEffect(() => {
    if (!canQuery || !selectedRoleId) return;
    setError(null);
    (async () => {
      try {
        const data = await request<{ permission_ids: string[] }>(`/roles/${selectedRoleId}/permissions`);
        setAssignedIds(data.permission_ids);
      } catch (e) {
        setError(e instanceof Error ? e.message : '已分配权限加载失败');
      }
    })();
  }, [canQuery, selectedRoleId]);

  const handleSave = useCallback(async (draft: { roleId: string; permissionIds: string[] }) => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await request(`/roles/${draft.roleId}/permissions`, 'PUT', { permission_ids: draft.permissionIds });
      setAssignedIds([...draft.permissionIds].sort());
      // permission_count 变了，刷新角色列表口径
      await loadRoles();
      const name = roleMeta.get(draft.roleId)?.name ?? draft.roleId;
      setNotice(`已保存：${name} 现有 ${draft.permissionIds.length} 项权限，下一个请求即刻生效（无需重新登录）`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [loadRoles, roleMeta]);

  const handleCreate = useCallback(async () => {
    if (!newName.trim() || !newCode.trim()) return;
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const data = await request<{ role_id: string }>('/roles', 'POST', {
        name: newName.trim(),
        code: newCode.trim(),
        description: newDesc.trim() || undefined
      });
      setNotice(`角色「${newName.trim()}」创建成功，已自动选中，现在可以勾选权限并保存`);
      setNewName(''); setNewCode(''); setNewDesc(''); setShowCreate(false);
      await loadRoles();
      setSelectedRoleId(data.role_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
    } finally {
      setCreating(false);
    }
  }, [newName, newCode, newDesc, loadRoles]);

  if (!canQuery) return null;

  const selectedRole = selectedRoleId ? roleMeta.get(selectedRoleId) : undefined;
  const isSuperAdmin = selectedRole?.code === SUPER_ADMIN_CODE;
  const saveBlockedBySuperAdmin = isSuperAdmin; // 后端 403：内置全量权限不允许修改

  return (
    <div className="admin-section-block">
      <div className="section-title-row">
        <h3 className="section-title">角色与权限配置</h3>
        {canUpdateRole && (
          <button type="button" className="btn-section-action" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? '收起' : '+ 新建角色'}
          </button>
        )}
      </div>

      {showCreate && (
        <div className="role-create-form">
          <input
            className="role-create-input"
            placeholder="角色名称，如：审计员"
            value={newName}
            maxLength={50}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            className="role-create-input"
            placeholder="角色编码，如：AUDITOR（唯一）"
            value={newCode}
            maxLength={50}
            onChange={(e) => setNewCode(e.target.value)}
          />
          <input
            className="role-create-input role-create-input-wide"
            placeholder="描述（可选）"
            value={newDesc}
            maxLength={200}
            onChange={(e) => setNewDesc(e.target.value)}
          />
          <button type="button" className="btn-section-action" disabled={creating || !newName.trim() || !newCode.trim()} onClick={handleCreate}>
            {creating ? '创建中…' : '确认创建'}
          </button>
        </div>
      )}

      {loading && <div className="rolemanage-empty">加载角色与权限树中…</div>}
      {error && <div className="role-manage-error">{error}</div>}
      {notice && <div className="role-manage-notice">{notice}</div>}
      {isSuperAdmin && (
        <div className="role-manage-notice">
          超级管理员为内置全量权限，不允许修改（后端强制拒绝），请选择其他角色进行配置。
        </div>
      )}
      {selectedRole && (
        <div className="role-meta-line">
          {selectedRole.name} · 用户 {selectedRole.user_count} 人 · 已配权限 {selectedRole.permission_count} 项
          {selectedRole.status === 'DISABLED' && '（已停用）'}
        </div>
      )}

      {!loading && (
        <RoleManage
          roles={roles}
          permissionTree={tree}
          selectedRoleId={selectedRoleId}
          assignedIds={assignedIds}
          onSelectRole={setSelectedRoleId}
          onSave={saveBlockedBySuperAdmin || saving ? undefined : handleSave}
        />
      )}
    </div>
  );
};
