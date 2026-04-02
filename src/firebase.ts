// ファイル名: src/firebase.ts
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, getFirestore } from 'firebase/firestore';
import { getMessaging } from 'firebase/messaging';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// LINEブラウザ・各種アプリ内ブラウザではWebChannelが正常動作しないため
// experimentalForceLongPolling を使用してフォールバック
const isInAppBrowser = /Line\//i.test(navigator.userAgent)
  || /FBAN|FBAV|Instagram|Snapchat|Twitter|MicroMessenger/i.test(navigator.userAgent);

let db: ReturnType<typeof getFirestore>;
if (isInAppBrowser) {
  db = initializeFirestore(app, { experimentalForceLongPolling: true }, firebaseConfig.firestoreDatabaseId);
} else {
  db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
}
export { db };

let _messaging: ReturnType<typeof getMessaging> | null = null;
try {
  _messaging = getMessaging(app);
} catch {
  // Push messaging not supported in this environment
}
export const messaging = _messaging;
