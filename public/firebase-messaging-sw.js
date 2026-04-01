// Firebase Messaging Service Worker
// バックグラウンド（タブを閉じている状態）でのプッシュ通知を処理する
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCnUdvAVsd5CLrsrC_B4hw29TUTrj14UG0",
  authDomain: "shiftshare-423fa.firebaseapp.com",
  projectId: "shiftshare-423fa",
  storageBucket: "shiftshare-423fa.firebasestorage.app",
  messagingSenderId: "864598700223",
  appId: "1:864598700223:web:f4d567877f81d7e2bc160a",
});

const messaging = firebase.messaging();

// バックグラウンドメッセージ受信時に通知を表示
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || '新着依頼があります';
  const body = payload.notification?.body || '依頼が届きました';
  self.registration.showNotification(title, {
    body,
    icon: '/choicrew-mark.svg',
    badge: '/choicrew-mark.svg',
    tag: 'choicrew-new-request',
    requireInteraction: false,
  });
});
