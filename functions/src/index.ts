import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { defineSecret, defineString } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { DateTime } from "luxon";
import {
  buildBroadcastEmailHtml,
  isResendOnboardingFromAddress,
  sendBroadcastHtmlEmail,
  sendMemberBookingStatusChangedEmail,
  sendNewBookingEmailToOwner,
  type EmailLocale,
} from "./resendNotify";
import {
  ACTIVE_STATUSES,
  assertSlotAllowed,
  blockedReasonForSlot,
  isWeekday,
  listBlockedStartSlotsForDate,
  mondayOfWeek,
  parseBookingBlockWindows,
  parseDateKey,
  resolveBookingCaps,
  TIMEZONE,
} from "./bookingLogic";
import { foldWalletBalanceIntoSessions, resolvePointsPerMassage, resolveSessionPriceNtd } from "./pricing";
import { parseLocale, st, type ServerLocale } from "./serverI18n";

initializeApp();
const db = getFirestore();

const region = "asia-east1";
/** 允許未登入呼叫（預約與查詢空檔） */
const publicCall = { region, invoker: "public" as const };

const resendApiKey = defineSecret("RESEND_API_KEY");
const ownerNotifyEmail = defineSecret("OWNER_NOTIFY_EMAIL");
const resendFrom = defineString("RESEND_FROM", {
  default: "Massage預約 <onboarding@resend.dev>",
});

type CreateBookingInput = {
  displayName?: unknown;
  note?: unknown;
  dateKey?: unknown;
  startSlot?: unknown;
  bookingMode?: unknown;
};

type BookingStatus = "pending" | "confirmed" | "done" | "cancelled" | "deleted";
type PrizeType = "points" | "chance" | "thanks" | "penalty_text";

async function assertAdminByUid(uid: string, locale: ServerLocale): Promise<void> {
  const adminSnap = await db.collection("admins").doc(uid).get();
  if (!adminSnap.exists) {
    throw new HttpsError("permission-denied", st(locale, "admin.only", "僅限管理員操作"));
  }
}

/** 會員儲值／預約／抽獎等需已驗證 Email（後台建立帳號可設為已驗證） */
async function assertMemberEmailVerified(uid: string, locale: ServerLocale): Promise<void> {
  const record = await getAuth().getUser(uid);
  if (!record.emailVerified) {
    throw new HttpsError(
      "failed-precondition",
      st(locale, "member.verifyEmailFirst", "請先至信箱完成 Email 驗證後再使用會員功能。"),
    );
  }
}

/** 後台儲值：可填 UID，或填會員 Email（含 @ 時改查 Auth） */
async function resolveCustomerUidForTopup(raw: string, locale: ServerLocale): Promise<string> {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new HttpsError("invalid-argument", st(locale, "topup.needId", "請填入會員識別（Email 或 UID）"));
  }
  if (trimmed.includes("@")) {
    try {
      const userRecord = await getAuth().getUserByEmail(trimmed);
      return userRecord.uid;
    } catch {
      throw new HttpsError("not-found", st(locale, "topup.emailNotFound", "找不到此 Email 的會員帳號"));
    }
  }
  return trimmed;
}

function asPositiveInteger(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const n = Math.trunc(v);
  if (n <= 0 || n !== v) return null;
  return n;
}

/** 管理員調整可預約次數：非零整數，絕對值上限與贈送抽獎次數一致 */
function asNonZeroSessionAdjustDelta(v: unknown, maxAbs: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const n = Math.trunc(v);
  if (n === 0 || n !== v) return null;
  if (Math.abs(n) > maxAbs) return null;
  return n;
}

function asNonNegativeInteger(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  const n = Math.trunc(v);
  return n >= 0 ? n : 0;
}

function pickWeighted<T extends { weight: number }>(items: T[]): T {
  const total = items.reduce((acc, x) => acc + x.weight, 0);
  let cursor = Math.random() * total;
  for (const item of items) {
    cursor -= item.weight;
    if (cursor <= 0) return item;
  }
  return items[items.length - 1];
}

type WheelPrizeRow = { id: string; name: string; type: PrizeType; value: number; weight: number };

async function loadActiveWheelPrizes(): Promise<WheelPrizeRow[]> {
  const prizeSnap = await db.collection("wheelPrizes").where("active", "==", true).get();
  const prizes = prizeSnap.docs
    .map((d) => {
      const data = d.data();
      const weightRaw = data.weight;
      const weight = typeof weightRaw === "number" ? weightRaw : 0;
      const type = data.type as PrizeType | undefined;
      const name = typeof data.name === "string" ? data.name : "";
      const value = asNonNegativeInteger(data.value);
      if (!name || !type || !["points", "chance", "thanks", "penalty_text"].includes(type) || weight <= 0) {
        return null;
      }
      return {
        id: d.id,
        name,
        type,
        value,
        weight,
      };
    })
    .filter((x): x is WheelPrizeRow => Boolean(x));
  prizes.sort((a, b) => a.id.localeCompare(b.id));
  return prizes;
}

export const getAvailability = onCall(publicCall, async (request) => {
  const locale = parseLocale(request.data);
  const dateKey = request.data?.dateKey;
  if (typeof dateKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new HttpsError("invalid-argument", st(locale, "avail.badDateKey", "dateKey 需為 YYYY-MM-DD"));
  }
  let day: DateTime;
  try {
    day = parseDateKey(dateKey);
  } catch {
    throw new HttpsError("invalid-argument", st(locale, "avail.invalidDate", "日期無效"));
  }
  const todayZ = DateTime.now().setZone(TIMEZONE).startOf("day");
  const latestBookable = mondayOfWeek(todayZ).plus({ days: 13 });
  if (day > latestBookable) {
    throw new HttpsError(
      "invalid-argument",
      st(locale, "avail.beyondWindow", "僅能查詢至下週日為止的日期"),
    );
  }
  if (!isWeekday(day)) {
    throw new HttpsError("invalid-argument", st(locale, "avail.weekdaysOnly", "僅能查詢週一到週五"));
  }

  const weekStart = mondayOfWeek(day).toISODate()!;

  const [daySnap, weekSnap, blocksSnap, capsSnap] = await Promise.all([
    db
      .collection("bookings")
      .where("dateKey", "==", dateKey)
      .where("status", "in", [...ACTIVE_STATUSES])
      .get(),
    db
      .collection("bookings")
      .where("weekStart", "==", weekStart)
      .where("status", "in", [...ACTIVE_STATUSES])
      .get(),
    db.collection("siteSettings").doc("bookingBlocks").get(),
    db.collection("siteSettings").doc("bookingCaps").get(),
  ]);

  const caps = resolveBookingCaps(capsSnap.data());
  const taken = daySnap.docs.map((d) => d.get("startSlot") as string).filter(Boolean);
  const blockWindows = parseBookingBlockWindows(blocksSnap.data());
  const blockedSlots = listBlockedStartSlotsForDate(dateKey, blockWindows);
  return {
    taken,
    blockedSlots,
    dayCount: daySnap.size,
    weekCount: weekSnap.size,
    dayCap: caps.maxPerDay,
    weekCap: caps.maxPerWorkWeek,
  };
});

/**
 * 網站訪次統計（台北日曆日／週一至週日為一週）：以 Firestore 交易累加。
 * 前端應每個瀏覽器分頁工作階段最多呼叫一次，避免重新整理重複計次。
 */
