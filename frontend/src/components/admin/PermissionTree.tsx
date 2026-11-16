import React, { useEffect, useRef, useState } from 'react';
import {
  collectSubtreeIds,
  computeNodeCheckState,
  type NodeCheckState,
  type PermissionTreeNode
} from '../../lib/permissionTree';

export { collectSubtreeIds, collectDescendantIds, computeNodeCheckState } from '../../lib/permissionTree';
export type { NodeCheckState, PermissionTreeNode } from '../../lib/permissionTree';

/**
 * 组员5（阶段4）：权限资源树（纯展示组件）
 *
 * 数据形状对齐 GET /v1/permissions 与 GET /v1/users/me/permissions 的 menus 树：
 * MENU 是父节点，BUTTON 挂在所属 MENU 的 children 下。
 * 本轮不请求接口，节点由父组件通过 props 传入。
 *
 * 勾选语义（分工文档 4.2「父子联动与半选」）：
 *   - 勾父带子：一次把整棵子树 id 加进草稿；取消父则整棵移除；
 *   - 勾子带父：父节点状态由后代自动推导 —— 全勾为勾、部分勾为半选、全不勾为空；
 *   - 父节点不在草稿里单独存一份，避免父子状态互相打架；后端 PUT 本身也会补祖先菜单。
 */
interface PermissionTreeProps {
  nodes: readonly PermissionTreeNode[];
  checkedIds: readonly string[];
  readOnly?: boolean;
  /** 勾选回调给出整棵子树的 id，供父组件做全量覆盖式分配 */
  onToggle?: (permissionId: string, checked: boolean, subtreeIds: string[]) => void;
}

/** HTML 的 indeterminate 只能通过 DOM 属性设置，React 没有对应 prop */
const TreeCheckbox: React.FC<{
  state: NodeCheckState;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}> = ({ state, disabled, onChange }) => {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state.indeterminate;
  }, [state.indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={state.checked}
      disabled={disabled}
      aria-checked={state.indeterminate ? 'mixed' : state.checked}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
};

export const PermissionTree: React.FC<PermissionTreeProps> = ({
  nodes,
  checkedIds,
  readOnly = false,
  onToggle
}) => {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const checkedSet = new Set(checkedIds);

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderNode = (node: PermissionTreeNode, depth: number): React.ReactNode => {
    const children = node.children ?? [];
    const isCollapsed = collapsed.has(node.permission_id);
    const state = computeNodeCheckState(node, checkedSet);
    return (
      <div className="perm-tree-node" key={node.permission_id} data-depth={depth}>
        <div className="perm-tree-row">
          <label>
            <TreeCheckbox
              state={state}
              disabled={readOnly || !onToggle}
              onChange={(checked) =>
                onToggle?.(node.permission_id, checked, collectSubtreeIds(node))
              }
            />
            <span className="perm-tree-name">{node.name}</span>
            <span className="perm-tree-code">{node.code}</span>
          </label>
          <span className="perm-tree-badge">{node.resource_type}</span>
          {children.length > 0 && (
            <button
              type="button"
              className="perm-tree-expand-btn"
              aria-label={isCollapsed ? '展开子权限' : '收起子权限'}
              onClick={() => toggleCollapse(node.permission_id)}
            >
              {isCollapsed ? '▸' : '▾'}
            </button>
          )}
        </div>
        {children.length > 0 && !isCollapsed && (
          <div className="perm-tree-children">
            {children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (nodes.length === 0) {
    return (
      <div className="rolemanage-empty">
        权限树数据待接入（下一轮由 /v1/permissions 传入）。<br />
        组件已支持 MENU / BUTTON 两级、父子联动与半选。
      </div>
    );
  }

  return <div className="perm-tree">{nodes.map((node) => renderNode(node, 0))}</div>;
};
