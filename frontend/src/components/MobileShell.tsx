import React from 'react';

interface MobileShellProps {
  children: React.ReactNode;
  footerComponent?: React.ReactNode;
  screenTitle?: string;
  /**
   * 组员5：由 menus 折算出的可访问屏白名单（含条件加入的 'admin'）。
   * 传入后外壳会做最后一道渲染层守卫：越权的屏不渲染业务内容，避免
   * 直接改 state / 手输 hash 绕过 TabBar 的隐藏。
   */
  allowedScreens?: readonly string[];
  /** 越权占位卡片上的「返回可用页面」回调 */
  onBlockedScreen?: () => void;
}

export const MobileShell: React.FC<MobileShellProps> = ({
  children,
  footerComponent,
  screenTitle,
  allowedScreens,
  onBlockedScreen
}) => {
  const blocked = Boolean(screenTitle && allowedScreens && !allowedScreens.includes(screenTitle));

  return (
    <div
      className="mobile-shell-device"
      data-screen={screenTitle}
      data-screen-guard={blocked ? 'blocked' : 'allowed'}
    >
      {/* 核心屏幕滚动容器 */}
      <div className="mobile-screen-body">
        {blocked ? (
          <div className="screen-guard-blocked" role="alert">
            <div className="screen-guard-icon" aria-hidden="true">🔒</div>
            <h3 className="screen-guard-title">暂无访问权限</h3>
            <p className="screen-guard-desc">
              当前账号的菜单权限不包含此页面。若权限刚刚调整过，刷新页面或切回前台即可重新加载菜单。
            </p>
            {onBlockedScreen && (
              <button type="button" className="screen-guard-back-btn" onClick={onBlockedScreen}>
                返回可用页面
              </button>
            )}
          </div>
        ) : children}
      </div>

      {/* 底部导航栏与 Home 指示条：由 menus 折算后的 TabBar 传入 */}
      {footerComponent && (
        <div className="mobile-footer-wrapper">
          {footerComponent}
        </div>
      )}
    </div>
  );
};