export const recordSiteVisit = onCall(publicCall, async () => {
  const ref = db.collection("siteStats").doc("visitorCounters");
  return db.runTransaction(async (trx) => {
    const snap = await trx.get(ref);
    const todayStart = DateTime.now().setZone(TIMEZONE).startOf("day");
    const todayKey = todayStart.toISODate()!;
    const weekStartKey = mondayOfWeek(todayStart).toISODate()!;

    const data = snap.exists ? (snap.data() as Record<string, unknown>) : {};
    let storedDayKey = typeof data.dayKey === "string" ? data.dayKey : "";
    let dayVisits = asNonNegativeInteger(data.dayVisits);
    let storedWeekStart = typeof data.weekStartKey === "string" ? data.weekStartKey : "";
    let weekVisits = asNonNegativeInteger(data.weekVisits);
    let totalVisits = asNonNegativeInteger(data.totalVisits);

    if (storedDayKey !== todayKey) {
      storedDayKey = todayKey;
      dayVisits = 0;
    }
    if (storedWeekStart !== weekStartKey) {
      storedWeekStart = weekStartKey;
      weekVisits = 0;
    }

    dayVisits += 1;
    weekVisits += 1;
    totalVisits += 1;

    trx.set(
      ref,
      {
        dayKey: todayKey,
        dayVisits,
        weekStartKey,
        weekVisits,
        totalVisits,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return {
      yourVisitNumberToday: dayVisits,
      dayVisits,
      weekVisits,
      totalVisits,
    };
  });
});

export const createBooking = onCall(
  { ...publicCall, secrets: [resendApiKey, ownerNotifyEmail] },
  async (request) => {
  const data = request.data as CreateBookingInput;
  const locale = parseLocale(data);
  const displayName = typeof data.displayName === "string" ? data.displayName.trim() : "";
  const note = typeof data.note === "string" ? data.note.trim() : "";
  const dateKey = typeof data.dateKey === "string" ? data.dateKey : "";
  const startSlot = typeof data.startSlot === "string" ? data.startSlot : "";
  const bookingModeRaw = typeof data.bookingMode === "string" ? data.bookingMode.trim() : "";
  const bookingMode =
    bookingModeRaw === "guest_cash" ||
    bookingModeRaw === "guest_beverage" ||
    bookingModeRaw === "member_cash" ||
    bookingModeRaw === "member_wallet" ||
    bookingModeRaw === "member_beverage"
      ? bookingModeRaw
      : "";
  const uid = request.auth?.uid;
  if (!bookingMode) {
    throw new HttpsError("invalid-argument", st(locale, "booking.pickPayment", "請選擇付款方式"));
  }
  const isGuestMode = bookingMode === "guest_cash" || bookingMode === "guest_beverage";
  if (!isGuestMode && !uid) {
    throw new HttpsError("unauthenticated", st(locale, "booking.memberNeedLogin", "會員付款模式需先登入"));
  }
  if (!isGuestMode && uid) {
    await assertMemberEmailVerified(uid, locale);
  }

  if (!displayName || displayName.length > 80) {
    throw new HttpsError("invalid-argument", st(locale, "booking.nameRequired", "請填寫姓名（最多 80 字）"));
  }
  if (note.length > 500) {
    throw new HttpsError("invalid-argument", st(locale, "booking.noteTooLong", "備註過長"));
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new HttpsError("invalid-argument", st(locale, "booking.badDateFormat", "日期格式錯誤"));
  }

  let startLocal: DateTime;
  try {
    startLocal = assertSlotAllowed(dateKey, startSlot);
  } catch (e) {
    const code = e instanceof Error ? e.message : "bad_request";
    const map: Record<string, string> = {
      invalid_dateKey: st(locale, "slot.invalid_dateKey", "日期無效"),
      past_date: st(locale, "slot.past_date", "無法預約過去的日期"),
      past_slot: st(locale, "slot.past_slot", "此開始時間已過，請選擇較晚的時段"),
      beyond_booking_window: st(locale, "slot.beyond_booking_window", "僅能預約至下週日為止。"),
      not_weekday: st(locale, "slot.not_weekday", "僅能預約週一到週五"),
      invalid_slot: st(locale, "slot.invalid_slot", "開始時間不在可預約範圍"),
      ends_after_daily_close: st(
        locale,
        "slot.ends_after_daily_close",
        "此開始時間將超過當日服務結束時間（17:00）",
      ),
    };
    throw new HttpsError("failed-precondition", map[code] ?? st(locale, "slot.generic", "無法預約"));
  }

  const blocksSnap = await db.collection("siteSettings").doc("bookingBlocks").get();
  const blockReason = blockedReasonForSlot(dateKey, startSlot, parseBookingBlockWindows(blocksSnap.data()));
  const closedZh = "此時段不開放預約";
  if (blockReason) {
    const prefix = st(locale, "booking.blockedPrefix", "此時段不開放預約：");
    const generic = st(locale, "booking.blockedGeneric", closedZh);
    throw new HttpsError("failed-precondition", blockReason === closedZh ? generic : `${prefix}${blockReason}`);
  }

  const weekStart = mondayOfWeek(parseDateKey(dateKey)).toISODate()!;
  const startAt = Timestamp.fromDate(startLocal.toJSDate());

  const bookingRef = db.collection("bookings").doc();

  try {
    await db.runTransaction(async (tx) => {
      const pricingSnap = await tx.get(db.collection("siteSettings").doc("pricing"));
      const sessionPriceNtd = resolveSessionPriceNtd(pricingSnap.data());
      const capsRef = db.collection("siteSettings").doc("bookingCaps");
      const dayQ = db
        .collection("bookings")
        .where("dateKey", "==", dateKey)
        .where("status", "in", [...ACTIVE_STATUSES]);
      const weekQ = db
        .collection("bookings")
        .where("weekStart", "==", weekStart)
        .where("status", "in", [...ACTIVE_STATUSES]);

      const [daySnap, weekSnap, capsSnap] = await Promise.all([tx.get(dayQ), tx.get(weekQ), tx.get(capsRef)]);
      const { maxPerDay, maxPerWorkWeek } = resolveBookingCaps(capsSnap.data());

      if (daySnap.size >= maxPerDay) {
        throw new HttpsError(
          "resource-exhausted",
          st(locale, "booking.dayFull", "這一天已額滿（最多 {{max}} 筆）", { max: maxPerDay }),
        );
      }
      if (weekSnap.size >= maxPerWorkWeek) {
        throw new HttpsError(
          "resource-exhausted",
          st(locale, "booking.weekFull", "本工作週已達上限（最多 {{max}} 筆）", { max: maxPerWorkWeek }),
        );
      }

      const sameSlot = daySnap.docs.find((d) => d.get("startSlot") === startSlot);
      if (sameSlot) {
        throw new HttpsError("already-exists", st(locale, "booking.slotTaken", "此時段已被預約"));
      }

      let customerId: string | null = null;
      let walletDeducted = 0;
      let paidCash = 0;
      let sessionCreditsDeducted = 0;
      if (bookingMode === "guest_cash") {
        paidCash = sessionPriceNtd;
      } else if (bookingMode === "guest_beverage") {
        // 訪客以飲料折抵：不綁 customerId、不扣款
      } else if (bookingMode === "member_cash") {
        customerId = uid!;
        paidCash = sessionPriceNtd;
      } else if (bookingMode === "member_beverage") {
        customerId = uid!;
      } else {
        customerId = uid!;
        const customerRef = db.collection("customers").doc(uid!);
        const customerSnap = await tx.get(customerRef);
        const walletBalanceRaw = customerSnap.exists ? customerSnap.get("walletBalance") : 0;
        const sessionCreditsRaw = customerSnap.exists ? customerSnap.get("sessionCredits") : 0;
        const drawChancesRaw = customerSnap.exists ? customerSnap.get("drawChances") : 0;
        const wheelPointsRaw = customerSnap.exists ? customerSnap.get("wheelPoints") : 0;
        let walletBalance = typeof walletBalanceRaw === "number" ? walletBalanceRaw : 0;
        let sessionCredits = typeof sessionCreditsRaw === "number" ? sessionCreditsRaw : 0;
        const drawChances = typeof drawChancesRaw === "number" ? drawChancesRaw : 0;
        const wheelPoints = typeof wheelPointsRaw === "number" ? wheelPointsRaw : 0;
        const folded = foldWalletBalanceIntoSessions(walletBalance, sessionCredits, sessionPriceNtd);
        walletBalance = folded.walletBalance;
        sessionCredits = folded.sessionCredits;
        if (sessionCredits < 1) {
          throw new HttpsError(
            "resource-exhausted",
            st(locale, "booking.sessionShort", "預約次數不足，請改用現金、飲料折抵或先儲值次數。"),
          );
        }
        sessionCredits -= 1;
        sessionCreditsDeducted = 1;
        tx.set(
          customerRef,
          {
            walletBalance,
            sessionCredits,
            drawChances,
            wheelPoints,
            updatedAt: FieldValueOrServerTimestamp(),
          },
          { merge: true },
        );
        const txRef = db.collection("walletTransactions").doc();
        tx.set(txRef, {
          customerId,
          bookingId: bookingRef.id,
          type: "session_charge",
          amount: 0,
          sessionsDelta: -1,
          sessionPriceSnapshot: sessionPriceNtd,
          note: `預約扣次數 1 次（現場單價參考 ${sessionPriceNtd} 元）`,
          operatorId: uid!,
          createdAt: FieldValueOrServerTimestamp(),
        });
      }

      tx.set(bookingRef, {
        displayName,
        note,
        dateKey,
        startSlot,
        weekStart,
        startAt,
        bookingMode,
        customerId,
        price: sessionPriceNtd,
        walletDeducted,
        paidCash,
        sessionCreditsDeducted,
        drawGranted: false,
        status: "pending",
        notificationLocale: locale === "en" ? "en" : "zh-Hant",
        createdAt: FieldValueOrServerTimestamp(),
        updatedAt: FieldValueOrServerTimestamp(),
      });
    });
  } catch (e) {
    if (e instanceof HttpsError) {
      throw e;
    }
    console.error(e);
    throw new HttpsError("internal", st(locale, "booking.createFailed", "預約失敗，請稍後再試"));
  }

  const key = resendApiKey.value().trim();
  const ownerTo = ownerNotifyEmail.value().trim();
  const from = resendFrom.value().trim() || "Massage預約 <onboarding@resend.dev>";
  if (key && ownerTo) {
    const memberUid =
      bookingMode === "guest_cash" || bookingMode === "guest_beverage" ? null : uid ?? null;
    void sendNewBookingEmailToOwner({
      apiKey: key,
      from,
      to: ownerTo,
      locale,
      payload: {
        id: bookingRef.id,
        displayName,
        dateKey,
        startSlot,
        note,
        bookingMode,
        memberUid,
      },
    }).catch((err) => console.error("notify owner email failed", err));
  }

  return { id: bookingRef.id };
  },
);

export const getMyWallet = onCall(publicCall, async (request) => {
  const locale = parseLocale(request.data);
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", st(locale, "auth.needLogin", "請先登入"));
  }
  await assertMemberEmailVerified(uid, locale);
  const customerRef = db.collection("customers").doc(uid);
  const out = await db.runTransaction(async (tx) => {
    const pricingSnap = await tx.get(db.collection("siteSettings").doc("pricing"));
    const sessionPriceNtd = resolveSessionPriceNtd(pricingSnap.data());
    const pointsPerMassage = resolvePointsPerMassage(pricingSnap.data());
    const snap = await tx.get(customerRef);
    const walletBalanceRaw = snap.exists ? snap.get("walletBalance") : 0;
    const drawChancesRaw = snap.exists ? snap.get("drawChances") : 0;
    const nicknameRaw = snap.exists ? snap.get("nickname") : "";
    const sessionCreditsRaw = snap.exists ? snap.get("sessionCredits") : 0;
    const wheelPointsRaw = snap.exists ? snap.get("wheelPoints") : 0;
    const nickname = typeof nicknameRaw === "string" ? nicknameRaw.trim() : "";
    let walletBalance = typeof walletBalanceRaw === "number" ? walletBalanceRaw : 0;
    let sessionCredits = typeof sessionCreditsRaw === "number" ? sessionCreditsRaw : 0;
    const wheelPoints = typeof wheelPointsRaw === "number" ? wheelPointsRaw : 0;
    const drawChances = typeof drawChancesRaw === "number" ? drawChancesRaw : 0;
    const folded = foldWalletBalanceIntoSessions(walletBalance, sessionCredits, sessionPriceNtd);
    if (folded.walletBalance !== walletBalance || folded.sessionCredits !== sessionCredits) {
      walletBalance = folded.walletBalance;
      sessionCredits = folded.sessionCredits;
      tx.set(
        customerRef,
        {
          walletBalance,
          sessionCredits,
          drawChances,
          wheelPoints,
          updatedAt: FieldValueOrServerTimestamp(),
        },
        { merge: true },
      );
    }
    return {
      walletBalance,
      sessionCredits,
      wheelPoints,
      drawChances,
      nickname,
      sessionPriceNtd,
      pointsPerMassage,
    };
  });
  return out;
});

/** 前台／訪客：讀取現場單次金額與點數兌換門檻（無需登入） */
export const getBookingPricing = onCall(publicCall, async (request) => {
  parseLocale(request.data);
  const snap = await db.collection("siteSettings").doc("pricing").get();
  return {
    sessionPriceNtd: resolveSessionPriceNtd(snap.data()),
    pointsPerMassage: resolvePointsPerMassage(snap.data()),
  };
});

/** 會員：輪盤點數滿門檻時手動兌換為 1 次預約次數 */
export const redeemWheelPoints = onCall(publicCall, async (request) => {
  const locale = parseLocale(request.data);
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", st(locale, "auth.needLogin", "請先登入"));
  }
  await assertMemberEmailVerified(uid, locale);

  const customerRef = db.collection("customers").doc(uid);
  const walletTxRef = db.collection("walletTransactions").doc();

  const result = await db.runTransaction(async (tx) => {
    const pricingSnap = await tx.get(db.collection("siteSettings").doc("pricing"));
    const sessionPriceNtd = resolveSessionPriceNtd(pricingSnap.data());
    const pointsPerMassage = resolvePointsPerMassage(pricingSnap.data());
    const snap = await tx.get(customerRef);
    const walletBalanceRaw = snap.exists ? snap.get("walletBalance") : 0;
    const sessionCreditsRaw = snap.exists ? snap.get("sessionCredits") : 0;
    const wheelPointsRaw = snap.exists ? snap.get("wheelPoints") : 0;
    const drawChancesRaw = snap.exists ? snap.get("drawChances") : 0;
    let walletBalance = typeof walletBalanceRaw === "number" ? walletBalanceRaw : 0;
    let sessionCredits = typeof sessionCreditsRaw === "number" ? sessionCreditsRaw : 0;
    let wheelPoints = typeof wheelPointsRaw === "number" ? wheelPointsRaw : 0;
    const drawChances = typeof drawChancesRaw === "number" ? drawChancesRaw : 0;
    const folded = foldWalletBalanceIntoSessions(walletBalance, sessionCredits, sessionPriceNtd);
    walletBalance = folded.walletBalance;
    sessionCredits = folded.sessionCredits;
    if (wheelPoints < pointsPerMassage) {
      throw new HttpsError(
        "failed-precondition",
        st(locale, "redeem.pointsShort", "點數不足，無法兌換。"),
      );
    }
    wheelPoints -= pointsPerMassage;
    sessionCredits += 1;
    tx.set(
      customerRef,
      {
        walletBalance,
        sessionCredits,
        wheelPoints,
        drawChances,
        updatedAt: FieldValueOrServerTimestamp(),
      },
      { merge: true },
    );
    tx.set(walletTxRef, {
      customerId: uid,
      type: "points_redeem",
      amount: 0,
      pointsDelta: -pointsPerMassage,
      sessionsDelta: 1,
      note: `點數兌換：-${pointsPerMassage} 點 → +1 次`,
      operatorId: uid,
      createdAt: FieldValueOrServerTimestamp(),
    });
    return { wheelPoints, sessionCredits, pointsPerMassage };
  });

  return { ok: true as const, ...result };
});

