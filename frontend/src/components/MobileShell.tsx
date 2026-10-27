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
      {/* 核心屏幕滚动容器 */}
      <div className="mobile-screen-body">
        {children}
      </div>

      {/* 底部导航栏与 Home 指示条 */}
      {footerComponent && (
        <div className="mobile-footer-wrapper">
          {footerComponent}
        </div>
      )}
    </div>
  );
};
