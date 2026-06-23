import type { DocumentData } from "firebase-admin/firestore";

/**
 * 後台 `siteSettings/pricing`：每單位金額、點數兌換門檻
 * `sessionPriceNtd` 語意為「每 1 單位現場金額」（與舊版欄位名相容）。
 */

export const DEFAULT_SESSION_PRICE_NTD = 110;
export const DEFAULT_POINTS_PER_MASSAGE = 10;

/** 單筆預約固定 1 單位（前台不再提供多單位選擇） */
export const BOOKING_UNITS_FIXED = 1;
/** 單筆預約固定 15 分鐘（後台不再提供調整） */
export const BOOKING_UNIT_MINUTES_FIXED = 15;

/** 每次按摩金額下限（元） */
export const MIN_SESSION_PRICE_NTD = 1;

export function normalizeSessionPriceNtd(ntd: number): number {
  const n = typeof ntd === "number" && Number.isFinite(ntd) ? Math.round(ntd) : Number(ntd);
  if (!Number.isInteger(n)) return DEFAULT_SESSION_PRICE_NTD;
  if (n < MIN_SESSION_PRICE_NTD) return MIN_SESSION_PRICE_NTD;
  if (n > 500_000) return 500_000;
  return n;
}

/** 讀取每次按摩金額；相容舊欄位 `tsmcPricingBaseNtd`／`unitPriceNtd` */
export function resolveSessionPriceNtd(raw: DocumentData | undefined): number {
  if (!raw || typeof raw !== "object") return DEFAULT_SESSION_PRICE_NTD;
  const o = raw as Record<string, unknown>;
  const v = o.sessionPriceNtd ?? o.tsmcPricingBaseNtd ?? o.unitPriceNtd;
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : Number(v);
  if (!Number.isInteger(n) || n < MIN_SESSION_PRICE_NTD || n > 500_000) {
    return DEFAULT_SESSION_PRICE_NTD;
  }
  return normalizeSessionPriceNtd(n);
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