/**
 * 管理員：依 `siteSettings/pricing` 的單價，對 `customers` 全集合套用與 `getMyWallet` 相同的折換
 *（未滿一次的金額留在 walletBalance）。大量文件時以 batch 分段提交。
 */
export const migrateLegacyWalletsAdmin = onCall(publicCall, async (request) => {
  const locale = parseLocale(request.data);
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", st(locale, "auth.needLogin", "請先登入"));
  }
  await assertAdminByUid(uid, locale);

  const pricingSnap = await db.collection("siteSettings").doc("pricing").get();
  const sessionPriceNtd = resolveSessionPriceNtd(pricingSnap.data());

  const snaps = await db.collection("customers").get();
  let scanned = 0;
  let updated = 0;
  const maxBatch = 450;
  let batch = db.batch();
  let inBatch = 0;

  for (const doc of snaps.docs) {
    scanned++;
    const d = doc.data() as Record<string, unknown>;
    const wb0 = typeof d.walletBalance === "number" ? d.walletBalance : 0;
    const sc0 = typeof d.sessionCredits === "number" ? d.sessionCredits : 0;
    const folded = foldWalletBalanceIntoSessions(wb0, sc0, sessionPriceNtd);
    if (folded.walletBalance === wb0 && folded.sessionCredits === sc0) continue;
    updated++;
    batch.set(
      doc.ref,
      {
        walletBalance: folded.walletBalance,
        sessionCredits: folded.sessionCredits,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    inBatch++;
    if (inBatch >= maxBatch) {
      await batch.commit();
      batch = db.batch();
      inBatch = 0;
    }
  }
  if (inBatch > 0) {
    await batch.commit();
  }

  return {
    ok: true as const,
    scanned,
    updated,
    sessionPriceNtd,
  };
});

export const topupWallet = onCall(publicCall, async (request) => {
  const locale = parseLocale(request.data);
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", st(locale, "auth.needLogin", "請先登入"));
  }
  await assertAdminByUid(uid, locale);

  const customerIdRaw = typeof request.data?.customerId === "string" ? request.data.customerId.trim() : "";
  const note = typeof request.data?.note === "string" ? request.data.note.trim() : "";
  const amount = asPositiveInteger(request.data?.amount);
  const sessions = asPositiveInteger(request.data?.sessions);
  if (!amount) {
    throw new HttpsError("invalid-argument", st(locale, "topup.amountPositive", "儲值金額需為正整數"));
  }
  if (!sessions) {
    throw new HttpsError("invalid-argument", st(locale, "topup.sessionsPositive", "儲值次數需為正整數"));
  }

  const customerId = await resolveCustomerUidForTopup(customerIdRaw, locale);

  const customerRef = db.collection("customers").doc(customerId);
  const walletTxRef = db.collection("walletTransactions").doc();
  await db.runTransaction(async (tx) => {
    const customerSnap = await tx.get(customerRef);
    const walletBalanceRaw = customerSnap.exists ? customerSnap.get("walletBalance") : 0;
    const drawChancesRaw = customerSnap.exists ? customerSnap.get("drawChances") : 0;
    const sessionCreditsRaw = customerSnap.exists ? customerSnap.get("sessionCredits") : 0;
    const wheelPointsRaw = customerSnap.exists ? customerSnap.get("wheelPoints") : 0;
    const nextSessions = (typeof sessionCreditsRaw === "number" ? sessionCreditsRaw : 0) + sessions;
    const drawChances = typeof drawChancesRaw === "number" ? drawChancesRaw : 0;
    const wheelPoints = typeof wheelPointsRaw === "number" ? wheelPointsRaw : 0;
    tx.set(
      customerRef,
      {
        walletBalance: typeof walletBalanceRaw === "number" ? walletBalanceRaw : 0,
        sessionCredits: nextSessions,
        drawChances,
        wheelPoints,
        updatedAt: FieldValueOrServerTimestamp(),
      },
      { merge: true },
    );
    tx.set(walletTxRef, {
      customerId,
      type: "topup",
      amount,
      sessionsDelta: sessions,
      note: note || `後台儲值：${sessions} 次（金額 ${amount} 元）`,
      operatorId: uid,
      createdAt: FieldValueOrServerTimestamp(),
    });
  });

  return { ok: true };
});

const MAX_ADMIN_SESSION_ADJUST = 50;
const ADMIN_SESSION_NOTE_MIN = 3;
const ADMIN_SESSION_NOTE_MAX = 500;

/**
 * 管理員：調整會員「可預約次數」（可增可減）。先依定價折疊 walletBalance→sessionCredits，再套用增減；
 * 寫入 walletTransactions（type: admin_session_adjust）供稽核。
 */
export const adjustSessionCreditsAdmin = onCall(publicCall, async (request) => {
  const locale = parseLocale(request.data);
  const operatorUid = request.auth?.uid;
  if (!operatorUid) {
    throw new HttpsError("unauthenticated", st(locale, "auth.needLogin", "請先登入"));
  }
  await assertAdminByUid(operatorUid, locale);

  const customerIdRaw = typeof request.data?.customerId === "string" ? request.data.customerId.trim() : "";
  const noteRaw = typeof request.data?.note === "string" ? request.data.note.trim() : "";
  const deltaCandidate = request.data?.sessionsDelta ?? request.data?.delta;
  const sessionsDelta = asNonZeroSessionAdjustDelta(deltaCandidate, MAX_ADMIN_SESSION_ADJUST);

  if (!customerIdRaw) {
    throw new HttpsError("invalid-argument", st(locale, "topup.needId", "請填入會員識別（Email 或 UID）"));
  }
  if (!sessionsDelta) {
    throw new HttpsError(
      "invalid-argument",
      st(
        locale,
        "adjustSessions.deltaRange",
        "調整次數須為非零整數，且絕對值不可超過 {{max}}。",
        { max: MAX_ADMIN_SESSION_ADJUST },
      ),
    );
  }
  if (noteRaw.length < ADMIN_SESSION_NOTE_MIN) {
    throw new HttpsError(
      "invalid-argument",
      st(locale, "adjustSessions.noteTooShort", "備註至少 {{min}} 字，請簡述原因以利稽核。", { min: ADMIN_SESSION_NOTE_MIN }),
    );
  }
  if (noteRaw.length > ADMIN_SESSION_NOTE_MAX) {
    throw new HttpsError(
      "invalid-argument",
      st(locale, "adjustSessions.noteTooLong", "備註不可超過 {{max}} 字。", { max: ADMIN_SESSION_NOTE_MAX }),
    );
  }

  const customerId = await resolveCustomerUidForTopup(customerIdRaw, locale);
  const customerRef = db.collection("customers").doc(customerId);
  const walletTxRef = db.collection("walletTransactions").doc();
  const pricingRef = db.collection("siteSettings").doc("pricing");

  let nextSessionCredits = 0;
  await db.runTransaction(async (tx) => {
    const [pricingSnap, customerSnap] = await Promise.all([tx.get(pricingRef), tx.get(customerRef)]);
    const sessionPriceNtd = resolveSessionPriceNtd(pricingSnap.data());

    const walletBalanceRaw = customerSnap.exists ? customerSnap.get("walletBalance") : 0;
    const sessionCreditsRaw = customerSnap.exists ? customerSnap.get("sessionCredits") : 0;
    const drawChancesRaw = customerSnap.exists ? customerSnap.get("drawChances") : 0;
    const wheelPointsRaw = customerSnap.exists ? customerSnap.get("wheelPoints") : 0;

    let walletBalance = typeof walletBalanceRaw === "number" ? walletBalanceRaw : 0;
    let sessionCredits = typeof sessionCreditsRaw === "number" ? sessionCreditsRaw : 0;
    const drawChances = typeof drawChancesRaw === "number" ? drawChancesRaw : 0;
    const wheelPoints = typeof wheelPointsRaw === "number" ? wheelPointsRaw : 0;

    const folded = foldWalletBalanceIntoSessions(walletBalance, sessionCredits, sessionPriceNtd);
    walletBalance = folded.walletBalance;
    sessionCredits = folded.sessionCredits;

    const proposed = sessionCredits + sessionsDelta;
    if (proposed < 0) {
      throw new HttpsError(
        "failed-precondition",
        st(
          locale,
          "adjustSessions.insufficient",
          "調整後可預約次數不可為負。目前可扣次數為 {{have}}，本次變更為 {{delta}}。",
          { have: sessionCredits, delta: sessionsDelta },
        ),
      );
    }
    nextSessionCredits = proposed;

    tx.set(
      customerRef,
      {
        walletBalance,
        sessionCredits: nextSessionCredits,
        drawChances,
        wheelPoints,
        updatedAt: FieldValueOrServerTimestamp(),
      },
      { merge: true },
    );

    tx.set(walletTxRef, {
      customerId,
      type: "admin_session_adjust",
      amount: 0,
      sessionsDelta,
      sessionPriceSnapshot: sessionPriceNtd,
      note: noteRaw,
      operatorId: operatorUid,
      createdAt: FieldValueOrServerTimestamp(),
    });
  });

  return { ok: true as const, sessionCredits: nextSessionCredits };
});

