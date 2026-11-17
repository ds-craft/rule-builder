import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
// portal 由来の CSS は .rb-portal の内側だけに効かせる（vite.config.ts の portalScope）。
// ファイルごとに処理させるため、ここで1つずつ読み込む。
import './styles/portal/tokens.css';
import './styles/portal/base.css';
import './styles/portal/components.css';
import './styles/portal/style.css';
import './styles/index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
