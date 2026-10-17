import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { APP_CONFIG } from './config';
import 'tdesign-react/esm/style/index.js';
import './index.css';
import './design/tokens.css';
import './design/typography.css';
import './design/motion.css';
import './design/legacy.css';
import './ui/ui.css';
import { initializeUnsavedContextGuard } from './hooks/useUnsavedContext';
import { AuthProvider } from './hooks/useAuth';

// 设置页面标题
document.title = APP_CONFIG.name;
initializeUnsavedContextGuard();

// Compile-time DEV guard keeps gallery code and its route out of production.
const UiGallery = import.meta.env.DEV
  ? React.lazy(() => import('./dev/UiGallery'))
  : null;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      {UiGallery && window.location.pathname === '/dev/ui'
        ? <React.Suspense fallback={<p role="status">正在加载界面预览…</p>}><UiGallery /></React.Suspense>
        : <AuthProvider><App /></AuthProvider>}
    </BrowserRouter>
  </React.StrictMode>,
);
