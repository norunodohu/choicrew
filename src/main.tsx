import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import MiniApp from './mini/MiniApp.tsx';
import './index.css';

const isMini = window.location.pathname.startsWith('/mini');

// 古いキャッシュをクリア & chunkエラー時にリロード
if ('caches' in window) {
  caches.keys().then(names => {
    for (const name of names) caches.delete(name);
  });
}

window.addEventListener("error", (e) => {
  if (e.message && (e.message.includes("chunk") || e.message.includes("Failed to fetch dynamically imported module") || e.message.includes("Loading module"))) {
    window.location.reload();
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isMini ? <MiniApp /> : <App />}
  </StrictMode>,
);