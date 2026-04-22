/* global importScripts, firebase */
/**
 * FCM Web 背景推播用 Service Worker。
 * 主應用程式會以 query string 帶入與 Web SDK 相同的 firebaseConfig（金鑰本來就屬公開設定）。
 */
importScripts("https://www.gstatic.com/firebasejs/11.6.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.6.0/firebase-messaging-compat.js");

try {
  const params = new URL(self.location.href).searchParams;
  const firebaseConfig = {
    apiKey: params.get("apiKey") ?? "",
    authDomain: params.get("authDomain") ?? "",
    projectId: params.get("projectId") ?? "",
    storageBucket: params.get("storageBucket") ?? "",
    messagingSenderId: params.get("messagingSenderId") ?? "",
    appId: params.get("appId") ?? "",
  };
  if (firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId) {
    firebase.initializeApp(firebaseConfig);
    const messaging = firebase.messaging();
    messaging.onBackgroundMessage(() => {});
  }
} catch {
  // 避免 SW 註冊階段拋錯導致推播完全失效
}
