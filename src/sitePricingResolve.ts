/**
 * 與 `functions/src/pricing.ts` 邏輯對齊：客戶端讀 `siteSettings/pricing` 時使用。
 * 若調整驗證／預設值，請一併修改後端檔案。
 */

const DEFAULT_SESSION_PRICE_NTD = 70;
const DEFAULT_ADDON_15_PRICE_NTD = 30;
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
  return asIntInRange(raw, "sessionPriceNtd", DEFAULT_SESSION_PRICE_NTD, 1, 500_000);
}

export function resolveAddon15PriceNtdClient(raw: Record<string, unknown> | undefined): number {
  return asIntInRange(raw, "addon15PriceNtd", DEFAULT_ADDON_15_PRICE_NTD, 1, 500_000);
}

export function resolvePointsPerMassageClient(raw: Record<string, unknown> | undefined): number {
  return asIntInRange(raw, "pointsPerMassage", DEFAULT_POINTS_PER_MASSAGE, 2, 1000);
}
