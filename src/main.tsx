import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import MiniApp from './mini/MiniApp.tsx';
import './index.css';

const isMini = window.location.pathname.startsWith('/mini');

// 起動成功 → リロードフラグをクリア
sessionStorage.removeItem('__choicrew_reload');

// 古いService Workerキャッシュをクリア（毎回ではなくバージョン不一致時のみ）
if ('caches' in window) {
  caches.keys().then(names => {
    for (const name of names) caches.delete(name);
  });
}

window.addEventListener("error", (e) => {
  if (e.message && (e.message.includes("chunk") || e.message.includes("Failed to fetch dynamically imported module") || e.message.includes("Loading module"))) {
    if (!sessionStorage.getItem('__choicrew_reload')) {
      sessionStorage.setItem('__choicrew_reload', '1');
      window.location.reload();
    }
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isMini ? <MiniApp /> : <App />}
  </StrictMode>,
);