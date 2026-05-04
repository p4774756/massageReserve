import { randomInt, randomUUID } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  foldWalletBalanceIntoSessions,
  resolveArcadePointsPerMassage,
  resolveSessionPriceNtd,
} from "./pricing";
import { parseLocale, st, type ServerLocale } from "./serverI18n";

const region = "asia-east1";
const publicCall = { region, invoker: "public" as const };

const LM_BET_LINES = 8;
const MAX_BET_PER_LINE = 999;
const MAX_TOTAL_BET = 8000;

/** 與前端 `bookTabLittleMary.ts` 之 LOOP_24、BET_LINES 順序一致 */
const LOOP_24 = [
  "cherry",
  "orange",
  "lemon",
  "watermelon",
  "bell",
  "star",
  "bar",
  "seven",
  "cherry",
  "orange",
  "lemon",
  "watermelon",
  "bell",
  "star",
  "seven",
  "cherry",
  "orange",
  "lemon",
  "watermelon",
  "bell",
  "cherry",
  "orange",
  "lemon",
  "cherry",
] as const;

const SYM_MULT: Record<string, number> = {
  cherry: 2,
  lemon: 12,
  orange: 10,
  watermelon: 20,
  bell: 20,
  star: 30,
  seven: 40,
  bar: 50,
};

const LINE_ORDER = ["cherry", "lemon", "orange", "watermelon", "bell", "star", "seven", "bar"] as const;

function parseLittleMaryBets(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length !== LM_BET_LINES) return null;
  const out: number[] = [];
  let sum = 0;
  for (const v of raw) {
    const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : NaN;
    if (n < 0 || n !== v || n > MAX_BET_PER_LINE) return null;
    out.push(n);
    sum += n;
  }
  if (sum < 1 || sum > MAX_TOTAL_BET) return null;
  return out;
}

function hitGainForStop(bets: number[], stopIndex: number): number {
  const sym = LOOP_24[stopIndex];
  if (!sym) return 0;
  const lineIdx = LINE_ORDER.indexOf(sym as (typeof LINE_ORDER)[number]);
  if (lineIdx < 0) return 0;
  const mult = SYM_MULT[sym] ?? 0;
  const b = bets[lineIdx] ?? 0;
  return b * mult;
}

async function assertMemberEmailVerified(uid: string, locale: ServerLocale): Promise<void> {
  const record = await getAuth().getUser(uid);
  if (!record.emailVerified) {
    throw new HttpsError(
      "failed-precondition",
      st(locale, "member.verifyEmailFirst", "請先至信箱完成 Email 驗證後再使用會員功能。"),
    );
  }
}

/**
 * 小瑪莉試玩：伺服器以 CSPRNG 決定外圈停格 index（0～23），與前端 LOOP_24 對齊。
 * 不驗證客戶端分數（試玩經濟仍在瀏覽器）；僅驗證押注陣列格式以防濫用 payload。
 */
export const littleMarySpin = onCall(publicCall, async (request) => {
  const locale = parseLocale(request.data);
  const bets = parseLittleMaryBets(request.data?.bets);
  if (!bets) {
    throw new HttpsError(
      "invalid-argument",
      st(
        locale,
        "lm.badBets",
        "押注須為 8 個非負整數，總押 1～8000，單線至多 999。",
      ),
    );
  }
  const stopIndex = randomInt(0, 24);
  const roundId = randomUUID();
  return { stopIndex, roundId };
});

/** 比大小：伺服器開 1～12 點（均勻）；不驗證客戶端得分，僅限制參數範圍。 */
export const littleMaryHiLoRoll = onCall(publicCall, async (request) => {
  const locale = parseLocale(request.data);
  const stakeRaw = request.data?.stake;
  const n = typeof stakeRaw === "number" && Number.isFinite(stakeRaw) ? Math.trunc(stakeRaw) : NaN;
  if (n < 1 || n > 9999 || n !== stakeRaw) {
    throw new HttpsError(
      "invalid-argument",
      st(locale, "lm.badStake", "比大小參數 stake 須為 1～9999 的整數。"),
    );
  }
  const roll = randomInt(1, 13);
  return { roll };
});