const MAX_ADMIN_DRAW_GRANT = 50;

/** 管理員：贈送輪盤「可抽次數」（寫入 walletTransactions 稽核） */
export const grantDrawChancesAdmin = onCall(publicCall, async (request) => {
  const locale = parseLocale(request.data);
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", st(locale, "auth.needLogin", "請先登入"));
  }
  await assertAdminByUid(uid, locale);

  const customerIdRaw = typeof request.data?.customerId === "string" ? request.data.customerId.trim() : "";
  const noteRaw = typeof request.data?.note === "string" ? request.data.note.trim() : "";
  const deltaCandidate = request.data?.delta ?? request.data?.count;
  const delta = asPositiveInteger(deltaCandidate);
  if (!customerIdRaw) {
    throw new HttpsError("invalid-argument", st(locale, "topup.needId", "請填入會員識別（Email 或 UID）"));
  }
  if (!delta || delta > MAX_ADMIN_DRAW_GRANT) {
    throw new HttpsError(
      "invalid-argument",
      st(locale, "grantDraw.deltaRange", "贈送次數需為 1～{{max}} 的整數。", { max: MAX_ADMIN_DRAW_GRANT }),
    );
  }
  if (noteRaw.length > 200) {
    throw new HttpsError("invalid-argument", st(locale, "grantDraw.noteTooLong", "備註不可超過 200 字。"));
  }

  const customerId = await resolveCustomerUidForTopup(customerIdRaw, locale);
  const customerRef = db.collection("customers").doc(customerId);
  const walletTxRef = db.collection("walletTransactions").doc();

  let drawChancesTotal = 0;
  await db.runTransaction(async (tx) => {
    const customerSnap = await tx.get(customerRef);
    const walletBalanceRaw = customerSnap.exists ? customerSnap.get("walletBalance") : 0;
    const drawChancesRaw = customerSnap.exists ? customerSnap.get("drawChances") : 0;
    const sessionCreditsRaw = customerSnap.exists ? customerSnap.get("sessionCredits") : 0;
    const wheelPointsRaw = customerSnap.exists ? customerSnap.get("wheelPoints") : 0;
    const prevDraw = asNonNegativeInteger(drawChancesRaw);
    drawChancesTotal = prevDraw + delta;

    tx.set(
      customerRef,
      {
        walletBalance: typeof walletBalanceRaw === "number" ? walletBalanceRaw : 0,
        sessionCredits: typeof sessionCreditsRaw === "number" ? sessionCreditsRaw : 0,
        wheelPoints: typeof wheelPointsRaw === "number" ? wheelPointsRaw : 0,
        drawChances: drawChancesTotal,
        updatedAt: FieldValueOrServerTimestamp(),
      },
      { merge: true },
    );

    tx.set(walletTxRef, {
      customerId,
      type: "admin_grant_draw",
      amount: 0,
      drawChancesDelta: delta,
      note: noteRaw || st(locale, "grantDraw.defaultNote", "後台贈送輪盤抽獎次數"),
      operatorId: uid,
      createdAt: FieldValueOrServerTimestamp(),
    });
  });

  return { ok: true as const, drawChancesAdded: delta, drawChancesTotal };
});

export const getAdminStatus = onCall(publicCall, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    return { isAdmin: false };
  }
  const adminSnap = await db.collection("admins").doc(uid).get();
  return { isAdmin: adminSnap.exists };
});

export const createMemberAccount = onCall(publicCall, async (request) => {
  const locale = parseLocale(request.data);
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", st(locale, "auth.needLogin", "請先登入"));
  }
  await assertAdminByUid(uid, locale);

  const email = typeof request.data?.email === "string" ? request.data.email.trim() : "";
  const password = typeof request.data?.password === "string" ? request.data.password : "";
  const nickname =
    typeof request.data?.nickname === "string" ? request.data.nickname.trim().slice(0, 80) : "";
  if (!email) {
    throw new HttpsError("invalid-argument", st(locale, "member.emailRequired", "Email 必填"));
  }
  if (password.length < 6) {
    throw new HttpsError("invalid-argument", st(locale, "member.passwordMin", "密碼至少 6 碼"));
  }

  const auth = getAuth();
  try {
    const userRecord = await auth.createUser({
      email,
      password,
      displayName: nickname || undefined,
      // 後台建立視為已驗證，否則會員功能會被擋且客戶端未寄出驗證信
      emailVerified: true,
      disabled: false,
    });
    await db.collection("customers").doc(userRecord.uid).set(
      {
        walletBalance: 0,
        sessionCredits: 0,
        wheelPoints: 0,
        drawChances: 0,
        ...(nickname ? { nickname } : {}),
        createdAt: FieldValueOrServerTimestamp(),
        updatedAt: FieldValueOrServerTimestamp(),
      },
      { merge: true },
    );
    return { ok: true, uid: userRecord.uid };
  } catch (e) {
    console.error(e);
    throw new HttpsError("already-exists", st(locale, "member.createExists", "建立會員失敗：Email 可能已存在"));
  }
});

/** 後台依 Email 前綴搜尋會員（掃描 Auth 使用者列表，適合人數不多的場景） */
export const searchMemberUsers = onCall(publicCall, async (request) => {
  const locale = parseLocale(request.data);
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", st(locale, "auth.needLogin", "請先登入"));
  }
  await assertAdminByUid(uid, locale);

  const prefixRaw = typeof request.data?.prefix === "string" ? request.data.prefix.trim().toLowerCase() : "";
  if (prefixRaw.length < 2) {
    return { users: [] as { uid: string; email: string }[] };
  }

  const auth = getAuth();
  const matches: { uid: string; email: string }[] = [];
  let pageToken: string | undefined;
  const maxMatches = 15;
  const maxPages = 12;

  for (let page = 0; page < maxPages && matches.length < maxMatches; page++) {
    const res = await auth.listUsers(1000, pageToken);
    for (const u of res.users) {
      const email = u.email;
      if (!email) continue;
      if (email.toLowerCase().startsWith(prefixRaw)) {
        matches.push({ uid: u.uid, email });
        if (matches.length >= maxMatches) break;
      }
    }
    if (!res.pageToken || matches.length >= maxMatches) break;
    pageToken = res.pageToken;
  }

  return { users: matches };
});

type ListMembersAdminRow = {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  nickname: string;
  walletBalance: number;
  sessionCredits: number;
  wheelPoints: number;
  drawChances: number;
};

/** 後台：列出 Auth 內所有使用者並合併 Firestore `customers` 餘額與稱呼（適合人數不多的場景） */
export const listMembersAdmin = onCall(publicCall, async (request) => {
  const locale = parseLocale(request.data);
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", st(locale, "auth.needLogin", "請先登入"));
  }
  await assertAdminByUid(uid, locale);

  const auth = getAuth();
  const members: ListMembersAdminRow[] = [];
  let pageToken: string | undefined;
  const maxPages = 50;

  for (let p = 0; p < maxPages; p++) {
    const res = await auth.listUsers(1000, pageToken);
    const uids = res.users.map((u) => u.uid);
    const refs = uids.map((id) => db.collection("customers").doc(id));
    const snaps = refs.length > 0 ? await db.getAll(...refs) : [];
    const snapByUid = new Map(snaps.map((s) => [s.id, s]));

    for (const u of res.users) {
      const snap = snapByUid.get(u.uid);
      const d = snap?.exists ? (snap.data() as Record<string, unknown>) : {};
      members.push({
        uid: u.uid,
        email: u.email ?? null,
        emailVerified: u.emailVerified === true,
        nickname: typeof d.nickname === "string" ? d.nickname : "",
        walletBalance: typeof d.walletBalance === "number" ? d.walletBalance : 0,
        sessionCredits: typeof d.sessionCredits === "number" ? d.sessionCredits : 0,
        wheelPoints: typeof d.wheelPoints === "number" ? d.wheelPoints : 0,
        drawChances: typeof d.drawChances === "number" ? d.drawChances : 0,
      });
    }

    pageToken = res.pageToken;
    if (!pageToken) break;
  }

  members.sort((a, b) => (a.email ?? a.uid).localeCompare(b.email ?? b.uid, "zh-Hant"));
  return { members };
});

/** 後台：更新會員稱呼（Firestore `customers.nickname` + Auth displayName） */
export const updateMemberNicknameAdmin = onCall(publicCall, async (request) => {
  const locale = parseLocale(request.data);
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", st(locale, "auth.needLogin", "請先登入"));
  }
  await assertAdminByUid(uid, locale);

  const customerRaw = typeof request.data?.customerId === "string" ? request.data.customerId.trim() : "";
  const nicknameRaw = typeof request.data?.nickname === "string" ? request.data.nickname : "";
  if (!customerRaw) {
    throw new HttpsError(
      "invalid-argument",
      st(locale, "admin.customerIdRequired", "customerId 必填（會員 UID 或 Email）"),
    );
  }

  const targetUid = await resolveCustomerUidForTopup(customerRaw, locale);
  const nickname = nicknameRaw.trim().slice(0, 80);

  await db
    .collection("customers")
    .doc(targetUid)
    .set(
      {
        nickname,
        updatedAt: FieldValueOrServerTimestamp(),
      },
      { merge: true },
    );

  const auth = getAuth();
  try {
    await auth.updateUser(targetUid, {
      displayName: nickname.length > 0 ? nickname : null,
    });
  } catch (e) {
    console.warn("updateMemberNicknameAdmin: Auth displayName 更新失敗（可能已刪除帳號）", e);
  }

  return { ok: true };
});

