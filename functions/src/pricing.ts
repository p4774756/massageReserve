import type { DocumentData } from "firebase-admin/firestore";

/**
 * 後台 `siteSettings/pricing`：每單位金額／分鐘、點數兌換門檻、單筆最多單位數
 * `sessionPriceNtd` 語意為「每 1 單位現場金額」（與舊版欄位名相容）。
 *
 * 台積電連動（見 `tsmcPricing.ts`）：`tsmcPricingBaseNtd`（店內錨點）、`tsmcCumulativeFactor`（累積係數）、
 * 平日 15:30 依 2330「相對昨日收盤」日漲跌累乘後寫入 `sessionPriceNtd`。
 */

export const DEFAULT_SESSION_PRICE_NTD = 130;
export const DEFAULT_UNIT_MINUTES = 20;
export const DEFAULT_MAX_UNITS_PER_BOOKING = 2;
export const DEFAULT_POINTS_PER_MASSAGE = 10;

const MAX_UNITS_CAP = 10;

/** 現場收現：未滿 10 元進位為 10，其餘無條件進位至 10 的倍數 */
export const SESSION_PRICE_CASH_STEP_NTD = 10;

export function roundSessionPriceNtdForCash(ntd: number): number {
  const n = typeof ntd === "number" && Number.isFinite(ntd) ? Math.round(ntd) : Number(ntd);
  if (!Number.isInteger(n)) return roundSessionPriceNtdForCash(DEFAULT_SESSION_PRICE_NTD);
  if (n < SESSION_PRICE_CASH_STEP_NTD) return SESSION_PRICE_CASH_STEP_NTD;
  return Math.ceil(n / SESSION_PRICE_CASH_STEP_NTD) * SESSION_PRICE_CASH_STEP_NTD;
}

export function resolveSessionPriceNtd(raw: DocumentData | undefined): number {
  if (!raw || typeof raw !== "object") return roundSessionPriceNtdForCash(DEFAULT_SESSION_PRICE_NTD);
  const o = raw as Record<string, unknown>;
  const v = o.sessionPriceNtd ?? o.unitPriceNtd;
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 500_000) {
    return roundSessionPriceNtdForCash(DEFAULT_SESSION_PRICE_NTD);
  }
  return roundSessionPriceNtdForCash(n);
}

export function resolveUnitMinutes(raw: DocumentData | undefined): number {
  if (!raw || typeof raw !== "object") return DEFAULT_UNIT_MINUTES;
  const o = raw as Record<string, unknown>;
  const v = o.unitMinutes;
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : Number(v);
  if (!Number.isInteger(n) || n < 5 || n > 240) return DEFAULT_UNIT_MINUTES;
  return n;
}

export function resolveMaxUnitsPerBooking(raw: DocumentData | undefined): number {
  if (!raw || typeof raw !== "object") return DEFAULT_MAX_UNITS_PER_BOOKING;
  const o = raw as Record<string, unknown>;
  const v = o.maxUnitsPerBooking;
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : Number(v);
  if (!Number.isInteger(n) || n < 1 || n > MAX_UNITS_CAP) return DEFAULT_MAX_UNITS_PER_BOOKING;
  return n;
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

/** 解析預約單位數（1 … maxUnits） */
export function parseBookingUnits(raw: unknown, maxUnits: number): number | null {
  const cap = Math.max(1, Math.min(MAX_UNITS_CAP, Math.floor(maxUnits)));
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > cap) return null;
  return n;
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
