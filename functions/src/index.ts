import { createHash } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getMessaging } from "firebase-admin/messaging";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { defineSecret, defineString } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { DateTime } from "luxon";
import { sendMemberBookingStatusChangedEmail, sendNewBookingEmailToOwner } from "./resendNotify";
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

initializeApp();
const db = getFirestore();

/** `sendEachForMulticast` 預設走 HTTP/2，部分環境易出現 `messaging/internal-error`，改走 HTTP/1.1 較穩定 */
let messagingLegacyTransportEnabled = false;
function getMessagingForPush() {
  const messaging = getMessaging();
  if (!messagingLegacyTransportEnabled) {
    messaging.enableLegacyHttpTransport();
    messagingLegacyTransportEnabled = true;
  }
  return messaging;
}

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

const BOOKING_PRICE = 50;

type BookingStatus = "pending" | "confirmed" | "done" | "cancelled" | "deleted";
type PrizeType = "credit" | "chance" | "thanks" | "penalty_text";

async function assertAdminByUid(uid: string): Promise<void> {
  const adminSnap = await db.collection("admins").doc(uid).get();
  if (!adminSnap.exists) {
    throw new HttpsError("permission-denied", "僅限管理員操作");
  }
}

/** 會員儲值／預約／抽獎等需已驗證 Email（後台建立帳號可設為已驗證） */
async function assertMemberEmailVerified(uid: string): Promise<void> {
  const record = await getAuth().getUser(uid);
  if (!record.emailVerified) {
    throw new HttpsError(
      "failed-precondition",
      "請先至信箱完成 Email 驗證後再使用會員功能。",
    );
  }
}

