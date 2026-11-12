import React, { useEffect, useState } from 'react';
import { usePermission } from '../../hooks/useAuth';
import { newIdempotencyKey } from '../../lib/idempotency';
import { PermissionTree, type PermissionTreeNode } from './PermissionTree';

/**
 * 组员5（阶段4）：角色管理页骨架
 *
 * 本轮范围说明（团队调整）：只做 UI 结构与权限约束，**不写任何接口请求**。
 * 角色列表、权限树、已分配 id 全部由 props 传入；权限树已实现父子联动与半选，
 * 下一轮统一接前端业务逻辑时，在父组件里调 /v1/roles、/v1/permissions、
 * GET/PUT /v1/roles/{id}/permissions 即可，本组件不用改。
 */
export interface RoleItem {
  role_id: string;
  name: string;
  code: string;
  description?: string | null;
  status?: string;
}

/** 一次保存的提交体：PUT 是全量覆盖语义，key 每次都必须是新值 */
export interface RolePermissionDraft {
  roleId: string;
  permissionIds: string[];
  idempotencyKey: string;
}

interface RoleManageProps {
  roles: readonly RoleItem[];
  permissionTree: readonly PermissionTreeNode[];
  selectedRoleId?: string | null;
  assignedIds?: readonly string[];
  onSelectRole?: (roleId: string) => void;
  onSave?: (draft: RolePermissionDraft) => void;
  /** 仅本地静态预览时设 true，跳过按钮级权限校验；正式接线保持 false */
  preview?: boolean;
}

const sortedKey = (ids: readonly string[]) => [...ids].sort().join(',');

export const RoleManage: React.FC<RoleManageProps> = ({
  roles,
  permissionTree,
  selectedRoleId = null,
  assignedIds = [],
  onSelectRole,
  onSave,
  preview = false
}) => {
  const canUpdateRole = usePermission('system:role:update');
  const canUpdatePermission = usePermission('system:permission:update');
  const canEdit = preview || canUpdateRole || canUpdatePermission;

  const assignedKey = sortedKey(assignedIds);
  const [draft, setDraft] = useState<string[]>(() => (assignedKey ? assignedKey.split(',') : []));

  // 切换角色或权限被重新拉取后，草稿回到服务端口径
  useEffect(() => {
    setDraft(assignedKey ? assignedKey.split(',') : []);
  }, [selectedRoleId, assignedKey]);

  const hasChanges = sortedKey(draft) !== assignedKey;

  const handleToggle = (_permissionId: string, checked: boolean, subtreeIds: string[]) => {
    setDraft((prev) => {
      const next = new Set(prev);
      for (const id of subtreeIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return [...next];
    });
  };

  const handleSave = () => {
    if (!selectedRoleId || !onSave || !hasChanges || !canEdit) return;
    onSave({
      roleId: selectedRoleId,
      permissionIds: [...draft],
      // 每次点击都生成全新 key；绝不复用上一次提交的 key
      idempotencyKey: newIdempotencyKey()
    });
  };

  return (
    <div className="rolemanage-container" data-role-count={roles.length}>
      <div className="rolemanage-header">
        <div className="rolemanage-title">角色与权限配置</div>
        <div className="rolemanage-subtitle">
          选择角色 → 勾选菜单 / 按钮权限 → 全量覆盖保存。按钮可见性由 system:role:update 权限码控制。
        </div>
      </div>

      <div className="rolemanage-body">
        <section className="rolemanage-panel">
          <div className="rolemanage-panel-title">角色列表</div>
          {roles.length === 0 ? (
            <div className="rolemanage-empty">
              角色数据待接入（下一轮由 /v1/roles 传入）。<br />
              当前为纯 UI 骨架，不发起接口请求。
            </div>
          ) : (
            <div className="role-list">
              {roles.map((role) => (
                <button
                  key={role.role_id}
                  type="button"
                  className={`role-list-item ${selectedRoleId === role.role_id ? 'role-list-item-selected' : ''}`}
                  onClick={() => onSelectRole?.(role.role_id)}
                  title={role.description ?? role.code}
                >
                  {role.name}
                  <span className="role-list-item-code">{role.code}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="rolemanage-panel">
          <div className="rolemanage-panel-title">权限资源树（已选 {draft.length} 项）</div>
          <PermissionTree
            nodes={permissionTree}
            checkedIds={draft}
            readOnly={!canEdit}
            onToggle={handleToggle}
          />
        </section>
      </div>

      <div className="rolemanage-footer">
        <span className="rolemanage-hint">
          {canEdit ? '每次提交自动生成新的 Idempotency-Key' : '当前账号无编辑权限（system:role:update）'}
        </span>
        <button
          type="button"
          className="rolemanage-save-btn"
          disabled={!canEdit || !selectedRoleId || !hasChanges || !onSave}
          onClick={handleSave}
        >
          保存权限
        </button>
      </div>
    </div>
  );
};
