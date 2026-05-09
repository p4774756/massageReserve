/** 與 `functions/src/bookingLogic.resolveBookingCaps` 對齊，供前端顯示預約規則 */
export function resolveBookingCapsClient(raw: unknown): { maxPerDay: number; maxPerWorkWeek: number } {
  const BOOKING_CAP_MIN = 1;
  const BOOKING_CAP_MAX = 50;
  const DEFAULT_MAX_PER_DAY = 2;
  const DEFAULT_MAX_PER_WORK_WEEK = 4;
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