/** 後台儲值：可填 UID，或填會員 Email（含 @ 時改查 Auth） */
async function resolveCustomerUidForTopup(raw: string): Promise<string> {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new HttpsError("invalid-argument", "請填入會員識別（Email 或 UID）");
  }
  if (trimmed.includes("@")) {
    try {
      const userRecord = await getAuth().getUserByEmail(trimmed);
      return userRecord.uid;
    } catch {
      throw new HttpsError("not-found", "找不到此 Email 的會員帳號");
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
      if (!name || !type || !["credit", "chance", "thanks", "penalty_text"].includes(type) || weight <= 0) {
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
  const dateKey = request.data?.dateKey;
  if (typeof dateKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new HttpsError("invalid-argument", "dateKey 需為 YYYY-MM-DD");
  }
  let day: DateTime;
  try {
    day = parseDateKey(dateKey);
  } catch {
    throw new HttpsError("invalid-argument", "日期無效");
  }
  const todayZ = DateTime.now().setZone(TIMEZONE).startOf("day");
  const latestBookable = mondayOfWeek(todayZ).plus({ days: 13 });
  if (day > latestBookable) {
    throw new HttpsError("invalid-argument", "僅能查詢至下週日為止的日期");
  }
  if (!isWeekday(day)) {
    throw new HttpsError("invalid-argument", "僅能查詢週一到週五");
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
    throw new HttpsError("invalid-argument", "請選擇付款方式");
  }
  const isGuestMode = bookingMode === "guest_cash" || bookingMode === "guest_beverage";
  if (!isGuestMode && !uid) {
    throw new HttpsError("unauthenticated", "會員付款模式需先登入");
  }
  if (!isGuestMode && uid) {
    await assertMemberEmailVerified(uid);
  }

  if (!displayName || displayName.length > 80) {
    throw new HttpsError("invalid-argument", "請填寫姓名（最多 80 字）");
  }
  if (note.length > 500) {
    throw new HttpsError("invalid-argument", "備註過長");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new HttpsError("invalid-argument", "日期格式錯誤");
  }

  let startLocal: DateTime;
  try {
    startLocal = assertSlotAllowed(dateKey, startSlot);
  } catch (e) {
    const code = e instanceof Error ? e.message : "bad_request";
    const map: Record<string, string> = {
      invalid_dateKey: "日期無效",
      past_date: "無法預約過去的日期",
      past_slot: "此開始時間已過，請選擇較晚的時段",
      beyond_booking_window: "僅能預約至下週日為止。",
      not_weekday: "僅能預約週一到週五",
      invalid_slot: "開始時間不在可預約範圍",
      ends_after_1800: "此開始時間將超過 18:00 結束上限",
    };
    throw new HttpsError("failed-precondition", map[code] ?? "無法預約");
  }

  const blocksSnap = await db.collection("siteSettings").doc("bookingBlocks").get();
  const blockReason = blockedReasonForSlot(dateKey, startSlot, parseBookingBlockWindows(blocksSnap.data()));
  if (blockReason) {
    throw new HttpsError(
      "failed-precondition",
      blockReason === "此時段不開放預約" ? blockReason : `此時段不開放預約：${blockReason}`,
    );
  }

  const weekStart = mondayOfWeek(parseDateKey(dateKey)).toISODate()!;
  const startAt = Timestamp.fromDate(startLocal.toJSDate());

  const bookingRef = db.collection("bookings").doc();

  try {
    await db.runTransaction(async (tx) => {
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
        throw new HttpsError("resource-exhausted", `這一天已額滿（最多 ${maxPerDay} 筆）`);
      }
      if (weekSnap.size >= maxPerWorkWeek) {
        throw new HttpsError("resource-exhausted", `本工作週已達上限（最多 ${maxPerWorkWeek} 筆）`);
      }

      const sameSlot = daySnap.docs.find((d) => d.get("startSlot") === startSlot);
      if (sameSlot) {
        throw new HttpsError("already-exists", "此時段已被預約");
      }

      let customerId: string | null = null;
      let walletDeducted = 0;
      let paidCash = 0;
      if (bookingMode === "guest_cash") {
        paidCash = BOOKING_PRICE;
      } else if (bookingMode === "guest_beverage") {
        // 訪客以飲料折抵：不綁 customerId、不扣款
      } else if (bookingMode === "member_cash") {
        customerId = uid!;
        paidCash = BOOKING_PRICE;
      } else if (bookingMode === "member_beverage") {
        customerId = uid!;
      } else {
        customerId = uid!;
        walletDeducted = BOOKING_PRICE;
        const customerRef = db.collection("customers").doc(uid!);
        const customerSnap = await tx.get(customerRef);
        const walletBalanceRaw = customerSnap.exists ? customerSnap.get("walletBalance") : 0;
        const walletBalance = typeof walletBalanceRaw === "number" ? walletBalanceRaw : 0;
        if (walletBalance < BOOKING_PRICE) {
          throw new HttpsError("resource-exhausted", "儲值餘額不足，請改用現金或先儲值");
        }
        tx.set(
          customerRef,
          {
            walletBalance: walletBalance - BOOKING_PRICE,
            updatedAt: FieldValueOrServerTimestamp(),
          },
          { merge: true },
        );
        const txRef = db.collection("walletTransactions").doc();
        tx.set(txRef, {
          customerId,
          bookingId: bookingRef.id,
          type: "charge",
          amount: -BOOKING_PRICE,
          note: "預約建立時扣款",
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
        price: BOOKING_PRICE,
        walletDeducted,
        paidCash,
        drawGranted: false,
        status: "pending",
        createdAt: FieldValueOrServerTimestamp(),
        updatedAt: FieldValueOrServerTimestamp(),
      });
    });
  } catch (e) {
    if (e instanceof HttpsError) {
      throw e;
    }
    console.error(e);
    throw new HttpsError("internal", "預約失敗，請稍後再試");
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
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "請先登入");
  }
  await assertMemberEmailVerified(uid);
  const snap = await db.collection("customers").doc(uid).get();
  const walletBalanceRaw = snap.exists ? snap.get("walletBalance") : 0;
  const drawChancesRaw = snap.exists ? snap.get("drawChances") : 0;
  const nicknameRaw = snap.exists ? snap.get("nickname") : "";
  const nickname = typeof nicknameRaw === "string" ? nicknameRaw.trim() : "";
  return {
    walletBalance: typeof walletBalanceRaw === "number" ? walletBalanceRaw : 0,
    drawChances: typeof drawChancesRaw === "number" ? drawChancesRaw : 0,
    nickname,
  };
});

