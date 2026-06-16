import type { DocumentData } from "firebase-admin/firestore";

/**
 * 後台 `siteSettings/pricing`：每單位金額、點數兌換門檻
 * `sessionPriceNtd` 語意為「每 1 單位現場金額」（與舊版欄位名相容）。
 *
 * 台積電連動（見 `tsmcPricing.ts`）：`tsmcPricingBaseNtd`（基本金額）、`tsmcAnchorDateKey`（漲跌基準日）、
 * `tsmcCumulativeFactor`（自基準日起累乘日漲跌，±40% 封頂）、`tsmcAnchorCloseNtd`／`tsmcLastQuoteCloseNtd`（2330 收盤價）；
 * 平日 15:30 重算後寫入 `sessionPriceNtd`。
 */

export const DEFAULT_SESSION_PRICE_NTD = 130;
export const DEFAULT_POINTS_PER_MASSAGE = 10;

/** 單筆預約固定 1 單位（前台不再提供多單位選擇） */
export const BOOKING_UNITS_FIXED = 1;
/** 單筆預約固定 15 分鐘（後台不再提供調整） */
export const BOOKING_UNIT_MINUTES_FIXED = 15;

/** 現場收現：未滿 10 元進位為 10，其餘無條件進位至 10 的倍數 */
export const SESSION_PRICE_CASH_STEP_NTD = 10;

export function roundSessionPriceNtdForCash(ntd: number): number {
  const n = typeof ntd === "number" && Number.isFinite(ntd) ? Math.round(ntd) : Number(ntd);
  if (!Number.isInteger(n)) return roundSessionPriceNtdForCash(DEFAULT_SESSION_PRICE_NTD);
  if (n < SESSION_PRICE_CASH_STEP_NTD) return SESSION_PRICE_CASH_STEP_NTD;
  return Math.ceil(n / SESSION_PRICE_CASH_STEP_NTD) * SESSION_PRICE_CASH_STEP_NTD;
}

function isTsmcPricingEnabled(raw: Record<string, unknown> | undefined): boolean {
  if (!raw || typeof raw !== "object") return true;
  return raw.tsmcPricingEnabled !== false;
}

/** 後台可調「基本金額」；台積電連動時亦為累積係數起點 */
export function resolveSessionPriceBaseNtd(raw: DocumentData | undefined): number {
  if (!raw || typeof raw !== "object") return roundSessionPriceNtdForCash(DEFAULT_SESSION_PRICE_NTD);
  const o = raw as Record<string, unknown>;
  const v = o.tsmcPricingBaseNtd;
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : Number(v);
  if (!Number.isInteger(n) || n < SESSION_PRICE_CASH_STEP_NTD || n > 500_000) {
    return roundSessionPriceNtdForCash(DEFAULT_SESSION_PRICE_NTD);
  }
  return roundSessionPriceNtdForCash(n);
}

/** 未啟用台積電連動時回傳基本金額；啟用時讀同步後的 `sessionPriceNtd` */
export function resolveSessionPriceNtd(raw: DocumentData | undefined): number {
  const base = resolveSessionPriceBaseNtd(raw);
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  if (!isTsmcPricingEnabled(o)) return base;
  const v = o.sessionPriceNtd ?? o.unitPriceNtd;
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 500_000) return base;
  return roundSessionPriceNtdForCash(n);
}

export function resolveTsmcPricingEnabledForApi(raw: DocumentData | undefined): boolean {
  if (!raw || typeof raw !== "object") return true;
  return isTsmcPricingEnabled(raw as Record<string, unknown>);
}

export function resolvePointsPerMassage(raw: DocumentData | undefined): number {
  if (!raw || typeof raw !== "object") return DEFAULT_POINTS_PER_MASSAGE;
  const o = raw as Record<string, unknown>;
  const v = o.pointsPerMassage;
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : Number(v);
  if (!Number.isInteger(n) || n < 2 || n > 1000) return DEFAULT_POINTS_PER_MASSAGE;
  return n;
}

export function durationMinutesForUnits(units: number, unitMinutes: number): number {
  return units * unitMinutes;
}

/** 解析預約單位數；僅接受 1（省略時視為 1） */
export function parseBookingUnits(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return BOOKING_UNITS_FIXED;
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : Number(raw);
  if (!Number.isInteger(n) || n !== BOOKING_UNITS_FIXED) return null;
  return BOOKING_UNITS_FIXED;
}

/**
 * 將舊版純金額餘額依「目前單價」折成整數次數；餘額保留未滿一次的金額。
 */
export function foldWalletBalanceIntoSessions(
  walletBalance: number,
  sessionCredits: number,
  sessionPriceNtd: number,
): { walletBalance: number; sessionCredits: number } {
  const wb = Number.isFinite(walletBalance) && walletBalance > 0 ? Math.floor(walletBalance) : 0;
  const sc0 = Number.isFinite(sessionCredits) && sessionCredits > 0 ? Math.floor(sessionCredits) : 0;
  const price = sessionPriceNtd > 0 ? sessionPriceNtd : DEFAULT_SESSION_PRICE_NTD;
  if (wb <= 0) return { walletBalance: wb, sessionCredits: sc0 };
  const conv = Math.floor(wb / price);
  if (conv <= 0) return { walletBalance: wb, sessionCredits: sc0 };
  return {
    walletBalance: wb - conv * price,
    sessionCredits: sc0 + conv,
  };
}
