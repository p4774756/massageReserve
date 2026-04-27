import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

function readConfig() {
  const env = import.meta.env;
  return {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  };
}

export function isFirebaseConfigured(): boolean {
  const c = readConfig();
  return Boolean(c.apiKey && c.projectId && c.appId);
}

let app: FirebaseApp | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (!app) {
    if (!isFirebaseConfigured()) {
      throw new Error("Firebase 尚未設定：請建立 .env 並填入 VITE_FIREBASE_*");
    }
    app = initializeApp(readConfig());
  }
  return app;
}

export function getFns() {
  return getFunctions(getFirebaseApp(), "asia-east1");
}

export const createBookingCall = () => httpsCallable(getFns(), "createBooking");
export const getAvailabilityCall = () => httpsCallable(getFns(), "getAvailability");
export const getBookingPricingCall = () => httpsCallable(getFns(), "getBookingPricing");
export const getMyWalletCall = () => httpsCallable(getFns(), "getMyWallet");
export const redeemWheelPointsCall = () => httpsCallable(getFns(), "redeemWheelPoints");
export const topupWalletCall = () => httpsCallable(getFns(), "topupWallet");
export const completeBookingCall = () => httpsCallable(getFns(), "completeBooking");
export const cancelBookingCall = () => httpsCallable(getFns(), "cancelBooking");
export const spinWheelCall = () => httpsCallable(getFns(), "spinWheel");
export const listActiveWheelPrizesCall = () => httpsCallable(getFns(), "listActiveWheelPrizes");
export const seedWheelPrizesCall = () => httpsCallable(getFns(), "seedWheelPrizes");
export const getAdminStatusCall = () => httpsCallable(getFns(), "getAdminStatus");
export const createMemberAccountCall = () => httpsCallable(getFns(), "createMemberAccount");
export const searchMemberUsersCall = () => httpsCallable(getFns(), "searchMemberUsers");
export const listMembersAdminCall = () => httpsCallable(getFns(), "listMembersAdmin");
export const migrateLegacyWalletsAdminCall = () => httpsCallable(getFns(), "migrateLegacyWalletsAdmin");
export const testSendMemberStatusTestEmailCall = () => httpsCallable(getFns(), "testSendMemberStatusTestEmail");
export const updateMemberNicknameAdminCall = () => httpsCallable(getFns(), "updateMemberNicknameAdmin");
export const sendSupportChatMessageCall = () => httpsCallable(getFns(), "sendSupportChatMessage");
export const sendSupportChatAdminReplyCall = () => httpsCallable(getFns(), "sendSupportChatAdminReply");
export const setSupportThreadStatusAdminCall = () => httpsCallable(getFns(), "setSupportThreadStatusAdmin");
export const recordSiteVisitCall = () => httpsCallable(getFns(), "recordSiteVisit");

export function getDb() {
  return getFirestore(getFirebaseApp());
}

export function getFirebaseAuth() {
  return getAuth(getFirebaseApp());
}
