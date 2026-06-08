import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { DateTime } from "luxon";
import { resolveSessionPriceBaseNtd, roundSessionPriceNtdForCash } from "./pricing";
import { TIMEZONE } from "./bookingLogic";

const PRICING_DOC_PATH = { collection: "siteSettings", id: "pricing" } as const;
const FETCH_TIMEOUT_MS = 20_000;
const MIN_SESSION_PRICE = 10;
const MAX_SESSION_PRICE = 500_000;
const MAX_QUOTE_STALE_DAYS = 7;

export type TsmcPricingSyncResult =
  | { ok: true; skipped: true; reason: string }
  | {
      ok: true;
      skipped: false;
      sessionPriceNtd: number;
      changePercent: number;
      baseNtd: number;
      anchorDateKey: string;
      quoteDateKey: string;
      cumulativeFactor: number;
      appliedToday: boolean;
    }
  | { ok: false; error: string };

export type TsmcDailyBar = {
  dateKey: string;
  close: number;
};

/** 相對店內基準價，累積漲跌係數上下限 ±40% */
export const TSMC_CUMULATIVE_FACTOR_MIN = 0.6;
export const TSMC_CUMULATIVE_FACTOR_MAX = 1.4;

export function clampTsmcCumulativeFactor(factor: number): number {
  const n = Number.isFinite(factor) ? factor : 1;
  return Math.max(TSMC_CUMULATIVE_FACTOR_MIN, Math.min(TSMC_CUMULATIVE_FACTOR_MAX, n));
}

/** 店內基準價 × 累積係數，再進位至 10 元倍數（方便收現） */
export function sessionPriceFromTsmcCompound(baseNtd: number, cumulativeFactor: number): number {
  const base = Number.isFinite(baseNtd) ? baseNtd : resolveSessionPriceBaseNtd(undefined);
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
  return resolveSessionPriceBaseNtd(raw);
}

export function resolveTsmcAnchorDateKey(raw: Record<string, unknown> | undefined): string {
  if (raw && typeof raw === "object") {
    const v = raw.tsmcAnchorDateKey;
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) {
      return v.trim();
    }
  }
  return DateTime.now().setZone(TIMEZONE).toISODate() ?? "2020-01-01";
}

type YahooChartResult = {
  meta?: Record<string, unknown>;
  timestamp?: number[];
  indicators?: { quote?: Array<{ close?: Array<number | null> }> };
};

