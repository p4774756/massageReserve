import { DateTime } from "luxon";

export const TIMEZONE = "Asia/Taipei";
export const SLOT_STEP_MINUTES = 30;
export const BOOKING_DURATION_MINUTES = 30;
export const MAX_PER_DAY = 2;
export const MAX_PER_WORK_WEEK = 4;

export const ACTIVE_STATUSES = ["pending", "confirmed", "done"] as const;

/** 可預約開始時間：08:00–17:30，每 30 分鐘一格（當地時區） */
export function allStartSlots(): string[] {
  const slots: string[] = [];
  const endMinutes = 17 * 60 + 30;
  for (let m = 8 * 60; m <= endMinutes; m += SLOT_STEP_MINUTES) {
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

export function assertSlotAllowed(dateKey: string, startSlot: string): DateTime {
  const day = parseDateKey(dateKey);
  const today = DateTime.now().setZone(TIMEZONE).startOf("day");
  if (day < today) {
    throw new Error("past_date");
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
  const end = start.plus({ minutes: BOOKING_DURATION_MINUTES });
  const dayEnd = day.set({ hour: 18, minute: 0, second: 0, millisecond: 0 });
  if (end > dayEnd) {
    throw new Error("ends_after_1800");
  }
  return start;
}
