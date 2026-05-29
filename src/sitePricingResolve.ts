/**
 * 與 `functions/src/pricing.ts` 邏輯對齊：客戶端讀 `siteSettings/pricing` 時使用。
 * 若調整驗證／預設值，請一併修改後端檔案。
 */

const DEFAULT_SESSION_PRICE_NTD = 130;
const DEFAULT_UNIT_MINUTES = 20;
const DEFAULT_MAX_UNITS_PER_BOOKING = 2;
const DEFAULT_POINTS_PER_MASSAGE = 10;

function asIntInRange(
  raw: Record<string, unknown> | undefined,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!raw || typeof raw !== "object") return fallback;
  const v = raw[key];
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

export function resolveSessionPriceNtdClient(raw: Record<string, unknown> | undefined): number {
  if (!raw || typeof raw !== "object") return DEFAULT_SESSION_PRICE_NTD;
  const v = raw.sessionPriceNtd ?? raw.unitPriceNtd;
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 500_000) return DEFAULT_SESSION_PRICE_NTD;
  return n;
}

export function resolveUnitMinutesClient(raw: Record<string, unknown> | undefined): number {
  return asIntInRange(raw, "unitMinutes", DEFAULT_UNIT_MINUTES, 5, 240);
}

export function resolveMaxUnitsPerBookingClient(raw: Record<string, unknown> | undefined): number {
  return asIntInRange(raw, "maxUnitsPerBooking", DEFAULT_MAX_UNITS_PER_BOOKING, 1, 10);
}

export function resolvePointsPerMassageClient(raw: Record<string, unknown> | undefined): number {
  return asIntInRange(raw, "pointsPerMassage", DEFAULT_POINTS_PER_MASSAGE, 2, 1000);
}

export function durationMinutesForUnitsClient(units: number, unitMinutes: number): number {
  return units * unitMinutes;
}