export const completeBooking = onCall(publicCall, async (request) => {
  const locale = parseLocale(request.data);
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", st(locale, "auth.needLogin", "請先登入"));
  }
  await assertAdminByUid(uid, locale);

  const bookingId = typeof request.data?.bookingId === "string" ? request.data.bookingId.trim() : "";
  if (!bookingId) {
    throw new HttpsError("invalid-argument", st(locale, "booking.idRequired", "bookingId 必填"));
  }
  const bookingRef = db.collection("bookings").doc(bookingId);
  await db.runTransaction(async (tx) => {
    const bookingSnap = await tx.get(bookingRef);
    if (!bookingSnap.exists) {
      throw new HttpsError("not-found", st(locale, "booking.notFound", "找不到預約"));
    }
    const data = bookingSnap.data() as Record<string, unknown>;
    const status = (data.status as BookingStatus | undefined) ?? "pending";
    if (status === "done") {
      throw new HttpsError("failed-precondition", st(locale, "booking.alreadyDone", "此預約已完成"));
    }
    if (!["pending", "confirmed"].includes(status)) {
      throw new HttpsError("failed-precondition", st(locale, "booking.badStateComplete", "目前狀態不可完成"));
    }

    const customerId = typeof data.customerId === "string" ? data.customerId : null;
    const drawGranted = data.drawGranted === true;
    if (customerId && !drawGranted) {
      const customerRef = db.collection("customers").doc(customerId);
      const customerSnap = await tx.get(customerRef);
      const walletBalanceRaw = customerSnap.exists ? customerSnap.get("walletBalance") : 0;
      const drawChancesRaw = customerSnap.exists ? customerSnap.get("drawChances") : 0;
      tx.set(
        customerRef,
        {
          walletBalance: typeof walletBalanceRaw === "number" ? walletBalanceRaw : 0,
          drawChances: (typeof drawChancesRaw === "number" ? drawChancesRaw : 0) + 1,
          updatedAt: FieldValueOrServerTimestamp(),
        },
        { merge: true },
      );
      tx.update(bookingRef, {
        drawGranted: true,
      });
    }

    tx.update(bookingRef, {
      status: "done",
      updatedAt: FieldValueOrServerTimestamp(),
      completedAt: FieldValueOrServerTimestamp(),
      completedBy: uid,
    });
  });

  return { ok: true };
});

/** 管理員：對指定「會員預約」寄出一封測試用狀態通知信（不變更 Firestore；與正式信相同 Resend 管道） */
export const testSendMemberBookingStatusEmail = onCall(
  { ...publicCall, secrets: [resendApiKey] },
  async (request) => {
    const locale = parseLocale(request.data);
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", st(locale, "auth.needLogin", "請先登入"));
    }
    await assertAdminByUid(uid, locale);

    const bookingId = typeof request.data?.bookingId === "string" ? request.data.bookingId.trim() : "";
    if (!bookingId) {
      throw new HttpsError("invalid-argument", st(locale, "booking.idRequired", "bookingId 必填"));
    }

    const snap = await db.collection("bookings").doc(bookingId).get();
    if (!snap.exists) {
      throw new HttpsError("not-found", st(locale, "booking.notFound", "找不到預約"));
    }
    const data = snap.data() as Record<string, unknown>;
    const mode = data.bookingMode;
    if (mode === "guest_cash" || mode === "guest_beverage") {
      throw new HttpsError("failed-precondition", st(locale, "testStatusEmail.guest", "訪客預約不會寄發會員狀態信。"));
    }
    const customerId = typeof data.customerId === "string" ? data.customerId.trim() : "";
    if (!customerId) {
      throw new HttpsError(
        "failed-precondition",
        st(locale, "testStatusEmail.noCustomer", "此預約未綁定會員（無 customerId），無法測試會員通知信。"),
      );
    }

    const apiKey = resendApiKey.value().trim();
    if (!apiKey) {
      throw new HttpsError(
        "failed-precondition",
        st(locale, "testStatusEmail.noResendKey", "專案未設定 RESEND_API_KEY，無法寄信。"),
      );
    }
    const from = resendFrom.value().trim() || "Massage預約 <onboarding@resend.dev>";

    let to: string;
    try {
      const user = await getAuth().getUser(customerId);
      to = user.email ?? "";
    } catch (e) {
      console.warn("testSendMemberBookingStatusEmail: getUser failed", customerId, e);
      throw new HttpsError(
        "failed-precondition",
        st(locale, "testStatusEmail.noMemberEmail", "無法讀取會員帳號或該帳號沒有信箱。"),
      );
    }
    if (!to) {
      throw new HttpsError(
        "failed-precondition",
        st(locale, "testStatusEmail.noMemberEmail", "此會員在 Firebase Auth 沒有設定 Email，無法寄送。"),
      );
    }

    const displayName = typeof data.displayName === "string" ? data.displayName.trim() : "";
    const dateKey = typeof data.dateKey === "string" ? data.dateKey : "";
    const startSlot = typeof data.startSlot === "string" ? data.startSlot : "";
    const mailLocale = data.notificationLocale === "en" ? "en" : "zh-Hant";

    await sendMemberBookingStatusChangedEmail({
      apiKey,
      from,
      locale: mailLocale,
      testMode: true,
      payload: {
        to,
        displayName: displayName || (mailLocale === "en" ? "Member" : "會員"),
        dateKey,
        startSlot,
        previousStatus: "pending",
        newStatus: "confirmed",
      },
    });

    const deliverabilityWarning = isResendOnboardingFromAddress(from)
      ? st(
          locale,
          "testStatusEmail.resendOnboardingFromWarning",
          "目前寄件者仍為 Resend 測試用 onboarding@resend.dev：此模式下寄到一般會員信箱常實際收不到（但「新預約通知」寄到您設定的店家信箱仍可能正常）。若要讓會員收到狀態信與測試信，請至 Resend 驗證自有網域，並將 Functions 參數 RESEND_FROM 改為該網域下的寄件地址。",
        )
      : undefined;
    return { ok: true as const, sentTo: to, ...(deliverabilityWarning ? { deliverabilityWarning } : {}) };
  },
);

function formatTaipeiDateKey(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const mo = parts.find((p) => p.type === "month")?.value;
  const da = parts.find((p) => p.type === "day")?.value;
  if (!y || !mo || !da) return "2000-01-01";
  return `${y}-${mo}-${da}`;
}

/** 管理員：依會員 UID 寄出一封測試用「預約狀態通知」樣板信（不綁預約、不改 Firestore） */
export const testSendMemberStatusTestEmail = onCall(
  { ...publicCall, secrets: [resendApiKey] },
  async (request) => {
    const locale = parseLocale(request.data);
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", st(locale, "auth.needLogin", "請先登入"));
    }
    await assertAdminByUid(uid, locale);

    const customerId = typeof request.data?.customerId === "string" ? request.data.customerId.trim() : "";
    if (!customerId) {
      throw new HttpsError(
        "invalid-argument",
        st(locale, "admin.customerIdRequired", "customerId 必填（會員 UID 或 Email）"),
      );
    }

    const apiKey = resendApiKey.value().trim();
    if (!apiKey) {
      throw new HttpsError(
        "failed-precondition",
        st(locale, "testStatusEmail.noResendKey", "專案未設定 RESEND_API_KEY，無法寄信。"),
      );
    }
    const from = resendFrom.value().trim() || "Massage預約 <onboarding@resend.dev>";

    let to = "";
    let authDisplayName = "";
    try {
      const user = await getAuth().getUser(customerId);
      to = user.email ?? "";
      authDisplayName = typeof user.displayName === "string" ? user.displayName.trim() : "";
    } catch (e) {
      console.warn("testSendMemberStatusTestEmail: getUser failed", customerId, e);
      throw new HttpsError(
        "failed-precondition",
        st(locale, "testStatusEmail.memberNotFound", "找不到該會員帳號，或無法讀取 Firebase Auth。"),
      );
    }
    if (!to) {
      throw new HttpsError(
        "failed-precondition",
        st(locale, "testStatusEmail.noMemberEmail", "此會員在 Firebase Auth 沒有設定 Email，無法寄送。"),
      );
    }

    const customerSnap = await db.collection("customers").doc(customerId).get();
    const nickRaw =
      customerSnap.exists && typeof (customerSnap.data() as Record<string, unknown>).nickname === "string"
        ? ((customerSnap.data() as Record<string, unknown>).nickname as string).trim()
        : "";

    const mailLocale = request.data?.mailLocale === "en" ? "en" : "zh-Hant";
    const displayName =
      nickRaw || authDisplayName || (mailLocale === "en" ? "Member" : "會員");

    const dateKeyRaw = typeof request.data?.dateKey === "string" ? request.data.dateKey.trim() : "";
    const startSlotRaw = typeof request.data?.startSlot === "string" ? request.data.startSlot.trim() : "";
    const dateKey = dateKeyRaw || formatTaipeiDateKey(new Date());
    const startSlot = startSlotRaw || "15:00";

    await sendMemberBookingStatusChangedEmail({
      apiKey,
      from,
      locale: mailLocale === "en" ? "en" : "zh-Hant",
      testMode: true,
      payload: {
        to,
        displayName,
        dateKey,
        startSlot,
        previousStatus: "pending",
        newStatus: "confirmed",
      },
    });

    const deliverabilityWarning = isResendOnboardingFromAddress(from)
      ? st(
          locale,
          "testStatusEmail.resendOnboardingFromWarning",
          "目前寄件者仍為 Resend 測試用 onboarding@resend.dev：此模式下寄到一般會員信箱常實際收不到（但「新預約通知」寄到您設定的店家信箱仍可能正常）。若要讓會員收到狀態信與測試信，請至 Resend 驗證自有網域，並將 Functions 參數 RESEND_FROM 改為該網域下的寄件地址。",
        )
      : undefined;
    return { ok: true as const, sentTo: to, ...(deliverabilityWarning ? { deliverabilityWarning } : {}) };
  },
);

const BROADCAST_SUBJECT_MAX = 200;
const BROADCAST_BODY_MIN = 3;
const BROADCAST_BODY_MAX = 12_000;
const BROADCAST_MAX_RECIPIENTS = 2000;
const BROADCAST_LIST_PAGES_MAX = 50;
const BROADCAST_SEND_DELAY_MS = 120;

function normalizeBroadcastSubject(raw: string): string {
  return raw.replace(/\r\n/g, " ").replace(/\n/g, " ").trim().slice(0, BROADCAST_SUBJECT_MAX);
}