export const topupWallet = onCall(publicCall, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "請先登入");
  }
  await assertAdminByUid(uid);

  const customerIdRaw = typeof request.data?.customerId === "string" ? request.data.customerId.trim() : "";
  const note = typeof request.data?.note === "string" ? request.data.note.trim() : "";
  const amount = asPositiveInteger(request.data?.amount);
  if (!amount) {
    throw new HttpsError("invalid-argument", "儲值金額需為正整數");
  }

  const customerId = await resolveCustomerUidForTopup(customerIdRaw);

  const customerRef = db.collection("customers").doc(customerId);
  const walletTxRef = db.collection("walletTransactions").doc();
  await db.runTransaction(async (tx) => {
    const customerSnap = await tx.get(customerRef);
    const walletBalanceRaw = customerSnap.exists ? customerSnap.get("walletBalance") : 0;
    const drawChancesRaw = customerSnap.exists ? customerSnap.get("drawChances") : 0;
    const nextWallet = (typeof walletBalanceRaw === "number" ? walletBalanceRaw : 0) + amount;
    const drawChances = typeof drawChancesRaw === "number" ? drawChancesRaw : 0;
    tx.set(
      customerRef,
      {
        walletBalance: nextWallet,
        drawChances,
        updatedAt: FieldValueOrServerTimestamp(),
      },
      { merge: true },
    );
    tx.set(walletTxRef, {
      customerId,
      type: "topup",
      amount,
      note: note || "後台儲值",
      operatorId: uid,
      createdAt: FieldValueOrServerTimestamp(),
    });
  });

  return { ok: true };
});

export const getAdminStatus = onCall(publicCall, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    return { isAdmin: false };
  }
  const adminSnap = await db.collection("admins").doc(uid).get();
  return { isAdmin: adminSnap.exists };
});

function pushTokenDocId(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** 已登入使用者註冊 FCM Web token（寫入 `pushDeviceTokens`，僅後端／管理員可讀寫） */
export const registerPushToken = onCall(publicCall, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "請先登入");
  }
  const token = typeof request.data?.token === "string" ? request.data.token.trim() : "";
  if (token.length < 80 || token.length > 4096) {
    throw new HttpsError("invalid-argument", "裝置 token 格式不正確");
  }
  const uaRaw = request.rawRequest?.headers["user-agent"];
  const userAgent = typeof uaRaw === "string" ? uaRaw.slice(0, 240) : "";
  await db.collection("pushDeviceTokens").doc(pushTokenDocId(token)).set(
    {
      token,
      uid,
      userAgent,
      updatedAt: Timestamp.now(),
    },
    { merge: true },
  );
  return { ok: true };
});

/** 登出時可呼叫，刪除本機對應之 token 文件（僅限自己的 uid） */
export const unregisterPushToken = onCall(publicCall, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "請先登入");
  }
  const token = typeof request.data?.token === "string" ? request.data.token.trim() : "";
  if (token.length < 80 || token.length > 4096) {
    throw new HttpsError("invalid-argument", "裝置 token 格式不正確");
  }
  const ref = db.collection("pushDeviceTokens").doc(pushTokenDocId(token));
  const snap = await ref.get();
  if (snap.exists && snap.get("uid") === uid) {
    await ref.delete();
  }
  return { ok: true };
});

