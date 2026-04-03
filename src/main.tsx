import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import MiniApp from './mini/MiniApp.tsx';
import './index.css';

const isMini = window.location.pathname.startsWith('/mini');

// 起動成功 → リロードフラグをクリア
sessionStorage.removeItem('__choicrew_reload');

// 古いService Workerキャッシュをクリア
if ('caches' in window) {
  caches.keys().then(names => {
    for (const name of names) caches.delete(name);
  });
}

// 動的import失敗のハンドリング（unhandledrejection）
window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason?.message || String(e.reason || '');
  if (/chunk|dynamically imported module|loading module|importing a module/i.test(msg)) {
    e.preventDefault();
    if (!sessionStorage.getItem('__choicrew_reload')) {
      sessionStorage.setItem('__choicrew_reload', '1');
      if ('caches' in window) {
        caches.keys().then(names => Promise.all(names.map(n => caches.delete(n)))).then(() => location.reload());
      } else {
        location.reload();
      }
    }
  }
});

window.addEventListener("error", (e) => {
  if (e.message && (e.message.includes("chunk") || e.message.includes("Failed to fetch dynamically imported module") || e.message.includes("Loading module"))) {
    if (!sessionStorage.getItem('__choicrew_reload')) {
      sessionStorage.setItem('__choicrew_reload', '1');
      if ('caches' in window) {
        caches.keys().then(names => Promise.all(names.map(n => caches.delete(n)))).then(() => location.reload());
      } else {
        location.reload();
      }
    }
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isMini ? <MiniApp /> : <App />}
  </StrictMode>,
);