import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { APP_CONFIG } from './config';
import 'tdesign-react/esm/style/index.js';
import './index.css';
import { initializeUnsavedContextGuard } from './hooks/useUnsavedContext';

// 设置页面标题
document.title = APP_CONFIG.name;
initializeUnsavedContextGuard();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
