/**
 * 组员5（阶段4）：权限树勾选状态的纯函数层（不含 React，便于直接单测）。
 *
 * 数据形状对齐 GET /v1/permissions 的 menus 树；PUT /v1/roles/{id}/permissions
 * 是全量覆盖语义，且后端会补齐祖先菜单，所以前端只需维护「被勾选的节点 id 集合」。
 */
export interface PermissionTreeNode {
  permission_id: string;
  name: string;
  code: string;
  resource_type: 'MENU' | 'BUTTON';
  path?: string | null;
  children?: PermissionTreeNode[];
}

/** 收集某节点及所有后代的 id（含自身） */
export const collectSubtreeIds = (node: PermissionTreeNode): string[] => {
  const ids = [node.permission_id];
  for (const child of node.children ?? []) ids.push(...collectSubtreeIds(child));
  return ids;
};

/** 收集某节点的所有后代 id（不含自身） */
export const collectDescendantIds = (node: PermissionTreeNode): string[] =>
  collectSubtreeIds(node).slice(1);

export interface NodeCheckState {
  checked: boolean;
  indeterminate: boolean;
}

/**
 * 由草稿推导节点显示状态：
 * 叶子看自身；父节点全勾 → 勾，部分勾 → 半选，全不勾 → 空。
 */
export const computeNodeCheckState = (
  node: PermissionTreeNode,
  checkedSet: ReadonlySet<string>
): NodeCheckState => {
  const descendants = collectDescendantIds(node);
  if (descendants.length === 0) {
    return { checked: checkedSet.has(node.permission_id), indeterminate: false };
  }
  const hit = descendants.filter((id) => checkedSet.has(id)).length;
  if (hit === descendants.length) return { checked: true, indeterminate: false };
  if (hit > 0 || checkedSet.has(node.permission_id)) return { checked: false, indeterminate: true };
  return { checked: false, indeterminate: false };
};