/** 管理員：立即對已訂閱裝置發送 FCM 通知 */
export const sendImmediatePush = onCall(publicCall, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "請先登入");
  }
  await assertAdminByUid(uid);
  const titleRaw = typeof request.data?.title === "string" ? request.data.title.trim() : "";
  const bodyRaw = typeof request.data?.body === "string" ? request.data.body.trim() : "";
  const scopeRaw = request.data?.scope;
  const scope = scopeRaw === "all" ? "all" : "self";
  if (titleRaw.length < 1 || titleRaw.length > 50) {
    throw new HttpsError("invalid-argument", "標題長度須為 1～50 字");
  }
  if (bodyRaw.length > 500) {
    throw new HttpsError("invalid-argument", "內文最多 500 字");
  }

  const tokenSnap =
    scope === "self"
      ? await db.collection("pushDeviceTokens").where("uid", "==", uid).get()
      : await db.collection("pushDeviceTokens").get();

  const tokens = tokenSnap.docs
    .map((d) => d.data().token)
    .filter((t): t is string => typeof t === "string" && t.length >= 80);

  if (tokens.length === 0) {
    return {
      successCount: 0,
      failureCount: 0,
      attempted: 0,
      message: "沒有已訂閱的裝置（請先在前台會員中心按「訂閱推播」並允許通知）。",
    };
  }

  const messaging = getMessagingForPush();
  const batchSize = 500;
  let successCount = 0;
  let failureCount = 0;
  const failureDetails: string[] = [];

  for (let offset = 0; offset < tokens.length; offset += batchSize) {
    const batch = tokens.slice(offset, offset + batchSize);
    const res = await messaging.sendEachForMulticast({
      tokens: batch,
      notification: {
        title: titleRaw,
        body: bodyRaw.length > 0 ? bodyRaw : " ",
      },
    });
    successCount += res.successCount;
    failureCount += res.failureCount;
    res.responses.forEach((r, i) => {
      if (r.success) return;
      const code = r.error?.code;
      if (failureDetails.length < 8) {
        const piece = code ?? "unknown";
        const hint = r.error?.message ? `（${String(r.error.message).slice(0, 120)}）` : "";
        failureDetails.push(`${piece}${hint}`);
      }
      if (
        code === "messaging/invalid-registration-token" ||
        code === "messaging/registration-token-not-registered"
      ) {
        const t = batch[i];
        void db.collection("pushDeviceTokens").doc(pushTokenDocId(t)).delete();
      }
    });
  }

  return {
    successCount,
    failureCount,
    attempted: tokens.length,
    message: `已送出：成功 ${successCount}，失敗 ${failureCount}（合計 ${tokens.length} 個 token）。`,
    failureDetails,
  };
});

export const createMemberAccount = onCall(publicCall, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "請先登入");
  }
  await assertAdminByUid(uid);

  const email = typeof request.data?.email === "string" ? request.data.email.trim() : "";
  const password = typeof request.data?.password === "string" ? request.data.password : "";
  const nickname =
    typeof request.data?.nickname === "string" ? request.data.nickname.trim().slice(0, 80) : "";
  if (!email) {
    throw new HttpsError("invalid-argument", "Email 必填");
  }
  if (password.length < 6) {
    throw new HttpsError("invalid-argument", "密碼至少 6 碼");
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
    throw new HttpsError("already-exists", "建立會員失敗：Email 可能已存在");
  }
});

/** 後台依 Email 前綴搜尋會員（掃描 Auth 使用者列表，適合人數不多的場景） */
export const searchMemberUsers = onCall(publicCall, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "請先登入");
  }
  await assertAdminByUid(uid);

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
  drawChances: number;
};