async function collectBroadcastRecipients(onlyEmailVerified: boolean): Promise<{
  recipients: { email: string; uid: string }[];
  totalUsers: number;
  withoutEmail: number;
  disabledSkipped: number;
  unverifiedSkipped: number;
  duplicateSkipped: number;
}> {
  const auth = getAuth();
  let totalUsers = 0;
  let withoutEmail = 0;
  let disabledSkipped = 0;
  let unverifiedSkipped = 0;
  let duplicateSkipped = 0;
  const seen = new Set<string>();
  const recipients: { email: string; uid: string }[] = [];
  let pageToken: string | undefined;
  for (let p = 0; p < BROADCAST_LIST_PAGES_MAX; p++) {
    const res = await auth.listUsers(1000, pageToken);
    for (const u of res.users) {
      totalUsers++;
      if (u.disabled === true) {
        disabledSkipped++;
        continue;
      }
      const email = (u.email ?? "").trim();
      if (!email) {
        withoutEmail++;
        continue;
      }
      if (onlyEmailVerified && u.emailVerified !== true) {
        unverifiedSkipped++;
        continue;
      }
      const key = email.toLowerCase();
      if (seen.has(key)) {
        duplicateSkipped++;
        continue;
      }
      seen.add(key);
      recipients.push({ email, uid: u.uid });
    }
    pageToken = res.pageToken;
    if (!pageToken) break;
  }
  return { recipients, totalUsers, withoutEmail, disabledSkipped, unverifiedSkipped, duplicateSkipped };
}

/**
 * 管理員：對符合條件的 Auth 使用者群發自訂主旨／內文（純文字→HTML）。
 * `dryRun: true` 僅回傳人數統計；實際寄送需 `confirmSend: true`。
 */
export const sendMembersBroadcastAdmin = onCall(
  { ...publicCall, secrets: [resendApiKey], timeoutSeconds: 360 },
  async (request) => {
    const locale = parseLocale(request.data);
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", st(locale, "auth.needLogin", "請先登入"));
    }
    await assertAdminByUid(uid, locale);

    const dryRun = request.data?.dryRun === true;
    const confirmSend = request.data?.confirmSend === true;
    const onlyEmailVerified = request.data?.onlyEmailVerified !== false;

    const subjectRaw = typeof request.data?.subject === "string" ? request.data.subject : "";
    const bodyRaw = typeof request.data?.body === "string" ? request.data.body : "";
    const subject = normalizeBroadcastSubject(subjectRaw);
    const body = bodyRaw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();

    if (!subject) {
      throw new HttpsError(
        "invalid-argument",
        st(locale, "broadcast.subjectRequired", "請填寫主旨（1～200 字，不可僅空白）。"),
      );
    }
    if (body.length < BROADCAST_BODY_MIN) {
      throw new HttpsError(
        "invalid-argument",
        st(locale, "broadcast.bodyTooShort", "內文至少 {{min}} 字。", { min: BROADCAST_BODY_MIN }),
      );
    }
    if (body.length > BROADCAST_BODY_MAX) {
      throw new HttpsError(
        "invalid-argument",
        st(locale, "broadcast.bodyTooLong", "內文不可超過 {{max}} 字。", { max: BROADCAST_BODY_MAX }),
      );
    }
    if (!dryRun && !confirmSend) {
      throw new HttpsError(
        "invalid-argument",
        st(locale, "broadcast.needConfirm", "實際寄送需勾選確認，或先使用「僅預覽人數」（dryRun）。"),
      );
    }

    const stats = await collectBroadcastRecipients(onlyEmailVerified);
    const { recipients, totalUsers, withoutEmail, disabledSkipped, unverifiedSkipped, duplicateSkipped } = stats;

    if (recipients.length === 0) {
      throw new HttpsError(
        "failed-precondition",
        st(locale, "broadcast.noRecipients", "沒有符合條件的收件人（請檢查是否僅限已驗證信箱，或專案內尚無帶 Email 的帳號）。"),
      );
    }
    if (recipients.length > BROADCAST_MAX_RECIPIENTS) {
      throw new HttpsError(
        "failed-precondition",
        st(
          locale,
          "broadcast.tooManyRecipients",
          "收件人數（{{n}}）超過單次上限 {{max}}，請聯絡開發者分批或調整上限。",
          { n: recipients.length, max: BROADCAST_MAX_RECIPIENTS },
        ),
      );
    }

    const mailLocale: EmailLocale = locale === "en" ? "en" : "zh-Hant";
    const html = buildBroadcastEmailHtml(body, mailLocale);

    if (dryRun) {
      return {
        ok: true as const,
        dryRun: true as const,
        totalUsers,
        withoutEmail,
        disabledSkipped,
        unverifiedSkipped,
        duplicateSkipped,
        recipientCount: recipients.length,
      };
    }

    const apiKey = resendApiKey.value().trim();
    if (!apiKey) {
      throw new HttpsError(
        "failed-precondition",
        st(locale, "testStatusEmail.noResendKey", "專案未設定 RESEND_API_KEY，無法寄信。"),
      );
    }
    const from = resendFrom.value().trim() || "Massage預約 <onboarding@resend.dev>";

    let sent = 0;
    const failed: { email: string; error: string }[] = [];
    for (let i = 0; i < recipients.length; i++) {
      const { email } = recipients[i]!;
      try {
        await sendBroadcastHtmlEmail({ apiKey, from, to: email, subject, html });
        sent++;
      } catch (e) {
        let msg = "send failed";
        if (e instanceof HttpsError && e.message) msg = e.message;
        else if (e instanceof Error && e.message) msg = e.message;
        failed.push({ email, error: msg.slice(0, 400) });
      }
      if (i < recipients.length - 1 && BROADCAST_SEND_DELAY_MS > 0) {
        await new Promise((r) => setTimeout(r, BROADCAST_SEND_DELAY_MS));
      }
    }

    const deliverabilityWarning = isResendOnboardingFromAddress(from)
      ? st(
          locale,
          "testStatusEmail.resendOnboardingFromWarning",
          "目前寄件者仍為 Resend 測試用 onboarding@resend.dev：此模式下寄到一般會員信箱常實際收不到（但「新預約通知」寄到您設定的店家信箱仍可能正常）。若要讓會員收到狀態信與測試信，請至 Resend 驗證自有網域，並將 Functions 參數 RESEND_FROM 改為該網域下的寄件地址。",
        )
      : undefined;

    return {
      ok: true as const,
      dryRun: false as const,
      totalUsers,
      withoutEmail,
      disabledSkipped,
      unverifiedSkipped,
      duplicateSkipped,
      recipientCount: recipients.length,
      sent,
      failed,
      ...(deliverabilityWarning ? { deliverabilityWarning } : {}),
    };
  },
);

/**
 * 管理員：寄一封自訂主旨／內文給「單一」Firebase Auth 使用者；僅允許 Email 已驗證者。
 * `dryRun: true` 僅驗證對象並回傳 email／uid；實際寄送需 `confirmSend: true`。
 */
export const sendMemberDirectEmailAdmin = onCall(
  { ...publicCall, secrets: [resendApiKey], timeoutSeconds: 120 },
  async (request) => {
    const locale = parseLocale(request.data);
    const adminUid = request.auth?.uid;
    if (!adminUid) {
      throw new HttpsError("unauthenticated", st(locale, "auth.needLogin", "請先登入"));
    }
    await assertAdminByUid(adminUid, locale);

    const dryRun = request.data?.dryRun === true;
    const confirmSend = request.data?.confirmSend === true;
    const memberTargetRaw = typeof request.data?.memberTarget === "string" ? request.data.memberTarget : "";
    const memberTarget = memberTargetRaw.trim();

    const subjectRaw = typeof request.data?.subject === "string" ? request.data.subject : "";
    const bodyRaw = typeof request.data?.body === "string" ? request.data.body : "";
    const subject = normalizeBroadcastSubject(subjectRaw);
    const body = bodyRaw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();

    if (!memberTarget) {
      throw new HttpsError(
        "invalid-argument",
        st(locale, "directEmail.targetRequired", "請填寫收件會員（Email 或 UID）。"),
      );
    }
    if (!subject) {
      throw new HttpsError(
        "invalid-argument",
        st(locale, "broadcast.subjectRequired", "請填寫主旨（1～200 字，不可僅空白）。"),
      );
    }
    if (body.length < BROADCAST_BODY_MIN) {
      throw new HttpsError(
        "invalid-argument",
        st(locale, "broadcast.bodyTooShort", "內文至少 {{min}} 字。", { min: BROADCAST_BODY_MIN }),
      );
    }
    if (body.length > BROADCAST_BODY_MAX) {
      throw new HttpsError(
        "invalid-argument",
        st(locale, "broadcast.bodyTooLong", "內文不可超過 {{max}} 字。", { max: BROADCAST_BODY_MAX }),
      );
    }

    const auth = getAuth();
    let record;
    try {
      record = memberTarget.includes("@")
        ? await auth.getUserByEmail(memberTarget)
        : await auth.getUser(memberTarget);
    } catch (e: unknown) {
      const code =
        e && typeof e === "object" && "code" in e ? String((e as { code?: unknown }).code) : "";
      if (code.includes("user-not-found")) {
        throw new HttpsError(
          "not-found",
          st(locale, "directEmail.userNotFound", "找不到此會員（請確認 Email 或 UID）。"),
        );
      }
      throw new HttpsError(
        "invalid-argument",
        st(locale, "directEmail.lookupFail", "無法解析會員識別，請確認格式。"),
      );
    }

    if (record.disabled === true) {
      throw new HttpsError(
        "failed-precondition",
        st(locale, "directEmail.accountDisabled", "此帳號已停用，無法寄信。"),
      );
    }
    const toEmail = (record.email ?? "").trim();
    if (!toEmail) {
      throw new HttpsError(
        "failed-precondition",
        st(locale, "directEmail.noEmail", "該帳號沒有設定信箱，無法寄信。"),
      );
    }
    if (record.emailVerified !== true) {
      throw new HttpsError(
        "failed-precondition",
        st(locale, "directEmail.notVerified", "該會員尚未完成 Email 驗證；此功能僅能寄給「已驗證」使用者。"),
      );
    }

    const displayName =
      typeof record.displayName === "string" && record.displayName.trim()
        ? record.displayName.trim()
        : toEmail;

    if (dryRun) {
      return {
        ok: true as const,
        dryRun: true as const,
        uid: record.uid,
        email: toEmail,
        displayName,
      };
    }

    if (!confirmSend) {
      throw new HttpsError(
        "invalid-argument",
        st(locale, "broadcast.needConfirm", "實際寄送需勾選確認，或先使用「僅預覽人數」（dryRun）。"),
      );
    }

    const apiKey = resendApiKey.value().trim();
    if (!apiKey) {
      throw new HttpsError(
        "failed-precondition",
        st(locale, "testStatusEmail.noResendKey", "專案未設定 RESEND_API_KEY，無法寄信。"),
      );
    }
    const from = resendFrom.value().trim() || "Massage預約 <onboarding@resend.dev>";
    const mailLocale: EmailLocale = locale === "en" ? "en" : "zh-Hant";
    const html = buildBroadcastEmailHtml(body, mailLocale);

    try {
      await sendBroadcastHtmlEmail({ apiKey, from, to: toEmail, subject, html });
    } catch (e) {
      let msg = "send failed";
      if (e instanceof HttpsError && e.message) msg = e.message;
      else if (e instanceof Error && e.message) msg = e.message;
      throw new HttpsError(
        "internal",
        st(locale, "directEmail.sendFailed", "寄送失敗：{{detail}}", { detail: msg.slice(0, 400) }),
      );
    }

    const deliverabilityWarning = isResendOnboardingFromAddress(from)
      ? st(
          locale,
          "testStatusEmail.resendOnboardingFromWarning",
          "目前寄件者仍為 Resend 測試用 onboarding@resend.dev：此模式下寄到一般會員信箱常實際收不到（但「新預約通知」寄到您設定的店家信箱仍可能正常）。若要讓會員收到狀態信與測試信，請至 Resend 驗證自有網域，並將 Functions 參數 RESEND_FROM 改為該網域下的寄件地址。",
        )
      : undefined;

    return {
      ok: true as const,
      dryRun: false as const,
      uid: record.uid,
      email: toEmail,
      sent: 1,
      ...(deliverabilityWarning ? { deliverabilityWarning } : {}),
    };
  },
);

