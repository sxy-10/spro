import React from 'react';
import { usePermission } from '../hooks/useAuth';

interface AuthPermissionProps {
  code: string;
  children: React.ReactNode;
  /** hide 隐藏无权限控件；disable 保留控件但禁止点击 */
  mode?: 'hide' | 'disable';
  fallback?: React.ReactNode;
}

export const AuthPermission: React.FC<AuthPermissionProps> = ({ code, children, mode = 'hide', fallback = null }) => {
  const allowed = usePermission(code);
  if (allowed) return <>{children}</>;
  if (mode === 'disable') {
    return <span aria-disabled="true" className="auth-permission-disabled">{children}</span>;
  }
  return <>{fallback}</>;
};

