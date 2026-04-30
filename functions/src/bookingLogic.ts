import { DateTime } from "luxon";

export const TIMEZONE = "Asia/Taipei";
export const SLOT_STEP_MINUTES = 15;
export const BOOKING_DURATION_MINUTES = 30;
const LUNCH_START_MINUTES = 11 * 60 + 45;
const LUNCH_END_MINUTES = 13 * 60 + 15;
/** 單次服務結束不得晚於此時刻（台北當日）；最晚開始 = 此時刻 − BOOKING_DURATION（目前 16:30） */
const SERVICE_DAY_END_HOUR = 17;
const SERVICE_DAY_END_MINUTE = 0;
/** 未設定 `siteSettings/bookingCaps` 時的預設值 */
export const DEFAULT_MAX_PER_DAY = 2;
export const DEFAULT_MAX_PER_WORK_WEEK = 4;

/** @deprecated 請以 `resolveBookingCaps` 結果為準；保留與舊程式／測試相容 */
export const MAX_PER_DAY = DEFAULT_MAX_PER_DAY;
/** @deprecated 請以 `resolveBookingCaps` 結果為準 */
export const MAX_PER_WORK_WEEK = DEFAULT_MAX_PER_WORK_WEEK;

const BOOKING_CAP_MIN = 1;
const BOOKING_CAP_MAX = 50;

/** 自 Firestore `siteSettings/bookingCaps` 解析每日／每工作週可預約筆數上限 */
export function resolveBookingCaps(raw: unknown): { maxPerDay: number; maxPerWorkWeek: number } {
  let maxPerDay = DEFAULT_MAX_PER_DAY;
  let maxPerWorkWeek = DEFAULT_MAX_PER_WORK_WEEK;
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const dRaw = o.maxPerDay;
    const wRaw = o.maxPerWorkWeek;
    const d = typeof dRaw === "number" && Number.isFinite(dRaw) ? Math.round(dRaw) : Number(dRaw);
    const w = typeof wRaw === "number" && Number.isFinite(wRaw) ? Math.round(wRaw) : Number(wRaw);
    if (Number.isInteger(d) && d >= BOOKING_CAP_MIN && d <= BOOKING_CAP_MAX) {
      maxPerDay = d;
    }
    if (Number.isInteger(w) && w >= BOOKING_CAP_MIN && w <= BOOKING_CAP_MAX) {
      maxPerWorkWeek = w;
    }
  }
  return { maxPerDay, maxPerWorkWeek };
}

export const ACTIVE_STATUSES = ["pending", "confirmed", "done"] as const;