export const cancelBooking = onCall(publicCall, async (request) => {
  const locale = parseLocale(request.data);
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", st(locale, "auth.needLogin", "請先登入"));
  }

  const bookingId = typeof request.data?.bookingId === "string" ? request.data.bookingId.trim() : "";
  if (!bookingId) {
    throw new HttpsError("invalid-argument", st(locale, "booking.idRequired", "bookingId 必填"));
  }
  const cancelReasonRaw = request.data?.cancelReason;
  const cancelReason =
    typeof cancelReasonRaw === "string" ? cancelReasonRaw.trim().slice(0, 500) : "";
  const bookingRef = db.collection("bookings").doc(bookingId);
  const adminRef = db.collection("admins").doc(uid);
  const [bookingSnapPre, adminSnapPre] = await Promise.all([bookingRef.get(), adminRef.get()]);
  if (!bookingSnapPre.exists) {
    throw new HttpsError("not-found", st(locale, "booking.notFound", "找不到預約"));
  }
  const preData = bookingSnapPre.data() as Record<string, unknown>;
  const preCustomerId = typeof preData.customerId === "string" ? preData.customerId : null;
  const preIsAdmin = adminSnapPre.exists;
  if (!preIsAdmin && preCustomerId !== uid) {
    throw new HttpsError("permission-denied", st(locale, "cancel.notYours", "僅能取消自己的預約，或需具管理員權限"));
  }
  if (!preIsAdmin && preCustomerId === uid) {
    await assertMemberEmailVerified(uid, locale);
  }

  await db.runTransaction(async (tx) => {
    const [bookingSnap, adminSnap] = await Promise.all([tx.get(bookingRef), tx.get(adminRef)]);
    if (!bookingSnap.exists) {
      throw new HttpsError("not-found", st(locale, "booking.notFound", "找不到預約"));
    }
    const data = bookingSnap.data() as Record<string, unknown>;
    const status = (data.status as BookingStatus | undefined) ?? "pending";
    if (status === "cancelled") {
      throw new HttpsError("failed-precondition", st(locale, "cancel.alreadyCancelled", "此預約已取消"));
    }
    if (status === "deleted") {
      throw new HttpsError("failed-precondition", st(locale, "cancel.deleted", "此預約已刪除"));
    }
    if (status === "done") {
      throw new HttpsError("failed-precondition", st(locale, "cancel.doneNoDirect", "已完成預約不可直接取消"));
    }

    const customerId = typeof data.customerId === "string" ? data.customerId : null;
    const isAdmin = adminSnap.exists;
    if (!isAdmin && customerId !== uid) {
      throw new HttpsError("permission-denied", st(locale, "cancel.notYours", "僅能取消自己的預約，或需具管理員權限"));
    }
    const walletDeductedRaw = data.walletDeducted;
    const walletDeducted = typeof walletDeductedRaw === "number" ? walletDeductedRaw : 0;
    const sessionCreditsDeductedRaw = data.sessionCreditsDeducted;
    const sessionCreditsDeducted =
      typeof sessionCreditsDeductedRaw === "number" ? Math.max(0, Math.floor(sessionCreditsDeductedRaw)) : 0;
    const bookingMode = typeof data.bookingMode === "string" ? data.bookingMode : "";
    const legacyWalletRefund =
      customerId && bookingMode === "member_wallet" && walletDeducted > 0 && sessionCreditsDeducted < 1;
    const sessionRefund =
      customerId && bookingMode === "member_wallet" && sessionCreditsDeducted >= 1;

    if (legacyWalletRefund) {
      const customerRef = db.collection("customers").doc(customerId);
      const customerSnap = await tx.get(customerRef);
      const walletBalanceRaw = customerSnap.exists ? customerSnap.get("walletBalance") : 0;
      const drawChancesRaw = customerSnap.exists ? customerSnap.get("drawChances") : 0;
      tx.set(
        customerRef,
        {
          walletBalance: (typeof walletBalanceRaw === "number" ? walletBalanceRaw : 0) + walletDeducted,
          drawChances: typeof drawChancesRaw === "number" ? drawChancesRaw : 0,
          updatedAt: FieldValueOrServerTimestamp(),
        },
        { merge: true },
      );
      const walletTxRef = db.collection("walletTransactions").doc();
      tx.set(walletTxRef, {
        customerId,
        bookingId,
        type: "refund",
        amount: walletDeducted,
        note: "取消預約退款（舊版儲值金）",
        operatorId: uid,
        createdAt: FieldValueOrServerTimestamp(),
      });
    } else if (sessionRefund) {
      const customerRef = db.collection("customers").doc(customerId);
      const customerSnap = await tx.get(customerRef);
      const sessionCreditsRaw = customerSnap.exists ? customerSnap.get("sessionCredits") : 0;
      const prevSc = typeof sessionCreditsRaw === "number" ? sessionCreditsRaw : 0;
      tx.set(
        customerRef,
        {
          sessionCredits: prevSc + sessionCreditsDeducted,
          updatedAt: FieldValueOrServerTimestamp(),
        },
        { merge: true },
      );
      const walletTxRef = db.collection("walletTransactions").doc();
      tx.set(walletTxRef, {
        customerId,
        bookingId,
        type: "session_refund",
        amount: 0,
        sessionsDelta: sessionCreditsDeducted,
        note: `取消預約退回次數 ${sessionCreditsDeducted}`,
        operatorId: uid,
        createdAt: FieldValueOrServerTimestamp(),
      });
    }

    const cancelPatch: Record<string, unknown> = {
      status: "cancelled",
      updatedAt: FieldValueOrServerTimestamp(),
      cancelledAt: FieldValueOrServerTimestamp(),
      cancelledBy: uid,
    };
    if (cancelReason.length > 0) {
      cancelPatch.cancelReason = cancelReason;
    }
    tx.update(bookingRef, cancelPatch);
  });

  return { ok: true };
});

export const listActiveWheelPrizes = onCall(publicCall, async (request) => {
  const locale = parseLocale(request.data);
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", st(locale, "auth.needLogin", "請先登入"));
  }
  await assertMemberEmailVerified(uid, locale);
  const prizes = await loadActiveWheelPrizes();
  if (prizes.length === 0) {
    throw new HttpsError("failed-precondition", st(locale, "wheel.noPrizes", "目前沒有可用輪盤獎項"));
  }
  return {
    prizes: prizes.map((p) => ({ id: p.id, name: p.name, type: p.type, weight: p.weight })),
  };
});

export const spinWheel = onCall(publicCall, async (request) => {
  const locale = parseLocale(request.data);
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", st(locale, "auth.needLogin", "請先登入"));
  }
  await assertMemberEmailVerified(uid, locale);
  const prizes = await loadActiveWheelPrizes();

  if (prizes.length === 0) {
    throw new HttpsError("failed-precondition", st(locale, "wheel.noPrizes", "目前沒有可用輪盤獎項"));
  }
  const picked = pickWeighted(prizes);

  const customerRef = db.collection("customers").doc(uid);
  const spinRef = db.collection("wheelSpins").doc();
  const walletTxRef = db.collection("walletTransactions").doc();

  let remainingDrawChances = 0;
  let nextWalletBalance = 0;
  let nextWheelPoints = 0;
  let nextSessionCredits = 0;
  await db.runTransaction(async (tx) => {
    const customerSnap = await tx.get(customerRef);
    const drawChances = asNonNegativeInteger(customerSnap.exists ? customerSnap.get("drawChances") : 0);
    const walletBalance = asNonNegativeInteger(customerSnap.exists ? customerSnap.get("walletBalance") : 0);
    const wheelPoints = asNonNegativeInteger(customerSnap.exists ? customerSnap.get("wheelPoints") : 0);
    const sessionCredits = asNonNegativeInteger(customerSnap.exists ? customerSnap.get("sessionCredits") : 0);
    if (drawChances < 1) {
      throw new HttpsError("failed-precondition", st(locale, "wheel.noChances", "可抽次數不足"));
    }

    let pointsDelta = 0;
    let chanceDelta = -1;
    if (picked.type === "points") {
      pointsDelta = picked.value;
    } else if (picked.type === "chance") {
      chanceDelta += picked.value;
    }
    remainingDrawChances = drawChances + chanceDelta;
    nextWalletBalance = walletBalance;
    nextWheelPoints = wheelPoints + pointsDelta;
    nextSessionCredits = sessionCredits;

    tx.set(
      customerRef,
      {
        walletBalance: nextWalletBalance,
        wheelPoints: nextWheelPoints,
        sessionCredits: nextSessionCredits,
        drawChances: remainingDrawChances,
        updatedAt: FieldValueOrServerTimestamp(),
      },
      { merge: true },
    );

    if (pointsDelta > 0) {
      tx.set(walletTxRef, {
        customerId: uid,
        type: "prize_points",
        amount: 0,
        pointsDelta,
        note: `輪盤獎勵：${picked.name}（+${pointsDelta} 點）`,
        operatorId: uid,
        createdAt: FieldValueOrServerTimestamp(),
      });
    }

    tx.set(spinRef, {
      customerId: uid,
      prizeId: picked.id,
      prizeSnapshot: {
        name: picked.name,
        type: picked.type,
        value: picked.value,
        weight: picked.weight,
      },
      operatorId: uid,
      createdAt: FieldValueOrServerTimestamp(),
    });
  });

  return {
    prize: {
      id: picked.id,
      name: picked.name,
      type: picked.type,
      value: picked.value,
    },
    drawChances: remainingDrawChances,
    walletBalance: nextWalletBalance,
    wheelPoints: nextWheelPoints,
    sessionCredits: nextSessionCredits,
  };
});