/**
 * 會員：小瑪莉扣押注、開獎並寫入 `arcadePoints`（與試玩分數分離）。
 * 結算：arcadePoints -= sum(bets) + hitGain。
 */
export const littleMarySpinAccount = onCall(publicCall, async (request) => {
  const locale = parseLocale(request.data);
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", st(locale, "auth.needLogin", "請先登入"));
  }
  await assertMemberEmailVerified(uid, locale);

  const bets = parseLittleMaryBets(request.data?.bets);
  if (!bets) {
    throw new HttpsError(
      "invalid-argument",
      st(locale, "lm.badBets", "押注須為 8 個非負整數，總押 1～8000，單線至多 999。"),
    );
  }

  const db = getFirestore();
  const customerRef = db.collection("customers").doc(uid);
  const walletTxRef = db.collection("walletTransactions").doc();
  const wager = bets.reduce((a, b) => a + b, 0);
  const roundId = randomUUID();
  const stopIndex = randomInt(0, 24);
  const hitGain = hitGainForStop(bets, stopIndex);

  const out = await db.runTransaction(async (tx) => {
    const pricingSnap = await tx.get(db.collection("siteSettings").doc("pricing"));
    const sessionPriceNtd = resolveSessionPriceNtd(pricingSnap.data());
    const snap = await tx.get(customerRef);
    const walletBalanceRaw = snap.exists ? snap.get("walletBalance") : 0;
    const sessionCreditsRaw = snap.exists ? snap.get("sessionCredits") : 0;
    const wheelPointsRaw = snap.exists ? snap.get("wheelPoints") : 0;
    const drawChancesRaw = snap.exists ? snap.get("drawChances") : 0;
    const arcadePointsRaw = snap.exists ? snap.get("arcadePoints") : 0;

    let walletBalance = typeof walletBalanceRaw === "number" ? walletBalanceRaw : 0;
    let sessionCredits = typeof sessionCreditsRaw === "number" ? sessionCreditsRaw : 0;
    let wheelPoints = typeof wheelPointsRaw === "number" ? wheelPointsRaw : 0;
    const drawChances = typeof drawChancesRaw === "number" ? drawChancesRaw : 0;
    let arcadePoints = typeof arcadePointsRaw === "number" ? arcadePointsRaw : 0;

    const folded = foldWalletBalanceIntoSessions(walletBalance, sessionCredits, sessionPriceNtd);
    walletBalance = folded.walletBalance;
    sessionCredits = folded.sessionCredits;

    if (arcadePoints < wager) {
      throw new HttpsError(
        "failed-precondition",
        st(locale, "lm.arcadeShort", "遊戲點不足，無法押注此金額。"),
      );
    }

    arcadePoints = arcadePoints - wager + hitGain;
    if (arcadePoints > 999_999) arcadePoints = 999_999;

    tx.set(
      customerRef,
      {
        walletBalance,
        sessionCredits,
        wheelPoints,
        drawChances,
        arcadePoints,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    tx.set(walletTxRef, {
      customerId: uid,
      type: "arcade_lm_spin",
      amount: 0,
      note: `小瑪莉：wager=${wager} stop=${stopIndex} gain=${hitGain} round=${roundId}`,
      operatorId: uid,
      createdAt: FieldValue.serverTimestamp(),
    });

    return { arcadePoints, wager, hitGain, stopIndex, roundId };
  });

  return out;
});

/** 會員：比大小結算（增減 arcadePoints） */
export const littleMaryHiLoAccount = onCall(publicCall, async (request) => {
  const locale = parseLocale(request.data);
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", st(locale, "auth.needLogin", "請先登入"));
  }
  await assertMemberEmailVerified(uid, locale);

  const stakeRaw = request.data?.stake;
  const stake = typeof stakeRaw === "number" && Number.isFinite(stakeRaw) ? Math.trunc(stakeRaw) : NaN;
  if (stake < 1 || stake > 9999 || stake !== stakeRaw) {
    throw new HttpsError(
      "invalid-argument",
      st(locale, "lm.badStake", "比大小參數 stake 須為 1～9999 的整數。"),
    );
  }
  const guessHigh = request.data?.guessHigh === true;

  const db = getFirestore();
  const customerRef = db.collection("customers").doc(uid);
  const walletTxRef = db.collection("walletTransactions").doc();
  const roll = randomInt(1, 13);
  const isHigh = roll >= 7;
  const hit = guessHigh ? isHigh : !isHigh;
  const delta = hit ? stake : -stake;

  const out = await db.runTransaction(async (tx) => {
    const pricingSnap = await tx.get(db.collection("siteSettings").doc("pricing"));
    const sessionPriceNtd = resolveSessionPriceNtd(pricingSnap.data());
    const snap = await tx.get(customerRef);
    const walletBalanceRaw = snap.exists ? snap.get("walletBalance") : 0;
    const sessionCreditsRaw = snap.exists ? snap.get("sessionCredits") : 0;
    const wheelPointsRaw = snap.exists ? snap.get("wheelPoints") : 0;
    const drawChancesRaw = snap.exists ? snap.get("drawChances") : 0;
    const arcadePointsRaw = snap.exists ? snap.get("arcadePoints") : 0;

    let walletBalance = typeof walletBalanceRaw === "number" ? walletBalanceRaw : 0;
    let sessionCredits = typeof sessionCreditsRaw === "number" ? sessionCreditsRaw : 0;
    let wheelPoints = typeof wheelPointsRaw === "number" ? wheelPointsRaw : 0;
    const drawChances = typeof drawChancesRaw === "number" ? drawChancesRaw : 0;
    let arcadePoints = typeof arcadePointsRaw === "number" ? arcadePointsRaw : 0;

    const folded = foldWalletBalanceIntoSessions(walletBalance, sessionCredits, sessionPriceNtd);
    walletBalance = folded.walletBalance;
    sessionCredits = folded.sessionCredits;

    const next = arcadePoints + delta;
    if (next < 0) {
      throw new HttpsError(
        "failed-precondition",
        st(locale, "lm.arcadeHiloUnderflow", "遊戲點不足，無法完成比大小結算。"),
      );
    }
    arcadePoints = Math.min(999_999, next);

    tx.set(
      customerRef,
      {
        walletBalance,
        sessionCredits,
        wheelPoints,
        drawChances,
        arcadePoints,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    tx.set(walletTxRef, {
      customerId: uid,
      type: "arcade_lm_hilo",
      amount: 0,
      note: `小瑪莉比大小：stake=${stake} roll=${roll} high=${guessHigh} hit=${hit}`,
      operatorId: uid,
      createdAt: FieldValue.serverTimestamp(),
    });

    return { roll, isHigh, hit, arcadePoints };
  });

  return out;
});

/** 會員：1 次預約次數 → 遊戲點（門檻見 siteSettings/pricing.arcadePointsPerMassage，預設 100） */
export const exchangeSessionForArcadePoints = onCall(publicCall, async (request) => {
  const locale = parseLocale(request.data);
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", st(locale, "auth.needLogin", "請先登入"));
  }
  await assertMemberEmailVerified(uid, locale);

  const db = getFirestore();
  const customerRef = db.collection("customers").doc(uid);
  const walletTxRef = db.collection("walletTransactions").doc();

  const out = await db.runTransaction(async (tx) => {
    const pricingSnap = await tx.get(db.collection("siteSettings").doc("pricing"));
    const sessionPriceNtd = resolveSessionPriceNtd(pricingSnap.data());
    const per = resolveArcadePointsPerMassage(pricingSnap.data());
    const snap = await tx.get(customerRef);
    const walletBalanceRaw = snap.exists ? snap.get("walletBalance") : 0;
    const sessionCreditsRaw = snap.exists ? snap.get("sessionCredits") : 0;
    const wheelPointsRaw = snap.exists ? snap.get("wheelPoints") : 0;
    const drawChancesRaw = snap.exists ? snap.get("drawChances") : 0;
    const arcadePointsRaw = snap.exists ? snap.get("arcadePoints") : 0;

    let walletBalance = typeof walletBalanceRaw === "number" ? walletBalanceRaw : 0;
    let sessionCredits = typeof sessionCreditsRaw === "number" ? sessionCreditsRaw : 0;
    let wheelPoints = typeof wheelPointsRaw === "number" ? wheelPointsRaw : 0;
    const drawChances = typeof drawChancesRaw === "number" ? drawChancesRaw : 0;
    let arcadePoints = typeof arcadePointsRaw === "number" ? arcadePointsRaw : 0;

    const folded = foldWalletBalanceIntoSessions(walletBalance, sessionCredits, sessionPriceNtd);
    walletBalance = folded.walletBalance;
    sessionCredits = folded.sessionCredits;

    if (sessionCredits < 1) {
      throw new HttpsError(
        "failed-precondition",
        st(locale, "lm.noSessionToExchange", "可預約次數不足，無法兌換遊戲點。"),
      );
    }

    sessionCredits -= 1;
    arcadePoints = Math.min(999_999, arcadePoints + per);

    tx.set(
      customerRef,
      {
        walletBalance,
        sessionCredits,
        wheelPoints,
        drawChances,
        arcadePoints,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    tx.set(walletTxRef, {
      customerId: uid,
      type: "arcade_session_to_points",
      amount: 0,
      sessionsDelta: -1,
      note: `按摩次數兌遊戲點：-1 次 → +${per} 點`,
      operatorId: uid,
      createdAt: FieldValue.serverTimestamp(),
    });

    return { arcadePoints, sessionCredits, arcadePointsPerMassage: per };
  });

  return { ok: true as const, ...out };
});

/** 會員：遊戲點 → 1 次預約次數 */
export const redeemArcadePointsForSession = onCall(publicCall, async (request) => {
  const locale = parseLocale(request.data);
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", st(locale, "auth.needLogin", "請先登入"));
  }
  await assertMemberEmailVerified(uid, locale);

  const db = getFirestore();
  const customerRef = db.collection("customers").doc(uid);
  const walletTxRef = db.collection("walletTransactions").doc();

  const out = await db.runTransaction(async (tx) => {
    const pricingSnap = await tx.get(db.collection("siteSettings").doc("pricing"));
    const sessionPriceNtd = resolveSessionPriceNtd(pricingSnap.data());
    const per = resolveArcadePointsPerMassage(pricingSnap.data());
    const snap = await tx.get(customerRef);
    const walletBalanceRaw = snap.exists ? snap.get("walletBalance") : 0;
    const sessionCreditsRaw = snap.exists ? snap.get("sessionCredits") : 0;
    const wheelPointsRaw = snap.exists ? snap.get("wheelPoints") : 0;
    const drawChancesRaw = snap.exists ? snap.get("drawChances") : 0;
    const arcadePointsRaw = snap.exists ? snap.get("arcadePoints") : 0;

    let walletBalance = typeof walletBalanceRaw === "number" ? walletBalanceRaw : 0;
    let sessionCredits = typeof sessionCreditsRaw === "number" ? sessionCreditsRaw : 0;
    let wheelPoints = typeof wheelPointsRaw === "number" ? wheelPointsRaw : 0;
    const drawChances = typeof drawChancesRaw === "number" ? drawChancesRaw : 0;
    let arcadePoints = typeof arcadePointsRaw === "number" ? arcadePointsRaw : 0;

    const folded = foldWalletBalanceIntoSessions(walletBalance, sessionCredits, sessionPriceNtd);
    walletBalance = folded.walletBalance;
    sessionCredits = folded.sessionCredits;

    if (arcadePoints < per) {
      throw new HttpsError(
        "failed-precondition",
        st(locale, "lm.arcadeRedeemShort", "遊戲點不足，無法兌換按摩次數。"),
      );
    }

    arcadePoints -= per;
    sessionCredits += 1;

    tx.set(
      customerRef,
      {
        walletBalance,
        sessionCredits,
        wheelPoints,
        drawChances,
        arcadePoints,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    tx.set(walletTxRef, {
      customerId: uid,
      type: "arcade_points_to_session",
      amount: 0,
      sessionsDelta: 1,
      note: `遊戲點兌按摩次數：-${per} 點 → +1 次`,
      operatorId: uid,
      createdAt: FieldValue.serverTimestamp(),
    });

    return { arcadePoints, sessionCredits, arcadePointsPerMassage: per };
  });

  return { ok: true as const, ...out };
});
