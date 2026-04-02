import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import MiniApp from './mini/MiniApp.tsx';
import './index.css';

const isMini = window.location.pathname.startsWith('/mini');
const isRoot = window.location.pathname === '/' || window.location.pathname === '';

if (isRoot) {
  window.location.replace('/mini/');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isMini ? <MiniApp /> : <App />}
  </StrictMode>,
);
