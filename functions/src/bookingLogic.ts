import { DateTime } from "luxon";

export const TIMEZONE = "Asia/Taipei";
export const SLOT_STEP_MINUTES = 15;
/** 假日外約：開始時間選項間隔（分） */
export const HOLIDAY_OUTCALL_SLOT_STEP_MINUTES = 30;
/** 舊版預約（無 units 欄位）的固定服務長度 */
export const LEGACY_BOOKING_DURATION_MINUTES = 15;
/** 未帶 pricing 時的預設單位長度（分） */
export const DEFAULT_UNIT_MINUTES = 15;
const LUNCH_START_MINUTES = 11 * 60 + 45;
const LUNCH_END_MINUTES = 13 * 60 + 15;
/** 單次服務結束不得晚於此時刻（台北當日 17:00） */
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

function serviceDayEndMinutes(): number {
  return SERVICE_DAY_END_HOUR * 60 + SERVICE_DAY_END_MINUTE;
}

/** 可選開始時間刻度：08:00–16:45，平日每 15 分鐘／假日外約每 30 分鐘（不含能否排滿 N 單位之判斷） */
export function allGridStartSlots(holidayOutcall?: boolean): string[] {
  const step = holidayOutcall ? HOLIDAY_OUTCALL_SLOT_STEP_MINUTES : SLOT_STEP_MINUTES;
  const slots: string[] = [];
  const gridLast = serviceDayEndMinutes() - SLOT_STEP_MINUTES;
  for (let m = 8 * 60; m <= gridLast; m += step) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    slots.push(`${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
  }
  return slots;
}

/** 平日：每 15 分鐘一格（與 {@link allGridStartSlots} 相同） */
export function allStartSlots(): string[] {
  return allGridStartSlots(false);
}

/** 假日外約：每 30 分鐘一格 */
export function allHolidayOutcallStartSlots(): string[] {
  return allGridStartSlots(true);
}

/** @deprecated 與 {@link LEGACY_BOOKING_DURATION_MINUTES} 相同 */
export const BOOKING_DURATION_MINUTES = LEGACY_BOOKING_DURATION_MINUTES;

export function parseDateKey(dateKey: string): DateTime {
  const dt = DateTime.fromISO(dateKey, { zone: TIMEZONE });
  if (!dt.isValid) {
    throw new Error("invalid_dateKey");
  }
  return dt.startOf("day");
}

const WEEKDAY_ZH_MON1: readonly string[] = ["週一", "週二", "週三", "週四", "週五", "週六", "週日"];

/** 寄信／通知用：YYYY-MM-DD（週X），台北日曆 */
export function formatDateKeyWithWeekdayZh(dateKey: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey;
  try {
    const wd = WEEKDAY_ZH_MON1[parseDateKey(dateKey).weekday - 1];
    return wd ? `${dateKey}（${wd}）` : dateKey;
  } catch {
    return dateKey;
  }
}

/** 台北日曆：週一 … 週日；無效 dateKey 回傳空字串 */
export function weekdayZhFromDateKey(dateKey: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return "";
  try {
    return WEEKDAY_ZH_MON1[parseDateKey(dateKey).weekday - 1] ?? "";
  } catch {
    return "";
  }
}

/** 該日是否為週一～週五（1–5） */
export function isWeekday(dt: DateTime): boolean {
  return dt.weekday >= 1 && dt.weekday <= 5;
}

/** 假日外約可選曆日：週六、週日（Luxon weekday 6–7） */
export function isHolidayOutcallBookableDay(dt: DateTime): boolean {
  return dt.weekday === 6 || dt.weekday === 7;
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

export function minutesFromHHmm(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function hhmmFromMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const min = total % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function durationMinutesForUnits(units: number, unitMinutes: number): number {
  return units * unitMinutes;
}

export function resolveBookingUnitsFromData(data: Record<string, unknown> | undefined): number {
  if (!data) return 1;
  const u = data.units;
  if (typeof u === "number" && Number.isInteger(u) && u >= 1) return u;
  return 1;
}

/** 舊預約無 units／durationMinutes 時視為 15 分鐘；新預約依 units × unitMinutes */
export function resolveBookingDurationMinutesFromData(
  data: Record<string, unknown> | undefined,
  unitMinutes: number = DEFAULT_UNIT_MINUTES,
): number {
  if (!data) return LEGACY_BOOKING_DURATION_MINUTES;
  const dm = data.durationMinutes;
  if (typeof dm === "number" && Number.isInteger(dm) && dm > 0) return dm;
  if (data.units !== undefined) {
    return durationMinutesForUnits(resolveBookingUnitsFromData(data), unitMinutes);
  }
  return LEGACY_BOOKING_DURATION_MINUTES;
}

export function serviceRangeOverlapsLunch(srv0: number, srv1: number): boolean {
  return srv0 < LUNCH_END_MINUTES && srv1 > LUNCH_START_MINUTES;
}

export function bookingRangeOverlaps(s0: number, s1: number, t0: number, t1: number): boolean {
  return s0 < t1 && s1 > t0;
}

export function bookingIntervalFromStartSlot(
  startSlot: string,
  durationMinutes: number,
): { start: number; end: number } | null {
  const start = minutesFromHHmm(startSlot);
  if (start === null || durationMinutes <= 0) return null;
  return { start, end: start + durationMinutes };
}

export function startSlotFitsDuration(startSlot: string, durationMinutes: number): boolean {
  const interval = bookingIntervalFromStartSlot(startSlot, durationMinutes);
  if (!interval) return false;
  if (interval.end > serviceDayEndMinutes()) return false;
  if (serviceRangeOverlapsLunch(interval.start, interval.end)) return false;
  return true;
}

export function assertSlotAllowed(
  dateKey: string,
  startSlot: string,
  opts?: { holidayOutcall?: boolean; units?: number; unitMinutes?: number },
): DateTime {
  const day = parseDateKey(dateKey);
  const today = DateTime.now().setZone(TIMEZONE).startOf("day");
  if (day < today) {
    throw new Error("past_date");
  }
  const latest = mondayOfWeek(today).plus({ days: 13 });
  if (day > latest) {
    throw new Error("beyond_booking_window");
  }
  const holidayOutcall = Boolean(opts?.holidayOutcall);
  if (holidayOutcall) {
    if (!isHolidayOutcallBookableDay(day)) {
      throw new Error("not_weekend");
    }
  } else if (!isWeekday(day)) {
    throw new Error("not_weekday");
  }
  const slots = holidayOutcall ? allHolidayOutcallStartSlots() : allStartSlots();
  if (!slots.includes(startSlot)) {
    throw new Error("invalid_slot");
  }
  const unitMinutes = opts?.unitMinutes ?? DEFAULT_UNIT_MINUTES;
  const units = opts?.units ?? 1;
  const durationMinutes = durationMinutesForUnits(units, unitMinutes);
  if (!startSlotFitsDuration(startSlot, durationMinutes)) {
    throw new Error("ends_after_daily_close");
  }
  const [hh, mm] = startSlot.split(":").map((x) => Number(x));
  const start = day.set({ hour: hh, minute: mm, second: 0, millisecond: 0 });
  const nowZoned = DateTime.now().setZone(TIMEZONE);
  if (start < nowZoned) {
    throw new Error("past_slot");
  }
  const end = start.plus({ minutes: durationMinutes });
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

/** 該 dateKey + startSlot 的開始時間是否已早於現在（台北）；無 startSlot 則以該日是否早於今日判斷 */
export function isBookingStartInPastTaipei(dateKey: string, startSlot: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;
  try {
    const day = parseDateKey(dateKey);
    const slot = typeof startSlot === "string" ? startSlot.trim() : "";
    if (!slot) {
      const today = DateTime.now().setZone(TIMEZONE).startOf("day");
      return day < today;
    }
    const [hh, mm] = slot.split(":").map((x) => Number(x));
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return false;
    const start = day.set({ hour: hh, minute: mm, second: 0, millisecond: 0 });
    return start < DateTime.now().setZone(TIMEZONE);
  } catch {
    return false;
  }
}

/** 後台設定的「不開放預約」區間（Luxon：週一 = 1 … 週五 = 5；同一日內 HH:mm） */
export type BookingBlockWindow = {
  weekday: number;
  start: string;
  end: string;
  reason: string;
  /** 若為 YYYY-MM-DD，僅該曆日套用；未設則依 weekday 每週重複 */
  dateKey?: string;
};

function normalizeHHmm(hhmm: string): string {
  const total = minutesFromHHmm(hhmm);
  if (total === null) return hhmm.trim();
  return hhmmFromMinutes(total);
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
    let onlyDate: string | undefined;
    const dkRaw = o.dateKey;
    if (typeof dkRaw === "string" && dkRaw.trim() !== "") {
      let dayForBlock: DateTime;
      try {
        dayForBlock = parseDateKey(dkRaw.trim());
      } catch {
        continue;
      }
      if (!isWeekday(dayForBlock)) continue;
      if (dayForBlock.weekday !== weekday) continue;
      onlyDate = dayForBlock.toISODate()!;
    }
    const row: BookingBlockWindow = {
      weekday,
      start: normalizeHHmm(start),
      end: normalizeHHmm(end),
      reason: reason.slice(0, 200),
    };
    if (onlyDate) row.dateKey = onlyDate;
    out.push(row);
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
  durationMinutes: number = LEGACY_BOOKING_DURATION_MINUTES,
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
  const srv1 = srv0 + durationMinutes;

  for (const w of windows) {
    if (w.dateKey) {
      if (w.dateKey !== dateKey) continue;
    } else if (w.weekday !== wd) {
      continue;
    }
    const b0 = minutesFromHHmm(w.start);
    const b1 = minutesFromHHmm(w.end);
    if (b0 === null || b1 === null || b0 >= b1) continue;
    if (srv0 < b1 && srv1 > b0) {
      return w.reason || "此時段不開放預約";
    }
  }
  return null;
}

/** 某日所有「不可選」的開始時間（僅含 {@link allStartSlots} 內的格子） */
export function listBlockedStartSlotsForDate(
  dateKey: string,
  windows: BookingBlockWindow[],
  durationMinutes: number = LEGACY_BOOKING_DURATION_MINUTES,
): { startSlot: string; reason: string }[] {
  const out: { startSlot: string; reason: string }[] = [];
  for (const s of allStartSlots()) {
    const r = blockedReasonForSlot(dateKey, s, windows, durationMinutes);
    if (r) out.push({ startSlot: s, reason: r });
  }
  return out;
}

export type ExistingBookingInterval = {
  startSlot: string;
  durationMinutes: number;
};

/** 依既有預約、不開放區間與所選時長，回傳不可選的開始時間 */
export function listUnavailableStartSlotsForDay(opts: {
  dateKey: string;
  durationMinutes: number;
  existingBookings: ExistingBookingInterval[];
  blockWindows: BookingBlockWindow[];
  holidayOutcall?: boolean;
}): string[] {
  const slots = allGridStartSlots(opts.holidayOutcall);
  const unavailable: string[] = [];
  for (const startSlot of slots) {
    if (!startSlotFitsDuration(startSlot, opts.durationMinutes)) {
      unavailable.push(startSlot);
      continue;
    }
    const interval = bookingIntervalFromStartSlot(startSlot, opts.durationMinutes);
    if (!interval) {
      unavailable.push(startSlot);
      continue;
    }
    let overlap = false;
    for (const b of opts.existingBookings) {
      const bi = bookingIntervalFromStartSlot(b.startSlot, b.durationMinutes);
      if (bi && bookingRangeOverlaps(interval.start, interval.end, bi.start, bi.end)) {
        overlap = true;
        break;
      }
    }
    if (overlap) {
      unavailable.push(startSlot);
      continue;
    }
    const blockReason = blockedReasonForSlot(
      opts.dateKey,
      startSlot,
      opts.blockWindows,
      opts.durationMinutes,
    );
    if (blockReason) unavailable.push(startSlot);
  }
  return unavailable;
}
