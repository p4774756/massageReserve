#!/usr/bin/env node
/**
 * 一次性：將 Firebase Authentication 裡「有 Email 且 emailVerified === false」
 * 的使用者全部改為 emailVerified: true。
 *
 * 憑證（擇一，否則會報 invalid-credential）：
 *
 * A) 服務帳號 JSON（最穩）
 *    export GOOGLE_APPLICATION_CREDENTIALS=/絕對路徑/serviceAccountKey.json
 *
 * B) Application Default Credentials（本機開發常用）
 *    gcloud auth application-default login
 *    並指定專案（擇一）：
 *      export GOOGLE_CLOUD_PROJECT=my-massage-reserve
 *    或：
 *      npm run verify-all-emails -- --dry-run --project=my-massage-reserve
 *    （若專案根目錄有 .firebaserc，也會嘗試讀取 default 專案）
 *
 * 在 functions 目錄執行：
 *   npm run verify-all-emails -- --dry-run
 *   npm run verify-all-emails
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const dryRun = process.argv.includes("--dry-run");

function argvProject() {
  const prefix = "--project=";
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : "";
}

function readDefaultProjectFromFirebaserc() {
  const candidates = [resolve(process.cwd(), ".firebaserc"), resolve(process.cwd(), "..", ".firebaserc")];
  for (const p of candidates) {
    try {
      const rc = JSON.parse(readFileSync(p, "utf8"));
      const id = rc?.projects?.default;
      if (typeof id === "string" && id.length > 0) return id;
    } catch {
      /* ignore */
    }
  }
  return "";
}

function initAdmin() {
  if (getApps().length > 0) return;
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (keyPath) {
    const abs = resolve(keyPath);
    const sa = JSON.parse(readFileSync(abs, "utf8"));
    initializeApp({
      credential: cert(sa),
      projectId: sa.project_id,
    });
    return;
  }

  const projectId =
    argvProject() ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.FIREBASE_PROJECT_ID ||
    readDefaultProjectFromFirebaserc();

  if (!projectId) {
    console.error(
      "找不到專案 ID。請擇一：\n" +
        "  npm run verify-all-emails -- --dry-run --project=你的專案ID\n" +
        "  export GOOGLE_CLOUD_PROJECT=你的專案ID\n" +
        "  或在專案根目錄放置 .firebaserc（含 projects.default）\n",
    );
    process.exit(1);
  }

  initializeApp({
    credential: applicationDefault(),
    projectId,
  });
}

function printCredentialHelp(err) {
  const msg = err && typeof err === "object" && "message" in err ? String(err.message) : String(err);
  if (!/credential|default credentials|OAuth2|access token/i.test(msg)) return false;
  console.error("\n無法取得 Google 憑證，Admin SDK 無法呼叫 Auth API。\n");
  console.error("請擇一完成設定：\n");
  console.error("【方式 A】服務帳號 JSON（建議）");
  console.error("  1. Firebase Console → 專案設定 → 服務帳戶 → 產生新的私密金鑰");
  console.error("  2. export GOOGLE_APPLICATION_CREDENTIALS=/絕對路徑/那支.json");
  console.error("  3. 再執行 npm run verify-all-emails -- --dry-run\n");
  console.error("【方式 B】本機 ADC");
  console.error("  1. 安裝並登入：gcloud auth application-default login");
  console.error("  2. export GOOGLE_CLOUD_PROJECT=你的Firebase專案ID");
  console.error("     （或加上參數 --project=專案ID）");
  console.error("  3. 再執行 npm run verify-all-emails -- --dry-run\n");
  return true;
}

initAdmin();

const auth = getAuth();

let scanned = 0;
let alreadyVerified = 0;
let noEmail = 0;
let changed = 0;
let errors = 0;

let pageToken;
try {
  do {
    const res = await auth.listUsers(1000, pageToken);
    for (const u of res.users) {
      scanned++;
      if (!u.email) {
        noEmail++;
        continue;
      }
      if (u.emailVerified) {
        alreadyVerified++;
        continue;
      }
      if (dryRun) {
        console.log(`[dry-run] 將標記已驗證: ${u.email} (${u.uid})`);
        changed++;
        continue;
      }
      try {
        await auth.updateUser(u.uid, { emailVerified: true });
        console.log(`已更新: ${u.email} (${u.uid})`);
        changed++;
      } catch (e) {
        errors++;
        const m = e && typeof e === "object" && "message" in e ? e.message : String(e);
        console.error(`失敗 ${u.email} (${u.uid}):`, m);
      }
    }
    pageToken = res.pageToken;
  } while (pageToken);
} catch (e) {
  if (printCredentialHelp(e)) {
    process.exit(1);
  }
  throw e;
}

console.log(
  "\n摘要:",
  JSON.stringify(
    {
      dryRun,
      scanned,
      alreadyVerified,
      noEmail,
      changed,
      errors,
    },
    null,
    2,
  ),
);

if (errors > 0) {
  process.exit(1);
}
