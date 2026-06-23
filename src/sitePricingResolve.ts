/**
 * 與 `functions/src/pricing.ts` 邏輯對齊：客戶端讀 `siteSettings/pricing` 時使用。
 * 若調整驗證／預設值，請一併修改後端檔案。
 */

/** 與 `functions/src/pricing.ts` 對齊：固定基本金額 */
export const FIXED_SESSION_PRICE_NTD = 110;
const DEFAULT_SESSION_PRICE_NTD = FIXED_SESSION_PRICE_NTD;
const DEFAULT_POINTS_PER_MASSAGE = 10;

/** 與 `functions/src/pricing.ts` 對齊：單筆預約固定 15 分鐘 */
export const BOOKING_UNIT_MINUTES_FIXED = 15;

/** 前台副標顯示的單次服務時長（分）；排程佔用仍為 BOOKING_UNIT_MINUTES_FIXED */
export const DISPLAY_SESSION_MINUTES = 17;

/** 與 `functions/src/pricing.ts` 對齊：金額驗證下限 */
export const MIN_SESSION_PRICE_NTD = 1;

export function normalizeSessionPriceNtd(ntd: number): number {
  const n = typeof ntd === "number" && Number.isFinite(ntd) ? Math.round(ntd) : Number(ntd);
  if (!Number.isInteger(n)) return DEFAULT_SESSION_PRICE_NTD;
  if (n < MIN_SESSION_PRICE_NTD) return MIN_SESSION_PRICE_NTD;
  if (n > 500_000) return 500_000;
  return n;
}

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
  const v = raw.sessionPriceNtd ?? raw.tsmcPricingBaseNtd ?? raw.unitPriceNtd;
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : Number(v);
  if (!Number.isInteger(n) || n < MIN_SESSION_PRICE_NTD || n > 500_000) {
    return DEFAULT_SESSION_PRICE_NTD;
  }
  return normalizeSessionPriceNtd(n);
}

export function resolvePointsPerMassageClient(raw: Record<string, unknown> | undefined): number {
  return asIntInRange(raw, "pointsPerMassage", DEFAULT_POINTS_PER_MASSAGE, 2, 1000);
}
