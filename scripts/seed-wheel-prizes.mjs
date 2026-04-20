import { initializeApp } from "firebase/app";
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
  const fns = getFunctions(app, "asia-east1");
  const seed = httpsCallable(fns, "seedWheelPrizes");
  const res = await seed({});
  console.log(JSON.stringify(res.data, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
