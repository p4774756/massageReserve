import type { DocumentData } from "firebase-admin/firestore";

/** 後台 `siteSettings/pricing`：現場／現金單次金額、點數兌換次數門檻 */

export const DEFAULT_SESSION_PRICE_NTD = 50;
export const DEFAULT_POINTS_PER_MASSAGE = 10;

export function resolveSessionPriceNtd(raw: DocumentData | undefined): number {
  if (!raw || typeof raw !== "object") return DEFAULT_SESSION_PRICE_NTD;
  const o = raw as Record<string, unknown>;
  const v = o.sessionPriceNtd;
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 500_000) return DEFAULT_SESSION_PRICE_NTD;
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
