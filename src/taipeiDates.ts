import { intlLocaleTag } from "./i18n";

export function isDateKeyMonFri(dateKey: string): boolean {
  const [y, m, d] = dateKey.split("-").map((x) => Number(x));
  if (!y || !m || !d) return false;
  const dow = new Date(y, m - 1, d).getDay();
  return dow >= 1 && dow <= 5;
}

const TAIPEI_LONG_WD: Record<string, number> = {
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
  Sunday: 7,
};

export function addDaysTaipeiDateKey(dateKey: string, deltaDays: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) return dateKey;
  const inst = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00+08:00`);
  inst.setTime(inst.getTime() + deltaDays * 86_400_000);
  return inst.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

export function taipeiWeekdayNumMon1Sun7(dateKey: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) return Number.NaN;
  const inst = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00+08:00`);
  const long = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", weekday: "long" }).format(inst);
  return TAIPEI_LONG_WD[long as keyof typeof TAIPEI_LONG_WD] ?? Number.NaN;
}

const WEEKDAY_ZH_MON1: readonly string[] = ["週一", "週二", "週三", "週四", "週五", "週六", "週日"];

/** 台北日曆：週一 … 週日；無效 dateKey 回傳空字串 */
export function weekdayZhFromDateKeyTaipei(dateKey: string): string {
  const wd = taipeiWeekdayNumMon1Sun7(dateKey);
  if (!Number.isFinite(wd) || wd < 1 || wd > 7) return "";
  return WEEKDAY_ZH_MON1[wd - 1] ?? "";
}

/** 週六、週日（台北日曆）；與後端假日外約可約日一致 */
export function isDateKeySatSun(dateKey: string): boolean {
  const wd = taipeiWeekdayNumMon1Sun7(dateKey);
  return wd === 6 || wd === 7;
}

/** 今日日曆日（台北），YYYY-MM-DD；與 date input、後端 dateKey 一致 */
export function taipeiTodayDateKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

export function taipeiMondayOfSameWeek(dateKey: string): string {
  const wd = taipeiWeekdayNumMon1Sun7(dateKey);
  if (!Number.isFinite(wd)) return dateKey;
  return addDaysTaipeiDateKey(dateKey, -(wd - 1));
}

/** 與後端 `bookingLogic.taipeiLatestBookableDateKey` 一致：本週一起算，最遠可選「下週日」 */
export function taipeiLatestBookableDateKey(): string {
  return addDaysTaipeiDateKey(taipeiMondayOfSameWeek(taipeiTodayDateKey()), 13);
}

/** 後台預約月曆預設選取日期：從台北今日起往後找第一個仍在可預約視窗內的週一至週五 */
export function defaultAdminCapacityProbeDateKey(): string {
  const minKey = taipeiTodayDateKey();
  const maxKey = taipeiLatestBookableDateKey();
  for (let i = 0; i < 16; i++) {
    const dk = addDaysTaipeiDateKey(minKey, i);
    if (dk > maxKey) break;
    if (isDateKeyMonFri(dk)) return dk;
  }
  return taipeiMondayOfSameWeek(minKey);
}

/** 例如 2026-04-23（週三），供名額說明用 */
export function dateKeyLabelTaipei(dateKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) return dateKey;
  try {
    const inst = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00+08:00`);
    const wd = new Intl.DateTimeFormat(intlLocaleTag(), { timeZone: "Asia/Taipei", weekday: "short" }).format(
      inst,
    );
    return `${m[1]}-${m[2]}-${m[3]}（${wd}）`;
  } catch {
    return dateKey;
  }
}

/** 該 dateKey + startSlot 在台北時區的開始瞬間（ms）；無效則 NaN */
export function slotStartInstantMsTaipei(dateKey: string, startSlot: string): number {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!dm) return Number.NaN;
  const [, y, mo, d] = dm;
  const sm = /^(\d{1,2}):(\d{2})$/.exec(startSlot.trim());
  if (!sm) return Number.NaN;
  const hh = String(Number(sm[1])).padStart(2, "0");
  const mm = String(Number(sm[2])).padStart(2, "0");
  return new Date(`${y}-${mo}-${d}T${hh}:${mm}:00+08:00`).getTime();
}

/** 選「今天」且該格開始時間已早於現在（台北當日） */
export function isStartSlotInPastForTaipeiToday(dateKey: string, startSlot: string): boolean {
  if (dateKey !== taipeiTodayDateKey()) return false;
  return isStartSlotInPastTaipei(dateKey, startSlot);
}

/** 該 dateKey + startSlot 的開始時間是否已早於現在（台北）；無 startSlot 則以該日是否早於今日判斷 */
export function isStartSlotInPastTaipei(dateKey: string, startSlot: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;
  const slot = startSlot.trim();
  if (!slot) return dateKey < taipeiTodayDateKey();
  const t = slotStartInstantMsTaipei(dateKey, slot);
  return Number.isFinite(t) && t < Date.now();
}

/** 本工作週匿名時段列：略過已過的開始時間（標籤格式如「週二 15:15 Rexx」） */
export function filterFutureWeekPeerLabels(selectedDateKey: string, labels: string[]): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDateKey)) return labels;
  const weekStart = taipeiMondayOfSameWeek(selectedDateKey);
  return labels.filter((label) => {
    const m = /^(週[一二三四五六日])\s+(\d{1,2}:\d{2})(?:\s|$)/.exec(label.trim());
    if (!m) return true;
    const wdIndex = WEEKDAY_ZH_MON1.indexOf(m[1]);
    if (wdIndex < 0) return true;
    const peerDateKey = addDaysTaipeiDateKey(weekStart, wdIndex);
    return !isStartSlotInPastTaipei(peerDateKey, m[2]);
  });
}

/** 月曆表頭：台北該日的星期（0=日 … 6=六） */
const CAL_WD_SUN0: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function taipeiWeekdaySun0FromDateKey(dateKey: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) return 0;
  const inst = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00+08:00`);
  const short = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", weekday: "short" }).format(inst);
  return CAL_WD_SUN0[short as keyof typeof CAL_WD_SUN0] ?? 0;
}

export function dateKeyFromYmdTaipei(y: number, month: number, day: number): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

/** month：1–12 */
export function daysInMonthFromOneIndexed(y: number, month: number): number {
  return new Date(y, month, 0).getDate();
}

/** 預約視窗內，該類型第一個可選 dateKey；無則回傳 "" */
export function firstBookableDateKeyInWindow(office: boolean): string {
  const minKey = taipeiTodayDateKey();
  const maxKey = taipeiLatestBookableDateKey();
  for (let i = 0; i < 20; i++) {
    const dk = addDaysTaipeiDateKey(minKey, i);
    if (dk > maxKey) break;
    if (office ? isDateKeyMonFri(dk) : isDateKeySatSun(dk)) return dk;
  }
  return "";
}

/** 該曆月內是否至少有一天落在預約視窗且符合 office／假日類型 */
export function monthHasBookableDayInBookWindow(y: number, month: number, office: boolean): boolean {
  const dim = daysInMonthFromOneIndexed(y, month);
  const minKey = taipeiTodayDateKey();
  const maxKey = taipeiLatestBookableDateKey();
  for (let d = 1; d <= dim; d++) {
    const dk = dateKeyFromYmdTaipei(y, month, d);
    if (dk < minKey || dk > maxKey) continue;
    if (office ? isDateKeyMonFri(dk) : isDateKeySatSun(dk)) return true;
  }
  return false;
}
