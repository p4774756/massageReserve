/**
 * 與 `functions/src/pricing.ts` 邏輯對齊：客戶端讀 `siteSettings/pricing` 時使用。
 * 若調整驗證／預設值，請一併修改後端檔案。
 */

/** 與 `functions/src/pricing.ts` 對齊：固定基本金額 */
export const FIXED_SESSION_PRICE_NTD = 130;
const DEFAULT_SESSION_PRICE_NTD = FIXED_SESSION_PRICE_NTD;
const DEFAULT_POINTS_PER_MASSAGE = 10;

/** 與 `functions/src/pricing.ts` 對齊：單筆預約固定 15 分鐘 */
export const BOOKING_UNIT_MINUTES_FIXED = 15;

/** 前台副標顯示的單次服務時長（分）；排程佔用仍為 BOOKING_UNIT_MINUTES_FIXED */
export const DISPLAY_SESSION_MINUTES = 17;

/** 與 `functions/src/pricing.ts` 相同：現場收現進位至 10 元倍數 */
export const SESSION_PRICE_CASH_STEP_NTD = 10;

export function roundSessionPriceNtdForCash(ntd: number): number {
  const n = typeof ntd === "number" && Number.isFinite(ntd) ? Math.round(ntd) : Number(ntd);
  if (!Number.isInteger(n)) return roundSessionPriceNtdForCash(DEFAULT_SESSION_PRICE_NTD);
  if (n < SESSION_PRICE_CASH_STEP_NTD) return SESSION_PRICE_CASH_STEP_NTD;
  return Math.ceil(n / SESSION_PRICE_CASH_STEP_NTD) * SESSION_PRICE_CASH_STEP_NTD;
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

function isTsmcPricingEnabledClient(raw: Record<string, unknown> | undefined): boolean {
  if (!raw || typeof raw !== "object") return true;
  return raw.tsmcPricingEnabled !== false;
}

export function resolveTsmcPricingEnabledClient(raw: Record<string, unknown> | undefined): boolean {
  return isTsmcPricingEnabledClient(raw);
}

export function resolveSessionPriceBaseNtdClient(raw: Record<string, unknown> | undefined): number {
  const n = asIntInRange(raw, "tsmcPricingBaseNtd", DEFAULT_SESSION_PRICE_NTD, SESSION_PRICE_CASH_STEP_NTD, 500_000);
  return roundSessionPriceNtdForCash(n);
}

export function resolveSessionPriceNtdClient(raw: Record<string, unknown> | undefined): number {
  const base = resolveSessionPriceBaseNtdClient(raw);
  if (!raw || typeof raw !== "object") return base;
  if (!isTsmcPricingEnabledClient(raw)) return base;
  const v = raw.sessionPriceNtd ?? raw.unitPriceNtd;
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 500_000) return base;
  return roundSessionPriceNtdForCash(n);
}

export function resolvePointsPerMassageClient(raw: Record<string, unknown> | undefined): number {
  return asIntInRange(raw, "pointsPerMassage", DEFAULT_POINTS_PER_MASSAGE, 2, 1000);
}

