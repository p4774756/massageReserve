import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";

function required(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(`missing env: ${name}`);
  }
  return v;
}

const app = initializeApp({
  apiKey: required("VITE_FIREBASE_API_KEY"),
  authDomain: required("VITE_FIREBASE_AUTH_DOMAIN"),
  projectId: required("VITE_FIREBASE_PROJECT_ID"),
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: required("VITE_FIREBASE_APP_ID"),
});

async function run() {
  const adminEmail = process.env.SEED_WHEEL_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_WHEEL_ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) {
    throw new Error(
      "請在 .env 設定 SEED_WHEEL_ADMIN_EMAIL、SEED_WHEEL_ADMIN_PASSWORD（須為 Firestore admins/{uid} 對應的管理員帳號）",
    );
  }
  await signInWithEmailAndPassword(getAuth(app), adminEmail, adminPassword);

  const fns = getFunctions(app, "asia-east1");
  const seed = httpsCallable(fns, "seedWheelPrizes");
  const res = await seed({});
  console.log(JSON.stringify(res.data, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
