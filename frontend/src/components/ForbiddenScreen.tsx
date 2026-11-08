import React from 'react';

export const ForbiddenScreen: React.FC<{ onBack?: () => void }> = ({ onBack }) => (
  <div role="alert" className="screen-forbidden-container">
    <h2>无权访问</h2>
    <p>当前账号没有访问此页面的权限（403）。</p>
    {onBack && <button type="button" onClick={onBack}>返回</button>}
  </div>
);