export const seedWheelPrizes = onCall(publicCall, async (request) => {
  const locale = parseLocale(request.data);
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", st(locale, "auth.needLogin", "請先登入"));
  }
  await assertAdminByUid(uid, locale);

  const existing = await db.collection("wheelPrizes").limit(1).get();
  if (!existing.empty) {
    return { ok: true, seeded: false, message: "wheelPrizes 已存在資料，略過初始化" };
  }

  const defaults: Array<{ id: string; name: string; type: PrizeType; value: number; weight: number }> = [
    { id: "pts5", name: "+5 點", type: "points", value: 5, weight: 18 },
    { id: "pts3", name: "+3 點", type: "points", value: 3, weight: 26 },
    { id: "pts1", name: "+1 點", type: "points", value: 1, weight: 22 },
    { id: "chance1", name: "再抽一次", type: "chance", value: 1, weight: 14 },
    { id: "thanks", name: "銘謝惠顧", type: "thanks", value: 0, weight: 14 },
    { id: "penalty", name: "小處罰文案", type: "penalty_text", value: 0, weight: 6 },
  ];
  const batch = db.batch();
  for (const item of defaults) {
    const ref = db.collection("wheelPrizes").doc(item.id);
    batch.set(ref, {
      ...item,
      active: true,
      updatedAt: FieldValueOrServerTimestamp(),
    });
  }
  await batch.commit();
  return { ok: true, seeded: true, count: defaults.length };
});

/** 使用 admin Timestamp.now 避免額外 import serverTimestamp 型別問題 */
function FieldValueOrServerTimestamp(): Timestamp {
  return Timestamp.now();
}

const SUPPORT_CHAT_TEXT_MAX = 2000;
const SUPPORT_CHAT_PREVIEW_MAX = 200;

function supportChatPreview(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= SUPPORT_CHAT_PREVIEW_MAX) return t;
  return `${t.slice(0, SUPPORT_CHAT_PREVIEW_MAX - 1)}…`;
}

/** 會員／訪客匿名：送客服訊息，或僅重新開啟對話（Admin 寫入，避開客戶端 Rules 評估問題） */
export const sendSupportChatMessage = onCall(publicCall, async (request) => {
  const locale = parseLocale(request.data);
  const uid = request.auth?.uid;
  const authToken = request.auth?.token;
  if (!uid) {
    throw new HttpsError(
      "unauthenticated",
      st(locale, "support.needLoginOrGuest", "請先登入或按「以訪客身分開始留言」"),
    );
  }
  const signInProviderRaw = (authToken?.firebase as { sign_in_provider?: unknown } | undefined)?.sign_in_provider;
  const signInProvider = typeof signInProviderRaw === "string" ? signInProviderRaw : "";
  const customerType = signInProvider === "anonymous" ? "guest" : "member";
  const reopen = request.data?.reopen === true;
  if (reopen) {
    const threadRef = db.collection("supportThreads").doc(uid);
    const snap = await threadRef.get();
    if (!snap.exists) {
      throw new HttpsError("not-found", st(locale, "support.noThread", "尚無對話紀錄"));
    }
    await threadRef.update({
      status: "open",
      customerType,
      updatedAt: FieldValueOrServerTimestamp(),
    });
    return { ok: true };
  }
  const textRaw = typeof request.data?.text === "string" ? request.data.text.trim() : "";
  if (textRaw.length < 1) {
    throw new HttpsError("invalid-argument", st(locale, "support.needMessage", "請輸入訊息內容"));
  }
  if (textRaw.length > SUPPORT_CHAT_TEXT_MAX) {
    throw new HttpsError(
      "invalid-argument",
      st(locale, "support.messageTooLong", "訊息最長 {{max}} 字", { max: SUPPORT_CHAT_TEXT_MAX }),
    );
  }
  const threadRef = db.collection("supportThreads").doc(uid);
  const preview = supportChatPreview(textRaw);
  const threadSnap = await threadRef.get();
  if (!threadSnap.exists) {
    const now = FieldValueOrServerTimestamp();
    await threadRef.set({
      customerId: uid,
      customerType,
      status: "open",
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
      lastMessagePreview: preview,
    });
  } else {
    const threadStatus = threadSnap.get("status");
    if (threadStatus === "closed") {
      throw new HttpsError(
        "failed-precondition",
        st(locale, "support.threadClosed", "此對話已結束，請先按「繼續諮詢（重新開啟對話）」"),
      );
    }
    await threadRef.update({
      customerType,
      updatedAt: FieldValueOrServerTimestamp(),
      lastMessageAt: FieldValueOrServerTimestamp(),
      lastMessagePreview: preview,
    });
  }
  await threadRef.collection("messages").add({
    text: textRaw,
    sender: "customer",
    senderUid: uid,
    createdAt: FieldValueOrServerTimestamp(),
  });
  return { ok: true };
});

/** 管理員回覆客服訊息 */
export const sendSupportChatAdminReply = onCall(publicCall, async (request) => {
  const locale = parseLocale(request.data);
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", st(locale, "auth.needLogin", "請先登入"));
  }
  await assertAdminByUid(uid, locale);
  const customerId = typeof request.data?.customerId === "string" ? request.data.customerId.trim() : "";
  const textRaw = typeof request.data?.text === "string" ? request.data.text.trim() : "";
  if (!customerId) {
    throw new HttpsError("invalid-argument", st(locale, "support.needCustomerId", "缺少 customerId"));
  }
  if (textRaw.length < 1) {
    throw new HttpsError("invalid-argument", st(locale, "support.needReply", "請輸入回覆內容"));
  }
  if (textRaw.length > SUPPORT_CHAT_TEXT_MAX) {
    throw new HttpsError(
      "invalid-argument",
      st(locale, "support.messageTooLong", "訊息最長 {{max}} 字", { max: SUPPORT_CHAT_TEXT_MAX }),
    );
  }
  const threadRef = db.collection("supportThreads").doc(customerId);
  const threadSnap = await threadRef.get();
  if (!threadSnap.exists) {
    throw new HttpsError("not-found", st(locale, "support.threadMissing", "找不到對話"));
  }
  const preview = supportChatPreview(textRaw);
  await threadRef.update({
    updatedAt: FieldValueOrServerTimestamp(),
    lastMessageAt: FieldValueOrServerTimestamp(),
    lastMessagePreview: preview,
  });
  await threadRef.collection("messages").add({
    text: textRaw,
    sender: "admin",
    senderUid: uid,
    createdAt: FieldValueOrServerTimestamp(),
  });
  return { ok: true };
});

/** 管理員將客服對話標記為進行中／已結束 */
export const setSupportThreadStatusAdmin = onCall(publicCall, async (request) => {
  const locale = parseLocale(request.data);
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", st(locale, "auth.needLogin", "請先登入"));
  }
  await assertAdminByUid(uid, locale);
  const customerId = typeof request.data?.customerId === "string" ? request.data.customerId.trim() : "";
  const statusRaw = request.data?.status;
  const status = statusRaw === "closed" || statusRaw === "open" ? statusRaw : "open";
  if (!customerId) {
    throw new HttpsError("invalid-argument", st(locale, "support.needCustomerId", "缺少 customerId"));
  }
  const threadRef = db.collection("supportThreads").doc(customerId);
  const snap = await threadRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", st(locale, "support.threadMissing", "找不到對話"));
  }
  await threadRef.update({
    status,
    updatedAt: FieldValueOrServerTimestamp(),
  });
  return { ok: true };
});

/** 預約 `status` 變更時寄信給會員（訪客預約略過；無 Email 則略過） */
export const notifyMemberBookingStatusChange = onDocumentUpdated(
  { document: "bookings/{bookingId}", region, secrets: [resendApiKey] },
  async (event) => {
    const change = event.data;
    if (!change) return;
    const before = change.before.data() as Record<string, unknown> | undefined;
    const after = change.after.data() as Record<string, unknown> | undefined;
    if (!before || !after) return;

    const prevStatus = typeof before.status === "string" ? before.status : "pending";
    const nextStatus = typeof after.status === "string" ? after.status : "pending";
    if (prevStatus === nextStatus) return;

    const mode = after.bookingMode;
    if (mode === "guest_cash" || mode === "guest_beverage") return;
    const customerId = typeof after.customerId === "string" ? after.customerId.trim() : "";
    if (!customerId) return;

    if (nextStatus === "deleted") return;

    const apiKey = resendApiKey.value().trim();
    if (!apiKey) {
      console.warn("notifyMemberBookingStatusChange: RESEND_API_KEY empty");
      return;
    }
    const from = resendFrom.value().trim() || "Massage預約 <onboarding@resend.dev>";

    let to: string;
    try {
      const user = await getAuth().getUser(customerId);
      to = user.email ?? "";
    } catch (e) {
      console.warn("notifyMemberBookingStatusChange: getUser failed", customerId, e);
      return;
    }
    if (!to) return;

    const displayName = typeof after.displayName === "string" ? after.displayName.trim() : "";
    const dateKey = typeof after.dateKey === "string" ? after.dateKey : "";
    const startSlot = typeof after.startSlot === "string" ? after.startSlot : "";
    const cancelReasonRaw = after.cancelReason;
    const cancelReason =
      nextStatus === "cancelled" && typeof cancelReasonRaw === "string" ? cancelReasonRaw.trim() : undefined;

    const mailLocale = after.notificationLocale === "en" ? "en" : "zh-Hant";
    try {
      await sendMemberBookingStatusChangedEmail({
        apiKey,
        from,
        locale: mailLocale,
        payload: {
          to,
          displayName: displayName || (mailLocale === "en" ? "Member" : "會員"),
          dateKey,
          startSlot,
          previousStatus: prevStatus,
          newStatus: nextStatus,
          cancelReason: cancelReason && cancelReason.length > 0 ? cancelReason : undefined,
        },
      });
    } catch (e) {
      console.error("notifyMemberBookingStatusChange: send failed", e);
    }
  },
);
