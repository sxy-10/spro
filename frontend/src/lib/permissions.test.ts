import { canAccessPath, hasAnyPermissionCode, hasPermissionCode } from './permissions';
import type { AuthPermissions } from './session';

const permissions: AuthPermissions = {
  menus: [{ permission_id: '20', parent_id: null, name: '线路', code: 'route:line', path: '/routes/lines', icon: null, sort: 1, children: [] }],
  buttons: [{ permission_id: '201', name: '发布线路', code: 'route:line:add', resource_type: 'BUTTON' }]
};

export const runPermissionUnitTests = () => {
  const checks = [
    hasPermissionCode(permissions, 'route:line:add'),
    !hasPermissionCode(permissions, 'route:line:delete'),
    hasAnyPermissionCode(permissions, ['route:line:delete', 'route:line:add']),
    canAccessPath(permissions, '/routes/lines'),
    !canAccessPath(permissions, '/admin')
  ];
  if (checks.some((passed) => !passed)) throw new Error('权限单元测试失败');
};

