// ファイル名: src/firebase.ts
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';
import { getMessaging } from 'firebase/messaging';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// LINE・Instagram・Facebook等のアプリ内ブラウザでは WebSocket(WebChannel) が
// 正常に動作しないため、全環境で HTTP LongPolling を使用する。
// 通常ブラウザでのパフォーマンス差は軽微でこのアプリでは許容範囲。
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
});

let _messaging: ReturnType<typeof getMessaging> | null = null;
try {
  _messaging = getMessaging(app);
} catch {
  // Push messaging not supported in this environment
}
export const messaging = _messaging;
export const storage = getStorage(app);
