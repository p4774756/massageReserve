import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { DateTime } from "luxon";
import { DEFAULT_SESSION_PRICE_NTD, roundSessionPriceNtdForCash } from "./pricing";
import { TIMEZONE } from "./bookingLogic";

const PRICING_DOC_PATH = { collection: "siteSettings", id: "pricing" } as const;
const YAHOO_CHART_URL =
  "https://query1.finance.yahoo.com/v8/finance/chart/2330.TW?interval=1d&range=10d";
const FETCH_TIMEOUT_MS = 20_000;
const MIN_SESSION_PRICE = 10;
const MAX_SESSION_PRICE = 500_000;
const MIN_BASE_NTD = 1;
const MAX_BASE_NTD = 500_000;

export type TsmcPricingSyncResult =
  | { ok: true; skipped: true; reason: string }
  | {
      ok: true;
      skipped: false;
      sessionPriceNtd: number;
      changePercent: number;
      baseNtd: number;
      quoteDateKey: string;
      cumulativeFactor: number;
      appliedToday: boolean;
    }
  | { ok: false; error: string };

export type TsmcDailyQuote = {
  changePercent: number;
  quoteDateKey: string;
  source: "yahoo_chart";
};

/** 相對店內基準價，累積漲跌係數上下限 ±25% */
export const TSMC_CUMULATIVE_FACTOR_MIN = 0.75;
export const TSMC_CUMULATIVE_FACTOR_MAX = 1.25;

export function clampTsmcCumulativeFactor(factor: number): number {
  const n = Number.isFinite(factor) ? factor : 1;
  return Math.max(TSMC_CUMULATIVE_FACTOR_MIN, Math.min(TSMC_CUMULATIVE_FACTOR_MAX, n));
}

/** 店內基準價 × 累積係數，再進位至 10 元倍數（方便收現） */
export function sessionPriceFromTsmcCompound(baseNtd: number, cumulativeFactor: number): number {
  const base = Number.isFinite(baseNtd) ? baseNtd : DEFAULT_SESSION_PRICE_NTD;
  const factor = clampTsmcCumulativeFactor(
    Number.isFinite(cumulativeFactor) && cumulativeFactor > 0 ? cumulativeFactor : 1,
  );
  const raw = base * factor;
  const clamped = Math.max(MIN_SESSION_PRICE, Math.min(MAX_SESSION_PRICE, Math.round(raw)));
  return roundSessionPriceNtdForCash(clamped);
}

/** 2330「相對昨日收盤」日漲跌累乘到係數（例：連兩天 +2% → 1.02×1.02） */
export function nextTsmcCumulativeFactor(current: number, dailyChangePercent: number): number {
  const c = clampTsmcCumulativeFactor(Number.isFinite(current) && current > 0 ? current : 1);
  const pct = Number.isFinite(dailyChangePercent) ? dailyChangePercent : 0;
  const next = c * (1 + pct / 100);
  return clampTsmcCumulativeFactor(next);
}

export function resolveTsmcCumulativeFactor(raw: Record<string, unknown> | undefined): number {
  if (!raw || typeof raw !== "object") return 1;
  const v = raw.tsmcCumulativeFactor;
  const n = typeof v === "number" && Number.isFinite(v) ? v : Number(v);
  if (!Number.isFinite(n)) return 1;
  return clampTsmcCumulativeFactor(n);
}

export function resolveTsmcPricingEnabled(raw: Record<string, unknown> | undefined): boolean {
  if (!raw || typeof raw !== "object") return true;
  if (raw.tsmcPricingEnabled === false) return false;
  return true;
}

export function resolveTsmcPricingBaseNtd(raw: Record<string, unknown> | undefined): number {
  if (!raw || typeof raw !== "object") return DEFAULT_SESSION_PRICE_NTD;
  const v = raw.tsmcPricingBaseNtd;
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : Number(v);
  if (!Number.isInteger(n) || n < MIN_BASE_NTD || n > MAX_BASE_NTD) return DEFAULT_SESSION_PRICE_NTD;
  return n;
}

function isQuoteForTodayTaipei(marketTimeSec: number): boolean {
  const quoteDay = DateTime.fromSeconds(marketTimeSec, { zone: TIMEZONE }).toISODate();
  const today = DateTime.now().setZone(TIMEZONE).toISODate();
  return quoteDay === today;
}

type YahooChartResult = {
  meta?: Record<string, unknown>;
  timestamp?: number[];
  indicators?: { quote?: Array<{ close?: Array<number | null> }> };
};