/** 可預約開始時間：08:00–16:30，每 15 分鐘一格（避開 11:45–13:15 午休；開始時間須能在 SERVICE_DAY_END 前結束） */
export function allStartSlots(): string[] {
  const slots: string[] = [];
  const dayEndMinutes = SERVICE_DAY_END_HOUR * 60 + SERVICE_DAY_END_MINUTE;
  const endMinutes = dayEndMinutes - BOOKING_DURATION_MINUTES;
  for (let m = 8 * 60; m <= endMinutes; m += SLOT_STEP_MINUTES) {
    const slotEnd = m + BOOKING_DURATION_MINUTES;
    const overlapsLunch = m < LUNCH_END_MINUTES && slotEnd > LUNCH_START_MINUTES;
    if (overlapsLunch) continue;
    const h = Math.floor(m / 60);
    const min = m % 60;
    slots.push(`${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
  }
  return slots;
}

export function parseDateKey(dateKey: string): DateTime {
  const dt = DateTime.fromISO(dateKey, { zone: TIMEZONE });
  if (!dt.isValid) {
    throw new Error("invalid_dateKey");
  }
  return dt.startOf("day");
}

/** 該日是否為週一～週五（1–5） */
export function isWeekday(dt: DateTime): boolean {
  return dt.weekday >= 1 && dt.weekday <= 5;
}

/** 該週的週一日期 YYYY-MM-DD（當地） */
export function mondayOfWeek(dt: DateTime): DateTime {
  return dt.minus({ days: dt.weekday - 1 }).startOf("day");
}

/** 本週一起算，可預約之最後日曆日為「下週日」（含）之 YYYY-MM-DD */
export function taipeiLatestBookableDateKey(): string {
  const today = DateTime.now().setZone(TIMEZONE).startOf("day");
  return mondayOfWeek(today).plus({ days: 13 }).toISODate()!;
}

export function assertSlotAllowed(dateKey: string, startSlot: string): DateTime {
  const day = parseDateKey(dateKey);
  const today = DateTime.now().setZone(TIMEZONE).startOf("day");
  if (day < today) {
    throw new Error("past_date");
  }
  const latest = mondayOfWeek(today).plus({ days: 13 });
  if (day > latest) {
    throw new Error("beyond_booking_window");
  }
  if (!isWeekday(day)) {
    throw new Error("not_weekday");
  }
  const slots = allStartSlots();
  if (!slots.includes(startSlot)) {
    throw new Error("invalid_slot");
  }
  const [hh, mm] = startSlot.split(":").map((x) => Number(x));
  const start = day.set({ hour: hh, minute: mm, second: 0, millisecond: 0 });
  const nowZoned = DateTime.now().setZone(TIMEZONE);
  if (start < nowZoned) {
    throw new Error("past_slot");
  }
  const end = start.plus({ minutes: BOOKING_DURATION_MINUTES });
  const dayEnd = day.set({
    hour: SERVICE_DAY_END_HOUR,
    minute: SERVICE_DAY_END_MINUTE,
    second: 0,
    millisecond: 0,
  });
  if (end > dayEnd) {
    throw new Error("ends_after_daily_close");
  }
  return start;
}

/** 後台設定的「不開放預約」區間（Luxon：週一 = 1 … 週五 = 5；同一日內 HH:mm） */
export type BookingBlockWindow = {
  weekday: number;
  start: string;
  end: string;
  reason: string;
};

function minutesFromHHmm(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function normalizeHHmm(hhmm: string): string {
  const total = minutesFromHHmm(hhmm);
  if (total === null) return hhmm.trim();
  const h = Math.floor(total / 60);
  const min = total % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** 從 Firestore `siteSettings/bookingBlocks` 讀出的原始資料解析為有效規則（無效項目略過） */
export function parseBookingBlockWindows(raw: unknown): BookingBlockWindow[] {
  if (!raw || typeof raw !== "object") return [];
  const arr = (raw as { windows?: unknown }).windows;
  if (!Array.isArray(arr)) return [];
  const out: BookingBlockWindow[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const wdRaw = o.weekday;
    const weekday = typeof wdRaw === "number" ? wdRaw : Number(wdRaw);
    const start = typeof o.start === "string" ? o.start.trim() : "";
    const end = typeof o.end === "string" ? o.end.trim() : "";
    const reason = typeof o.reason === "string" ? o.reason.trim() : "";
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 5) continue;
    const b0 = minutesFromHHmm(start);
    const b1 = minutesFromHHmm(end);
    if (b0 === null || b1 === null || b0 >= b1) continue;
    out.push({
      weekday,
      start: normalizeHHmm(start),
      end: normalizeHHmm(end),
      reason: reason.slice(0, 200),
    });
  }
  return out;
}

/**
 * 若該開始時間的服務時段與任一「不開放」區間重疊則回傳說明字串，否則 null。
 * 重疊採左閉右開 [blockStart, blockEnd) 與服務 [slotStart, slotEnd) 標準區間重疊。
 */
export function blockedReasonForSlot(
  dateKey: string,
  startSlot: string,
  windows: BookingBlockWindow[],
): string | null {
  if (windows.length === 0) return null;
  let day: DateTime;
  try {
    day = parseDateKey(dateKey);
  } catch {
    return null;
  }
  if (!isWeekday(day)) return null;
  const wd = day.weekday;
  const srv0 = minutesFromHHmm(startSlot);
  if (srv0 === null) return null;
  const srv1 = srv0 + BOOKING_DURATION_MINUTES;

  for (const w of windows) {
    if (w.weekday !== wd) continue;
    const b0 = minutesFromHHmm(w.start);
    const b1 = minutesFromHHmm(w.end);
    if (b0 === null || b1 === null || b0 >= b1) continue;
    if (srv0 < b1 && srv1 > b0) {
      return w.reason || "此時段不開放預約";
    }
  }
  return null;
}

/** 某日所有「不可選」的開始時間（僅含 `allStartSlots()` 內的格子） */
export function listBlockedStartSlotsForDate(
  dateKey: string,
  windows: BookingBlockWindow[],
): { startSlot: string; reason: string }[] {
  const out: { startSlot: string; reason: string }[] = [];
  for (const s of allStartSlots()) {
    const r = blockedReasonForSlot(dateKey, s, windows);
    if (r) out.push({ startSlot: s, reason: r });
  }
  return out;
}
