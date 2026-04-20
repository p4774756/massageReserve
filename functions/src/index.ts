import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { DateTime } from "luxon";
import {
  ACTIVE_STATUSES,
  MAX_PER_DAY,
  MAX_PER_WORK_WEEK,
  assertSlotAllowed,
  isWeekday,
  mondayOfWeek,
  parseDateKey,
} from "./bookingLogic";

initializeApp();
const db = getFirestore();

const region = "asia-east1";
/** 允許未登入呼叫（預約與查詢空檔） */
const publicCall = { region, invoker: "public" as const };

type CreateBookingInput = {
  displayName?: unknown;
  note?: unknown;
  dateKey?: unknown;
  startSlot?: unknown;
};

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
  if (!isWeekday(day)) {
    throw new HttpsError("invalid-argument", "僅能查詢週一到週五");
  }

  const weekStart = mondayOfWeek(day).toISODate()!;

  const [daySnap, weekSnap] = await Promise.all([
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
  ]);

  const taken = daySnap.docs.map((d) => d.get("startSlot") as string).filter(Boolean);
  return {
    taken,
    dayCount: daySnap.size,
    weekCount: weekSnap.size,
    dayCap: MAX_PER_DAY,
    weekCap: MAX_PER_WORK_WEEK,
  };
});

export const createBooking = onCall(publicCall, async (request) => {
  const data = request.data as CreateBookingInput;
  const displayName = typeof data.displayName === "string" ? data.displayName.trim() : "";
  const note = typeof data.note === "string" ? data.note.trim() : "";
  const dateKey = typeof data.dateKey === "string" ? data.dateKey : "";
  const startSlot = typeof data.startSlot === "string" ? data.startSlot : "";

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
      not_weekday: "僅能預約週一到週五",
      invalid_slot: "開始時間不在可預約範圍",
      ends_after_1800: "此開始時間將超過 18:00 結束上限",
    };
    throw new HttpsError("failed-precondition", map[code] ?? "無法預約");
  }

  const weekStart = mondayOfWeek(parseDateKey(dateKey)).toISODate()!;
  const startAt = Timestamp.fromDate(startLocal.toJSDate());

  const bookingRef = db.collection("bookings").doc();

  try {
    await db.runTransaction(async (tx) => {
      const dayQ = db
        .collection("bookings")
        .where("dateKey", "==", dateKey)
        .where("status", "in", [...ACTIVE_STATUSES]);
      const weekQ = db
        .collection("bookings")
        .where("weekStart", "==", weekStart)
        .where("status", "in", [...ACTIVE_STATUSES]);

      const [daySnap, weekSnap] = await Promise.all([tx.get(dayQ), tx.get(weekQ)]);

      if (daySnap.size >= MAX_PER_DAY) {
        throw new HttpsError("resource-exhausted", "這一天已額滿（最多兩位）");
      }
      if (weekSnap.size >= MAX_PER_WORK_WEEK) {
        throw new HttpsError("resource-exhausted", "本工作週已達上限（最多四位）");
      }

      const sameSlot = daySnap.docs.find((d) => d.get("startSlot") === startSlot);
      if (sameSlot) {
        throw new HttpsError("already-exists", "此時段已被預約");
      }

      tx.set(bookingRef, {
        displayName,
        note,
        dateKey,
        startSlot,
        weekStart,
        startAt,
        status: "pending",
        createdAt: FieldValueOrServerTimestamp(),
      });
    });
  } catch (e) {
    if (e instanceof HttpsError) {
      throw e;
    }
    console.error(e);
    throw new HttpsError("internal", "預約失敗，請稍後再試");
  }

  return { id: bookingRef.id };
});

/** 使用 admin Timestamp.now 避免額外 import serverTimestamp 型別問題 */
function FieldValueOrServerTimestamp(): Timestamp {
  return Timestamp.now();
}