function finiteNum(v: unknown): number | null {
  const n = typeof v === "number" && Number.isFinite(v) ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 日漲跌幅 %：Yahoo 常省略 regularMarketChangePercent，改從昨收／K 線推算 */
export function resolveYahooDailyChangePercent(result: YahooChartResult): number | null {
  const meta = result.meta;
  if (meta && typeof meta === "object") {
    const direct = finiteNum(meta.regularMarketChangePercent);
    if (direct !== null) return direct;

    const price = finiteNum(meta.regularMarketPrice);
    const prevClose = finiteNum(meta.previousClose);
    if (price !== null && prevClose !== null && prevClose > 0) {
      return ((price - prevClose) / prevClose) * 100;
    }
  }

  const closes = result.indicators?.quote?.[0]?.close;
  if (Array.isArray(closes)) {
    const valid = closes.filter((c): c is number => typeof c === "number" && Number.isFinite(c));
    if (valid.length >= 2) {
      const last = valid[valid.length - 1]!;
      const prior = valid[valid.length - 2]!;
      if (prior > 0) return ((last - prior) / prior) * 100;
    }
  }

  if (meta && typeof meta === "object") {
    const price = finiteNum(meta.regularMarketPrice);
    const chartPrev = finiteNum(meta.chartPreviousClose);
    if (price !== null && chartPrev !== null && chartPrev > 0 && price !== chartPrev) {
      return ((price - chartPrev) / chartPrev) * 100;
    }
  }

  return null;
}

function resolveYahooMarketTimeSec(result: YahooChartResult): number | null {
  const metaTime = result.meta ? finiteNum(result.meta.regularMarketTime) : null;
  if (metaTime !== null && metaTime > 0) return metaTime;

  const stamps = result.timestamp;
  if (Array.isArray(stamps) && stamps.length > 0) {
    const last = stamps[stamps.length - 1]!;
    if (Number.isFinite(last) && last > 0) return last;
  }
  return null;
}

/** 自 Yahoo Finance chart API 讀取 2330 當日漲跌幅（%） */
export async function fetchTsmcDailyChangePercent(): Promise<TsmcDailyQuote> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(YAHOO_CHART_URL, {
      signal: controller.signal,
      headers: { "User-Agent": "massage-reserve-tsmc-pricing/1" },
    });
    if (!res.ok) {
      throw new Error(`Yahoo chart HTTP ${res.status}`);
    }
    const body = (await res.json()) as { chart?: { result?: YahooChartResult[] } };
    const result = body.chart?.result?.[0];
    if (!result || typeof result !== "object") {
      throw new Error("Yahoo chart：缺少 result");
    }
    const changePercent = resolveYahooDailyChangePercent(result);
    if (changePercent === null) {
      throw new Error("Yahoo chart：無法解析漲跌幅");
    }
    const marketTimeSec = resolveYahooMarketTimeSec(result);
    if (marketTimeSec === null) {
      throw new Error("Yahoo chart：無法解析行情時間");
    }
    if (!isQuoteForTodayTaipei(marketTimeSec)) {
      const quoteDay = DateTime.fromSeconds(marketTimeSec, { zone: TIMEZONE }).toISODate();
      const today = DateTime.now().setZone(TIMEZONE).toISODate();
      throw new Error(`非今日收盤行情（行情日 ${quoteDay ?? "?"}，今日 ${today ?? "?"}）`);
    }
    const quoteDateKey = DateTime.fromSeconds(marketTimeSec, { zone: TIMEZONE }).toISODate() ?? "";
    return { changePercent, quoteDateKey, source: "yahoo_chart" };
  } finally {
    clearTimeout(timer);
  }
}

export async function applyTsmcSessionPricingSync(db: Firestore): Promise<TsmcPricingSyncResult> {
  const pricingRef = db.collection(PRICING_DOC_PATH.collection).doc(PRICING_DOC_PATH.id);
  const snap = await pricingRef.get();
  const raw = (snap.data() ?? {}) as Record<string, unknown>;

  if (!resolveTsmcPricingEnabled(raw)) {
    return { ok: true, skipped: true, reason: "tsmc_pricing_disabled" };
  }

  const baseNtd = resolveTsmcPricingBaseNtd(raw);

  let quote: TsmcDailyQuote;
  try {
    quote = await fetchTsmcDailyChangePercent();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.warn("TSMC pricing fetch failed", { message });
    await pricingRef.set(
      {
        tsmcLastSyncError: message.slice(0, 500),
        tsmcLastSyncAttemptAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { ok: false, error: message };
  }

  const lastApplied =
    typeof raw.tsmcLastAppliedQuoteDateKey === "string" ? raw.tsmcLastAppliedQuoteDateKey.trim() : "";
  const alreadyAppliedToday = lastApplied.length > 0 && lastApplied === quote.quoteDateKey;
  let cumulativeFactor = resolveTsmcCumulativeFactor(raw);
  if (!alreadyAppliedToday) {
    cumulativeFactor = nextTsmcCumulativeFactor(cumulativeFactor, quote.changePercent);
  }

  const sessionPriceNtd = sessionPriceFromTsmcCompound(baseNtd, cumulativeFactor);

  await pricingRef.set(
    {
      sessionPriceNtd,
      tsmcPricingBaseNtd: baseNtd,
      tsmcCumulativeFactor: cumulativeFactor,
      tsmcLastChangePercent: quote.changePercent,
      tsmcLastQuoteDateKey: quote.quoteDateKey,
      tsmcLastAppliedQuoteDateKey: quote.quoteDateKey,
      tsmcLastSyncSource: quote.source,
      tsmcLastSyncError: FieldValue.delete(),
      tsmcLastSyncAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  logger.info("TSMC pricing synced", {
    baseNtd,
    changePercent: quote.changePercent,
    cumulativeFactor,
    appliedToday: !alreadyAppliedToday,
    sessionPriceNtd,
    quoteDateKey: quote.quoteDateKey,
  });

  return {
    ok: true,
    skipped: false,
    sessionPriceNtd,
    changePercent: quote.changePercent,
    baseNtd,
    quoteDateKey: quote.quoteDateKey,
    cumulativeFactor,
    appliedToday: !alreadyAppliedToday,
  };
}
