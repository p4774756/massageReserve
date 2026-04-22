import { getMessaging, getToken, isSupported } from "firebase/messaging";
import { getFirebaseApp, registerPushTokenCall, unregisterPushTokenCall } from "./firebase";

let cachedFcmToken: string | null = null;

export function getWebPushVapidKey(): string | null {
  const k = import.meta.env.VITE_FIREBASE_VAPID_KEY;
  return typeof k === "string" && k.trim().length > 0 ? k.trim() : null;
}

function firebaseConfigQuery(): URLSearchParams {
  const env = import.meta.env;
  const p = new URLSearchParams();
  p.set("apiKey", String(env.VITE_FIREBASE_API_KEY ?? ""));
  p.set("authDomain", String(env.VITE_FIREBASE_AUTH_DOMAIN ?? ""));
  p.set("projectId", String(env.VITE_FIREBASE_PROJECT_ID ?? ""));
  p.set("storageBucket", String(env.VITE_FIREBASE_STORAGE_BUCKET ?? ""));
  p.set("messagingSenderId", String(env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? ""));
  p.set("appId", String(env.VITE_FIREBASE_APP_ID ?? ""));
  return p;
}

export async function registerWebPushForCurrentUser(): Promise<{ ok: true } | { ok: false; message: string }> {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
    return { ok: false, message: "此環境不支援瀏覽器推播。" };
  }
  if (!(await isSupported())) {
    return { ok: false, message: "此瀏覽器不支援 Firebase 網頁推播。" };
  }
  const vapidKey = getWebPushVapidKey();
  if (!vapidKey) {
    return { ok: false, message: "網站未設定 VITE_FIREBASE_VAPID_KEY，無法訂閱推播。" };
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    return { ok: false, message: "未授予通知權限，無法訂閱推播。" };
  }
  const swUrl = `/firebase-messaging-sw.js?${firebaseConfigQuery().toString()}`;
  const registration = await navigator.serviceWorker.register(swUrl, { type: "classic", scope: "/" });
  await navigator.serviceWorker.ready;
  const messaging = getMessaging(getFirebaseApp());
  const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
  if (!token) {
    return { ok: false, message: "無法取得 FCM 裝置 token。" };
  }
  const fn = registerPushTokenCall();
  await fn({ token });
  cachedFcmToken = token;
  return { ok: true };
}

export async function unregisterWebPushForCurrentUser(): Promise<void> {
  const token = cachedFcmToken;
  cachedFcmToken = null;
  if (!token) return;
  try {
    const fn = unregisterPushTokenCall();
    await fn({ token });
  } catch {
    // 登出時不因推播取消失敗而阻斷
  }
}