/** 解析 Yahoo 日 K 收盤價（依台北日期去重，保留同日最後一筆） */
export function parseYahooDailyBars(result: YahooChartResult): TsmcDailyBar[] {
  const stamps = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const byDate = new Map<string, number>();
  for (let i = 0; i < stamps.length; i++) {
    const ts = stamps[i];
    const close = closes[i];
    if (typeof ts !== "number" || !Number.isFinite(ts)) continue;
    if (typeof close !== "number" || !Number.isFinite(close) || close <= 0) continue;
    const dateKey = DateTime.fromSeconds(ts, { zone: TIMEZONE }).toISODate();
    if (!dateKey) continue;
    byDate.set(dateKey, close);
  }
  return [...byDate.entries()]
    .map(([dateKey, close]) => ({ dateKey, close }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

/**
 * 自基準日（含）起算，僅累乘「基準日之後」各交易日的日漲跌；
 * 基準日當日係數為 1。
 */
export function computeTsmcCumulativeFromBars(
  bars: TsmcDailyBar[],
  anchorDateKey: string,
): { factor: number; quoteDateKey: string; lastChangePercent: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDateKey)) {
    throw new Error("漲跌基準日格式錯誤");
  }
  if (bars.length === 0) {
    throw new Error("無法取得台積電行情");
  }
  const anchorIdx = bars.findIndex((b) => b.dateKey >= anchorDateKey);
  if (anchorIdx < 0) {
    throw new Error(`基準日 ${anchorDateKey} 尚無行情資料，請改選較近的日期`);
  }
  let factor = 1;
  let lastChangePercent = 0;
  const lastBar = bars[bars.length - 1]!;
  for (let i = anchorIdx + 1; i < bars.length; i++) {
    const prev = bars[i - 1]!.close;
    const cur = bars[i]!.close;
    if (prev <= 0) continue;
    const pct = ((cur - prev) / prev) * 100;
    factor = clampTsmcCumulativeFactor(factor * (1 + pct / 100));
    lastChangePercent = pct;
  }
  return { factor, quoteDateKey: lastBar.dateKey, lastChangePercent };
}

function assertQuoteNotTooStale(quoteDateKey: string): void {
  const today = DateTime.now().setZone(TIMEZONE).startOf("day");
  const quoteDay = DateTime.fromISO(quoteDateKey, { zone: TIMEZONE }).startOf("day");
  if (!quoteDay.isValid) return;
  const days = today.diff(quoteDay, "days").days;
  if (days > MAX_QUOTE_STALE_DAYS) {
    throw new Error(`行情過舊（最近交易日 ${quoteDateKey}）`);
  }
}

/** 自 Yahoo Finance 讀取基準日至今的 2330 日 K */
export async function fetchTsmcDailyBarsSince(anchorDateKey: string): Promise<TsmcDailyBar[]> {
  const anchorStart = DateTime.fromISO(anchorDateKey, { zone: TIMEZONE }).startOf("day");
  if (!anchorStart.isValid) {
    throw new Error("漲跌基準日無效");
  }
  const period1 = Math.floor(anchorStart.toSeconds());
  const period2 = Math.floor(DateTime.now().setZone(TIMEZONE).plus({ days: 1 }).startOf("day").toSeconds());
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/2330.TW?interval=1d&period1=${period1}&period2=${period2}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
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
    const bars = parseYahooDailyBars(result);
    if (bars.length === 0) {
      throw new Error("Yahoo chart：無有效收盤價");
    }
    return bars;
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
  const anchorDateKey = resolveTsmcAnchorDateKey(raw);
  const todayKey = DateTime.now().setZone(TIMEZONE).toISODate() ?? "";
  if (anchorDateKey > todayKey) {
    return { ok: false, error: "漲跌基準日不可晚於今日（台北）" };
  }

  let bars: TsmcDailyBar[];
  let factor: number;
  let quoteDateKey: string;
  let lastChangePercent: number;
  try {
    bars = await fetchTsmcDailyBarsSince(anchorDateKey);
    const computed = computeTsmcCumulativeFromBars(bars, anchorDateKey);
    factor = computed.factor;
    quoteDateKey = computed.quoteDateKey;
    lastChangePercent = computed.lastChangePercent;
    assertQuoteNotTooStale(quoteDateKey);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.warn("TSMC pricing fetch failed", { message, anchorDateKey });
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
  const appliedToday = lastApplied.length > 0 && lastApplied === quoteDateKey;
  const sessionPriceNtd = sessionPriceFromTsmcCompound(baseNtd, factor);

  await pricingRef.set(
    {
      sessionPriceNtd,
      tsmcPricingBaseNtd: baseNtd,
      tsmcAnchorDateKey: anchorDateKey,
      tsmcCumulativeFactor: factor,
      tsmcLastChangePercent: lastChangePercent,
      tsmcLastQuoteDateKey: quoteDateKey,
      tsmcLastAppliedQuoteDateKey: quoteDateKey,
      tsmcLastSyncSource: "yahoo_chart",
      tsmcLastSyncError: FieldValue.delete(),
      tsmcLastSyncAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  logger.info("TSMC pricing synced", {
    baseNtd,
    anchorDateKey,
    changePercent: lastChangePercent,
    cumulativeFactor: factor,
    appliedToday,
    sessionPriceNtd,
    quoteDateKey,
  });

  return {
    ok: true,
    skipped: false,
    sessionPriceNtd,
    changePercent: lastChangePercent,
    baseNtd,
    anchorDateKey,
    quoteDateKey,
    cumulativeFactor: factor,
    appliedToday,
  };
}
