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

/** GET /v1/permissions 返回的菜单树原始节点（children 只有子菜单，不含按钮） */
export interface RawMenuNode {
  permission_id: string;
  name: string;
  code: string;
  path?: string | null;
  children?: readonly RawMenuNode[];
}

export interface RawButtonNode {
  permission_id: string;
  parent_id: string | null;
  name: string;
  code: string;
}

/**
 * 把 GET /v1/permissions 的返回拼成可勾选的编辑树。
 *
 * 后端的 menus 树只含 MENU（children 也只有子菜单），BUTTON 是按 parent_id
 * 平铺在 buttons 数组里的 —— 而编辑树组件要求按钮挂在所属菜单的 children 下，
 * 所以在这里做一次「菜单转节点 + 按钮归位」。父菜单缺失的孤儿按钮提升为根节点，
 * 保证勾选粒度不丢。
 */
export const buildEditableTree = (
  menus: readonly RawMenuNode[],
  buttons: readonly RawButtonNode[]
): PermissionTreeNode[] => {
  const convertMenu = (node: RawMenuNode): PermissionTreeNode => ({
    permission_id: node.permission_id,
    name: node.name,
    code: node.code,
    resource_type: 'MENU',
    path: node.path ?? null,
    children: (node.children ?? []).map(convertMenu)
  });

  const tree = menus.map(convertMenu);
  const menuById = new Map<string, PermissionTreeNode>();
  const walk = (nodes: readonly PermissionTreeNode[]): void => {
    for (const node of nodes) {
      menuById.set(node.permission_id, node);
      walk(node.children ?? []);
    }
  };
  walk(tree);

  for (const button of buttons) {
    const node: PermissionTreeNode = {
      permission_id: button.permission_id,
      name: button.name,
      code: button.code,
      resource_type: 'BUTTON',
      path: null,
      children: []
    };
    const parent = button.parent_id != null ? menuById.get(button.parent_id) : undefined;
    if (parent) parent.children?.push(node);
    else tree.push(node);
  }
  return tree;
};

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