/** 後台：列出 Auth 內所有使用者並合併 Firestore `customers` 餘額與稱呼（適合人數不多的場景） */
export const listMembersAdmin = onCall(publicCall, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "請先登入");
  }
  await assertAdminByUid(uid);

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
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "請先登入");
  }
  await assertAdminByUid(uid);

  const customerRaw = typeof request.data?.customerId === "string" ? request.data.customerId.trim() : "";
  const nicknameRaw = typeof request.data?.nickname === "string" ? request.data.nickname : "";
  if (!customerRaw) {
    throw new HttpsError("invalid-argument", "customerId 必填（會員 UID 或 Email）");
  }

  const targetUid = await resolveCustomerUidForTopup(customerRaw);
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
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "請先登入");
  }
  await assertAdminByUid(uid);

  const bookingId = typeof request.data?.bookingId === "string" ? request.data.bookingId.trim() : "";
  if (!bookingId) {
    throw new HttpsError("invalid-argument", "bookingId 必填");
  }
  const bookingRef = db.collection("bookings").doc(bookingId);
  await db.runTransaction(async (tx) => {
    const bookingSnap = await tx.get(bookingRef);
    if (!bookingSnap.exists) {
      throw new HttpsError("not-found", "找不到預約");
    }
    const data = bookingSnap.data() as Record<string, unknown>;
    const status = (data.status as BookingStatus | undefined) ?? "pending";
    if (status === "done") {
      throw new HttpsError("failed-precondition", "此預約已完成");
    }
    if (!["pending", "confirmed"].includes(status)) {
      throw new HttpsError("failed-precondition", "目前狀態不可完成");
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

export const cancelBooking = onCall(publicCall, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "請先登入");
  }

  const bookingId = typeof request.data?.bookingId === "string" ? request.data.bookingId.trim() : "";
  if (!bookingId) {
    throw new HttpsError("invalid-argument", "bookingId 必填");
  }
  const cancelReasonRaw = request.data?.cancelReason;
  const cancelReason =
    typeof cancelReasonRaw === "string" ? cancelReasonRaw.trim().slice(0, 500) : "";
  const bookingRef = db.collection("bookings").doc(bookingId);
  const adminRef = db.collection("admins").doc(uid);
  const [bookingSnapPre, adminSnapPre] = await Promise.all([bookingRef.get(), adminRef.get()]);
  if (!bookingSnapPre.exists) {
    throw new HttpsError("not-found", "找不到預約");
  }
  const preData = bookingSnapPre.data() as Record<string, unknown>;
  const preCustomerId = typeof preData.customerId === "string" ? preData.customerId : null;
  const preIsAdmin = adminSnapPre.exists;
  if (!preIsAdmin && preCustomerId !== uid) {
    throw new HttpsError("permission-denied", "僅能取消自己的預約，或需具管理員權限");
  }
  if (!preIsAdmin && preCustomerId === uid) {
    await assertMemberEmailVerified(uid);
  }

  await db.runTransaction(async (tx) => {
    const [bookingSnap, adminSnap] = await Promise.all([tx.get(bookingRef), tx.get(adminRef)]);
    if (!bookingSnap.exists) {
      throw new HttpsError("not-found", "找不到預約");
    }
    const data = bookingSnap.data() as Record<string, unknown>;
    const status = (data.status as BookingStatus | undefined) ?? "pending";
    if (status === "cancelled") {
      throw new HttpsError("failed-precondition", "此預約已取消");
    }
    if (status === "deleted") {
      throw new HttpsError("failed-precondition", "此預約已刪除");
    }
    if (status === "done") {
      throw new HttpsError("failed-precondition", "已完成預約不可直接取消");
    }

    const customerId = typeof data.customerId === "string" ? data.customerId : null;
    const isAdmin = adminSnap.exists;
    if (!isAdmin && customerId !== uid) {
      throw new HttpsError("permission-denied", "僅能取消自己的預約，或需具管理員權限");
    }
    const walletDeductedRaw = data.walletDeducted;
    const walletDeducted = typeof walletDeductedRaw === "number" ? walletDeductedRaw : 0;
    if (customerId && walletDeducted > 0) {
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
        note: "取消預約退款",
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
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "請先登入");
  }
  await assertMemberEmailVerified(uid);
  const prizes = await loadActiveWheelPrizes();
  if (prizes.length === 0) {
    throw new HttpsError("failed-precondition", "目前沒有可用輪盤獎項");
  }
  return {
    prizes: prizes.map((p) => ({ id: p.id, name: p.name, type: p.type, weight: p.weight })),
  };
});

export const spinWheel = onCall(publicCall, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "請先登入");
  }
  await assertMemberEmailVerified(uid);
  const prizes = await loadActiveWheelPrizes();

  if (prizes.length === 0) {
    throw new HttpsError("failed-precondition", "目前沒有可用輪盤獎項");
  }
  const picked = pickWeighted(prizes);

  const customerRef = db.collection("customers").doc(uid);
  const spinRef = db.collection("wheelSpins").doc();
  const walletTxRef = db.collection("walletTransactions").doc();

  let remainingDrawChances = 0;
  let nextWalletBalance = 0;
  await db.runTransaction(async (tx) => {
    const customerSnap = await tx.get(customerRef);
    const drawChances = asNonNegativeInteger(customerSnap.exists ? customerSnap.get("drawChances") : 0);
    const walletBalance = asNonNegativeInteger(customerSnap.exists ? customerSnap.get("walletBalance") : 0);
    if (drawChances < 1) {
      throw new HttpsError("failed-precondition", "可抽次數不足");
    }

    let walletDelta = 0;
    let chanceDelta = -1;
    if (picked.type === "credit") {
      walletDelta = picked.value;
    } else if (picked.type === "chance") {
      chanceDelta += picked.value;
    }
    remainingDrawChances = drawChances + chanceDelta;
    nextWalletBalance = walletBalance + walletDelta;

    tx.set(
      customerRef,
      {
        walletBalance: nextWalletBalance,
        drawChances: remainingDrawChances,
        updatedAt: FieldValueOrServerTimestamp(),
      },
      { merge: true },
    );

    if (walletDelta > 0) {
      tx.set(walletTxRef, {
        customerId: uid,
        type: "prize_credit",
        amount: walletDelta,
        note: `輪盤獎勵：${picked.name}`,
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
  };
});

export const seedWheelPrizes = onCall(publicCall, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "請先登入");
  }
  await assertAdminByUid(uid);

  const existing = await db.collection("wheelPrizes").limit(1).get();
  if (!existing.empty) {
    return { ok: true, seeded: false, message: "wheelPrizes 已存在資料，略過初始化" };
  }

  const defaults: Array<{ id: string; name: string; type: PrizeType; value: number; weight: number }> = [
    { id: "credit10", name: "+10 儲值金", type: "credit", value: 10, weight: 20 },
    { id: "credit5", name: "+5 儲值金", type: "credit", value: 5, weight: 25 },
    { id: "chance1", name: "再抽一次", type: "chance", value: 1, weight: 15 },
    { id: "thanks", name: "銘謝惠顧", type: "thanks", value: 0, weight: 30 },
    { id: "penalty", name: "小處罰文案", type: "penalty_text", value: 0, weight: 10 },
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
  const uid = request.auth?.uid;
  const authToken = request.auth?.token;
  if (!uid) {
    throw new HttpsError("unauthenticated", "請先登入或按「以訪客身分開始留言」");
  }
  const signInProviderRaw = (authToken?.firebase as { sign_in_provider?: unknown } | undefined)?.sign_in_provider;
  const signInProvider = typeof signInProviderRaw === "string" ? signInProviderRaw : "";
  const customerType = signInProvider === "anonymous" ? "guest" : "member";
  const reopen = request.data?.reopen === true;
  if (reopen) {
    const threadRef = db.collection("supportThreads").doc(uid);
    const snap = await threadRef.get();
    if (!snap.exists) {
      throw new HttpsError("not-found", "尚無對話紀錄");
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
    throw new HttpsError("invalid-argument", "請輸入訊息內容");
  }
  if (textRaw.length > SUPPORT_CHAT_TEXT_MAX) {
    throw new HttpsError("invalid-argument", `訊息最長 ${SUPPORT_CHAT_TEXT_MAX} 字`);
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
    const st = threadSnap.get("status");
    if (st === "closed") {
      throw new HttpsError(
        "failed-precondition",
        "此對話已結束，請先按「繼續諮詢（重新開啟對話）」",
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
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "請先登入");
  }
  await assertAdminByUid(uid);
  const customerId = typeof request.data?.customerId === "string" ? request.data.customerId.trim() : "";
  const textRaw = typeof request.data?.text === "string" ? request.data.text.trim() : "";
  if (!customerId) {
    throw new HttpsError("invalid-argument", "缺少 customerId");
  }
  if (textRaw.length < 1) {
    throw new HttpsError("invalid-argument", "請輸入回覆內容");
  }
  if (textRaw.length > SUPPORT_CHAT_TEXT_MAX) {
    throw new HttpsError("invalid-argument", `訊息最長 ${SUPPORT_CHAT_TEXT_MAX} 字`);
  }
  const threadRef = db.collection("supportThreads").doc(customerId);
  const threadSnap = await threadRef.get();
  if (!threadSnap.exists) {
    throw new HttpsError("not-found", "找不到對話");
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
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "請先登入");
  }
  await assertAdminByUid(uid);
  const customerId = typeof request.data?.customerId === "string" ? request.data.customerId.trim() : "";
  const statusRaw = request.data?.status;
  const status = statusRaw === "closed" || statusRaw === "open" ? statusRaw : "open";
  if (!customerId) {
    throw new HttpsError("invalid-argument", "缺少 customerId");
  }
  const threadRef = db.collection("supportThreads").doc(customerId);
  const snap = await threadRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "找不到對話");
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

    try {
      await sendMemberBookingStatusChangedEmail({
        apiKey,
        from,
        payload: {
          to,
          displayName: displayName || "會員",
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
