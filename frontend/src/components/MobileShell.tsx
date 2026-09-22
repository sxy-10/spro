import React from 'react';

interface MobileShellProps {
  children: React.ReactNode;
  footerComponent?: React.ReactNode;
  screenTitle?: string;
}

export const MobileShell: React.FC<MobileShellProps> = ({
  children,
  footerComponent,
  screenTitle
}) => {
  return (
    <div className="mobile-shell-device" data-screen={screenTitle}>
      {/* 顶部听筒 / 灵动岛区 */}
      <div className="mobile-status-bar">
        <div className="status-time">10:48</div>
        <div className="dynamic-island-pill">
          <div className="island-camera-dot"></div>
        </div>
        <div className="status-icons">
          <span className="signal-icon">5G</span>
          <span className="battery-icon">
            86%
            <span className="battery-level-bar"></span>
          </span>
        </div>
      </div>

      {/* 核心屏幕滚动容器 */}
      <div className="mobile-screen-body">
        {children}
      </div>

      {/* 底部导航栏与 Home 指示条 */}
      {footerComponent && (
        <div className="mobile-footer-wrapper">
          {footerComponent}
          <div className="mobile-home-indicator">
            <div className="home-bar-line"></div>
          </div>
        </div>
      )}
    </div>
  );
};
