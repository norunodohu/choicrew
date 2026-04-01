// ファイル名: src/firebase.ts
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getMessaging } from 'firebase/messaging';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

let _messaging: ReturnType<typeof getMessaging> | null = null;
try {
  _messaging = getMessaging(app);
} catch {
  // Push messaging not supported in this environment
}
export const messaging = _messaging;
