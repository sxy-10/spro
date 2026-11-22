import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// 先注入 shared-auth 配置（persist: 'full'，agency_* 存储键），再挂 React
import './lib/auth';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
